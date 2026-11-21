"""Tests for live_stream.py — DEMO_FAULTS, post(), and main() end-to-end.

Runs with pytest or standalone (`python test_live_stream.py`).
Uses a stdlib HTTP server on localhost as a fake backend — no network needed.
"""

import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import live_stream
from live_stream import DEMO_FAULTS, post, main


# ── Fake backend ────────────────────────────────────────────

class FakeBackend:
    """Minimal HTTP server that records POSTed payloads."""

    def __init__(self):
        self.received = []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                length = int(self.headers["Content-Length"])
                body = self.rfile.read(length)
                outer.received.append(json.loads(body))
                resp = json.dumps({"status": "ok"}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)

            def log_message(self, *args):
                pass

        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *exc):
        self.server.shutdown()
        self.server.server_close()

    @property
    def url(self):
        return f"http://127.0.0.1:{self.port}"


# ── Tests ───────────────────────────────────────────────────

def test_demo_faults_plan():
    kinds = [f.kind for f in DEMO_FAULTS]
    assert kinds == ["cgm_drift", "pump_occlusion", "cgm_dropout"]
    assert [(f.start_min, f.end_min) for f in DEMO_FAULTS] == [(600, 720), (1500, 1620), (2100, 2160)]


def test_post_roundtrip():
    with FakeBackend() as be:
        payload = {"patient_id": "t-1", "type": "cgm", "t": 5,
                   "cgm": {"glucose_mgdl": 100}, "pump": {"iob_units": 1.0}}
        res = post(f"{be.url}/ingest", payload)
        assert res == {"status": "ok"}
        assert be.received == [payload]


def test_main_streams_expected_rows():
    with FakeBackend() as be:
        argv = sys.argv
        sys.argv = ["live_stream.py", "--backend", be.url, "--patient", "test-001",
                    "--interval", "0", "--duration", "50", "--seed", "4242"]
        try:
            main()
        finally:
            sys.argv = argv

    # duration 2880 default is overridden to 50 sim-min -> 50/5 = 10 POSTs
    assert len(be.received) == 10
    first = be.received[0]
    assert first["patient_id"] == "test-001"
    assert first["type"] == "cgm"
    assert first["t"] == 5
    assert set(first["cgm"].keys()) == {"glucose_mgdl", "cgm_quality", "hr", "activity"}
    assert set(first["pump"].keys()) == {"iob_units", "commanded_basal_u_hr",
                                         "delivered_basal_u_hr", "pump_status"}
    # t increases by 5 each row
    assert [r["t"] for r in be.received] == [5 * (i + 1) for i in range(10)]


def test_main_injects_demo_faults():
    with FakeBackend() as be:
        argv = sys.argv
        # duration 2200 covers drift (600..720), occlusion (1500..1620); dropout at 2100 not reached
        sys.argv = ["live_stream.py", "--backend", be.url, "--patient", "test-faults",
                    "--interval", "0", "--duration", "2200", "--seed", "4242"]
        try:
            main()
        finally:
            sys.argv = argv

    drift_rows = [r for r in be.received if r["cgm"]["cgm_quality"] == "drift"]
    occl_rows = [r for r in be.received if r["pump"]["pump_status"] == "occlusion"]
    assert len(drift_rows) > 0
    assert len(occl_rows) > 0
    # during occlusion, nothing is delivered
    for r in occl_rows:
        assert r["pump"]["delivered_basal_u_hr"] == 0.0


# ── Standalone runner ───────────────────────────────────────

if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"PASS {fn.__name__}")
        except Exception as exc:
            failed += 1
            print(f"FAIL {fn.__name__}: {type(exc).__name__}: {exc}")
    print(f"\n{len(fns) - failed}/{len(fns)} passed")
    raise SystemExit(1 if failed else 0)
