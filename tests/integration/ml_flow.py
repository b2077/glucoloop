"""Exercise saved models through isolated backend, streamer, and mock chat.

Setup: train models first, install services/ml/requirements.txt and the simulator
dependencies, and install Node.js. No paid APIs or normal patient history are used.
Run from the repository root: python tests/integration/ml_flow.py

Ports and stream duration come from config.toml [integration]. Results are written
to docs/INTEGRATION.json; temporary service logs are retained under /tmp. These
checks verify connectivity and forecast shape, not clinical correctness.
"""

import copy
import json
import math
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services/ml"))
from settings import CONFIG


def request(url, payload=None, expected=200):
    """Require an expected HTTP status from an isolated local service."""
    data = None if payload is None else json.dumps(payload).encode()
    req = Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        response = urlopen(req, timeout=5)
    except HTTPError as exc:
        response = exc
    with response:
        result = json.loads(response.read())
        if response.status != expected:
            raise RuntimeError(
                f"{url}: expected {expected}, got {response.status}: {result}"
            )
        return result


def ready(process, url):
    """Wait for a real health response, failing if the owned service exits."""
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Service exited before readiness: {url}")
        try:
            if request(url).get("status") == "up":
                return
        except (URLError, TimeoutError, RuntimeError):
            pass
        time.sleep(0.1)
    raise TimeoutError(f"Service did not become ready: {url}")


def stop(process):
    """Stop only a child process owned by this check and reap its exit status."""
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def check_forecast(forecast):
    """Check every independently trained output is finite and present."""
    assert forecast["short"]["minutes"] == 5
    assert math.isfinite(forecast["short"]["point"])
    assert [p["minutes"] for p in forecast["medium"]] == [5, 15, 30, 45, 60]
    assert all(math.isfinite(p["point"]) for p in forecast["medium"])
    assert [(b["window_start_h"], b["window_end_h"]) for b in forecast["long"]] == [
        (4 * i, 4 * (i + 1)) for i in range(6)
    ]
    assert all(
        math.isfinite(b[k]) for b in forecast["long"] for k in ("min_q10", "max_q90")
    )


def main():
    """Run real local integrations, persist the outcome, and clean up children."""
    config, started = CONFIG["integration"], time.monotonic()
    logs = Path(tempfile.mkdtemp(prefix="glucoloop-integration-"))
    report = {"checks": [], "mock_chat": True, "log_directory": str(logs)}
    children, handles = [], []
    try:
        node = shutil.which("node")
        if not node:
            raise RuntimeError("Node.js is required")
        for port in (config["backend_port"], config["ml_port"]):
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", port))
        backend = f"http://127.0.0.1:{config['backend_port']}"
        ml = f"http://127.0.0.1:{config['ml_port']}"
        report.update(
            local_services={"backend": backend, "ml": ml},
            simulated_minutes=config["stream_minutes"],
        )

        def start(name, command, env):
            handle = (logs / f"{name}.log").open("w")
            handles.append(handle)
            child = subprocess.Popen(
                command, env=env, stdout=handle, stderr=subprocess.STDOUT
            )
            children.append(child)
            return child

        ml_process = start(
            "ml",
            [sys.executable, str(ROOT / "services/ml/predict_api.py")],
            {"PORT": str(config["ml_port"])},
        )
        backend_process = start(
            "backend",
            [node, str(ROOT / "services/backend/src/server.js")],
            {
                "PORT": str(config["backend_port"]),
                "ML_URL": ml,
                "NODE_ENV": "test",
                "RECO_INTERVAL_S": "0",
                "PROACTIVE_CHAT_INTERVAL_S": "0",
            },
        )
        ready(ml_process, ml + "/health")
        ready(backend_process, backend + "/health")
        assert request(backend + "/health")["agent_mode"] == "mock"
        stream_log = (logs / "stream.log").open("w")
        handles.append(stream_log)
        subprocess.run(
            [
                sys.executable,
                str(ROOT / "services/simulator/live_stream.py"),
                "--backend",
                backend,
                "--patient",
                "integration-test",
                "--duration",
                str(config["stream_minutes"]),
                "--accel",
                str(config["acceleration"]),
            ],
            env={},
            stdout=stream_log,
            stderr=subprocess.STDOUT,
            check=True,
            timeout=60,
        )
        state_url, forecast_url = (
            backend + "/state/integration-test",
            backend + "/forecast/integration-test",
        )
        state = request(state_url)
        assert len(state["history"]) >= 12
        assert state["latest"]["t"] == config["stream_minutes"] // 5 * 5
        patients = request(backend + "/metrics")["store"]["patients"]
        patient = next(p for p in patients if p["patient_id"] == "integration-test")
        assert patient["readings_count"] == config["stream_minutes"] // 5
        check_forecast(request(forecast_url))
        report["checks"].append("real_stream_and_complete_forecast")
        chat = request(
            backend + "/chat/integration-test", {"message": "I slept 7.5 hours"}
        )
        assert {"log_checkin", "predict"} <= set(chat["toolCalls"])
        state = request(state_url)
        assert state["checkin"]["sleep_hours"] == 7.5
        check_forecast(state["forecast"])
        report["checks"].append("mock_chat_checkin_updates_forecast")
        reading = copy.deepcopy(state["latest"])
        for quality, glucose in (("drift", 150.0), ("dropout", None)):
            for _ in range(12):
                reading["t"] += 5
                reading["cgm"].update(cgm_quality=quality, glucose_mgdl=glucose)
                request(backend + "/ingest", reading)
            assert request(state_url)["latest"]["cgm"]["cgm_quality"] == quality
            if quality == "drift":
                forecast = request(forecast_url)
                check_forecast(forecast)
                report["observed_drift_action"] = forecast["action"]["class"]
            else:
                request(forecast_url, expected=502)
            report["checks"].append(f"{quality}_path")
        # Restore usable data so the next failure is caused by stopping ML,
        # rather than by the preceding deliberately empty sensor window.
        for _ in range(12):
            reading["t"] += 5
            reading["cgm"].update(cgm_quality="ok", glucose_mgdl=120.0)
            request(backend + "/ingest", reading)
        check_forecast(request(forecast_url))
        stop(ml_process)
        request(forecast_url, expected=502)
        report["checks"].append("ml_unavailable_returns_502")
        report.update(
            status="passed", failure_handling="dropout and stopped ML return 502"
        )
    except (
        AssertionError,
        OSError,
        ValueError,
        RuntimeError,
        KeyError,
        subprocess.SubprocessError,
    ) as exc:
        report.update(status="failed", error=f"{type(exc).__name__}: {exc}")
    finally:
        for process in reversed(children):
            stop(process)
        for handle in handles:
            handle.close()
        report["elapsed_seconds"] = round(time.monotonic() - started, 3)
        destination = ROOT / "docs/INTEGRATION.json"
        destination.parent.mkdir(exist_ok=True)
        destination.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report, indent=2))
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
