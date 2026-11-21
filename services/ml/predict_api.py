"""GlucoLoop ML predict service.

POST /predict
    {"patient_id": "...", "readings": [ {t|minute_of_dad, glucose_mgdl, ...}, ... ]}
    -> {"short", "medium", "long", "action", "model_version"}

Run (preferred):   uvicorn predict_api:app --port 8101
Run (zero deps):   python predict_api.py          (http.server fallback)
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path

import joblib
import numpy as np
from features import features_from_window
from settings import CONFIG
from threadpoolctl import threadpool_limits

ART = Path(__file__).resolve().parent / "artifacts"
LOGGER = logging.getLogger(__name__)
MEDIUM_MINUTES = CONFIG["models"]["forecast_minutes"]
MODEL_NAMES = [f"t{minutes}" for minutes in MEDIUM_MINUTES]


class Predictor:
    def __init__(self):
        self.points = {n: joblib.load(ART / f"point_{n}.joblib") for n in MODEL_NAMES}
        self.blocks = {}
        for b in range(CONFIG["models"]["block_count"]):
            for stat in ("min", "max"):
                f = ART / f"block_{b}_{stat}.joblib"
                self.blocks[(b, stat)] = joblib.load(f)
        self.action = joblib.load(ART / "action_policy.joblib")
        self.meta = json.loads((ART / "meta.json").read_text())
        # Loading joblib models initializes sklearn; limit its pools afterwards.
        threadpool_limits(limits=CONFIG["runtime"]["prediction_threads"])

    def predict(self, payload: dict) -> dict:
        win = payload.get("readings") or []
        fv = features_from_window(win[-12:])
        if fv is None:
            raise ValueError("no usable readings in window")
        row = np.array([fv], dtype=float)

        short = float(self.points["t5"].predict(row)[0])
        medium = [
            {
                "minutes": m,
                "point": round(float(self.points[f"t{m}"].predict(row)[0]), 1),
            }
            for m in MEDIUM_MINUTES
        ]

        long_blocks = []
        for b in range(CONFIG["models"]["block_count"]):
            q10 = float(self.blocks[(b, "min")].predict(row)[0])
            q90 = float(self.blocks[(b, "max")].predict(row)[0])
            long_blocks.append(
                {
                    "window_start_h": CONFIG["models"]["block_hours"] * b,
                    "window_end_h": CONFIG["models"]["block_hours"] * (b + 1),
                    "min_q10": round(q10, 1),
                    "max_q90": round(q90, 1),
                    "risk": "high" if q10 < 75 or q90 > 220 else "normal",
                }
            )

        proba = self.action.predict_proba(row)[0]
        idx = int(np.argmax(proba))
        action = {
            "class": str(self.action.classes_[idx]),
            "probs": {
                str(c): round(float(p), 3) for c, p in zip(self.action.classes_, proba)
            },
        }
        return {
            "short": {"minutes": 5, "point": round(short, 1)},
            "medium": medium,
            "long": long_blocks,
            "action": action,
            "model_version": "draft-1",
        }


P = None


def _get_predictor() -> Predictor:
    global P
    if P is None:
        P = Predictor()
    return P


try:
    from fastapi import FastAPI
    from fastapi.responses import JSONResponse

    app = FastAPI(title="GlucoLoop ML", version="draft-1")

    @app.get("/health")
    def health():
        try:
            _get_predictor()
            return {"status": "up", "models": "loaded"}
        except Exception as exc:
            LOGGER.exception("Model health check failed")
            return JSONResponse({"status": "degraded", "error": str(exc)}, 500)

    @app.post("/predict")
    def predict(payload: dict):
        try:
            return _get_predictor().predict(payload)
        except ValueError as exc:
            return JSONResponse({"error": str(exc)}, 400)

except ImportError:
    app = None


def _serve_stdlib(port: int = 8101):
    from http.server import BaseHTTPRequestHandler, HTTPServer

    class H(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/health":
                try:
                    _get_predictor()
                    self._json({"status": "up", "models": "loaded (stdlib mode)"}, 200)
                except Exception as exc:
                    LOGGER.exception("Model health check failed")
                    self._json({"status": "degraded", "error": str(exc)}, 500)
            else:
                self._json({"error": "not found"}, 404)

        def do_POST(self):
            if self.path != "/predict":
                return self._json({"error": "not found"}, 404)
            n = int(self.headers.get("Content-Length", 0))
            try:
                payload = json.loads(self.rfile.read(n))
                self._json(_get_predictor().predict(payload), 200)
            except ValueError as exc:
                self._json({"error": str(exc)}, 400)
            except Exception as exc:
                LOGGER.exception("Prediction request failed")
                self._json({"error": str(exc)}, 500)

        def _json(self, obj, code):
            b = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)

        def log_message(self, *a):
            pass

    print(f"predict service (stdlib) on :{port}")
    HTTPServer(("0.0.0.0", port), H).serve_forever()


if __name__ == "__main__":
    _serve_stdlib(int(os.environ.get("PORT", "8101")))
