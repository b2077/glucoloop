"""GlucoLoop ML predict service.

POST /predict
    {"patient_id": "...", "readings": [ {t|minute_of_dad, glucose_mgdl, ...}, ... ]}
    -> {"short", "medium", "long", "action", "model_version"}

Run (preferred):   uvicorn predict_api:app --port 8101
Run (zero deps):   python predict_api.py          (http.server fallback)
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import numpy as np
import joblib

from features import features_from_window

ART = Path(__file__).resolve().parent / "artifacts"
MODEL_NAMES = ["t5", "t15", "t30", "t45", "t60"]


class Predictor:
    def __init__(self):
        self.points = {n: joblib.load(ART / f"point_{n}.joblib") for n in MODEL_NAMES}
        self.blocks = {}
        for b in range(6):
            for stat in ("min", "max"):
                f = ART / f"block_{b}_{stat}.joblib"
                if f.exists():
                    self.blocks[(b, stat)] = joblib.load(f)
        self.action = joblib.load(ART / "action_policy.joblib")
        self.meta = json.loads((ART / "meta.json").read_text())

    def predict(self, payload: dict) -> dict:
        win = payload.get("readings") or []
        fv = features_from_window(win[-12:])
        if fv is None:
            raise ValueError("no usable readings in window")
        row = np.array([fv], dtype=float)

        short = float(self.points["t5"].predict(row)[0])
        medium = [{"minutes": 5, "point": round(short, 1)}]
        for n, mins in zip(MODEL_NAMES[1:], [15, 30, 45, 60]):
            medium.append({"minutes": mins, "point": round(float(self.points[n].predict(row)[0]), 1)})

        long_blocks = []
        for b in range(6):
            if (b, "min") not in self.blocks:
                continue
            q10 = float(self.blocks[(b, "min")].predict(row)[0])
            q90 = float(self.blocks[(b, "max")].predict(row)[0])
            long_blocks.append({
                "window_start_h": 4 * b, "window_end_h": 4 * (b + 1),
                "min_q10": round(q10, 1), "max_q90": round(q90, 1),
                "risk": "high" if q10 < 75 or q90 > 220 else "normal",
            })

        proba = self.action.predict_proba(row)[0]
        idx = int(np.argmax(proba))
        action = {
            "class": str(self.action.classes_[idx]),
            "probs": {str(c): round(float(p), 3) for c, p in zip(self.action.classes_, proba)},
        }
        return {"short": {"minutes": 5, "point": round(short, 1)},
                "medium": medium, "long": long_blocks,
                "action": action, "model_version": "draft-1"}


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
    _serve_stdlib(int(os.environ.get("PORT", 8101)))
