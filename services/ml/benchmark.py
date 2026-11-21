"""Measure real local HTTP prediction latency using the saved eighteen models.

Install services/ml/requirements.txt and train first. From services/ml, run
`python benchmark.py`. The script starts an isolated local prediction service,
writes docs/LATENCY.json, and stops only the service it started. No paid APIs
are called. Request counts, port and the local latency target are in config.toml.
"""

import json
import math
import platform
import subprocess
import sys
import tempfile
from pathlib import Path
from time import perf_counter, sleep
from urllib.error import URLError
from urllib.request import Request, urlopen

from settings import CONFIG


def main():
    """Check complete forecast responses and time sequential HTTP requests."""
    settings = CONFIG["benchmark"]
    base = f"http://127.0.0.1:{settings['port']}"
    payload = json.dumps(
        {
            "readings": [
                {
                    "t": i * 5,
                    "glucose_mgdl": 110 + i,
                    "cgm_quality": "ok",
                    "pump_status": "ok",
                    "activity": "none",
                }
                for i in range(12)
            ]
        }
    ).encode()
    started = perf_counter()
    with tempfile.TemporaryFile() as output:
        process = subprocess.Popen(
            [sys.executable, str(Path(__file__).with_name("predict_api.py"))],
            env={"PORT": str(settings["port"])},
            stdout=output,
            stderr=output,
        )
        try:
            while True:
                if process.poll() is not None:
                    raise RuntimeError(
                        "Benchmark service exited; check the port is free"
                    )
                try:
                    with urlopen(base + "/health", timeout=2) as response:
                        assert json.load(response)["status"] == "up"
                    break
                except URLError:
                    if perf_counter() - started > 30:
                        raise TimeoutError(
                            "Benchmark service did not become healthy"
                        ) from None
                    sleep(0.05)
            cold_ms = (perf_counter() - started) * 1000
            elapsed = []
            total = settings["warmup_requests"] + settings["measured_requests"]
            for i in range(total):
                before = perf_counter()
                request = Request(
                    base + "/predict",
                    data=payload,
                    headers={"Content-Type": "application/json"},
                )
                with urlopen(request, timeout=5) as response:
                    result = json.load(response)
                duration = (perf_counter() - before) * 1000
                assert [r["minutes"] for r in result["medium"]] == CONFIG["models"][
                    "forecast_minutes"
                ]
                assert len(result["long"]) == CONFIG["models"]["block_count"]
                assert result["long"][-1]["window_end_h"] == 24
                assert all(math.isfinite(r["point"]) for r in result["medium"])
                assert all(
                    math.isfinite(r[k])
                    for r in result["long"]
                    for k in ("min_q10", "max_q90")
                )
                if i >= settings["warmup_requests"]:
                    elapsed.append(duration)
            ordered = sorted(elapsed)
            report = {
                "models": 18,
                "requests": len(elapsed),
                "failures": 0,
                "warmup_requests": settings["warmup_requests"],
                "cold_start_ms": round(cold_ms, 2),
                "python": platform.python_version(),
                "platform": platform.platform(),
                "prediction_threads": CONFIG["runtime"]["prediction_threads"],
                "target_p95_ms": settings["target_p95_ms"],
                "workload": "Sequential HTTP requests on localhost; synthetic 12-reading window",
            }
            for label, percentile in (
                ("p50_ms", 0.5),
                ("p95_ms", 0.95),
                ("p99_ms", 0.99),
            ):
                report[label] = round(
                    ordered[math.ceil(len(ordered) * percentile) - 1], 2
                )
            report["max_ms"] = round(max(elapsed), 2)
            path = Path(__file__).resolve().parents[2] / "docs" / "LATENCY.json"
            path.write_text(json.dumps(report, indent=2) + "\n")
            print(json.dumps(report, indent=2))
            if report["p95_ms"] > settings["target_p95_ms"]:
                raise RuntimeError(
                    "Local prediction latency exceeded the configured target"
                )
        finally:
            process.terminate()
            process.wait(timeout=5)


if __name__ == "__main__":
    main()
