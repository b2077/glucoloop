"""Scripted "predicted low" scenario streamer for GlucoLoop.

Streams a deterministic downward glucose crash into the backend's
POST /ingest (same payload shape as services/simulator/live_stream.py), so
the predicted-low watcher (low_watch.py) has something real to catch:

    t=60        patient eats a very large meal (250 g carbs) — the naive
                controller boluses carbs/20 = 12.5 U while the true carb
                ratio varies +/-25% per patient
    t=240..360  intense exercise, no further food
    ~t=125      true glucose crosses below 70 mg/dL; the ML point forecasts
                (services/ml artifacts) cross below 70 mg/dL at about the
                same time and the pump policy flips to "suspend"

Verified against the trained models (seed=7): forecast minimum drops below
70 mg/dL at t=125 (short 68.8, medium min 68) while true glucose is 69.3.

Usage:
    python drive_low.py --backend http://localhost:8100 --patient demo-001 --accel 60

Requires numpy (same as services/simulator). Zero other deps.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "simulator"))

from physiology import Exercise, Meal, Patient, Scenario, Sleep  # noqa: E402


def low_crash_scenario(seed: int = 7, meal_t: int = 60, meal_g: float = 250.0) -> Scenario:
    """Deterministic scenario: one huge meal (over-bolus) + late intense
    exercise with no corrective food -> glucose crashes below 70 mg/dL."""
    return Scenario(
        seed=seed,
        days=1,
        faults=[],  # no device faults: the low is physiological, not a sensor artifact
        meals=[Meal(t=meal_t, carbs_g=meal_g)],
        exercises=[Exercise(t=240, duration_min=120, intensity=1.0)],
        stresses=[],
        sleeps=[Sleep(start_min=1380, end_min=1860, quality=0.9)],
    )


def post(url: str, payload: dict):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"},
                                 method="POST")
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.loads(r.read().decode())


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--backend", default="http://localhost:8100")
    ap.add_argument("--patient", default="demo-001")
    ap.add_argument("--accel", type=float, default=60.0, help="sim minutes per real second")
    ap.add_argument("--duration", type=int, default=480, help="sim minutes to stream")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--meal-t", type=int, default=60, help="sim minute of the big meal")
    ap.add_argument("--meal-g", type=float, default=250.0, help="carbs of the big meal")
    a = ap.parse_args()

    sc = low_crash_scenario(seed=a.seed, meal_t=a.meal_t, meal_g=a.meal_g)
    p = Patient(sc)

    print(f"scenario 'predicted low' streaming {a.patient} -> {a.backend} (accel={a.accel}x)")
    print(f"plan: meal {a.meal_g:g}g @t={a.meal_t} (bolus {a.meal_g / 20:.1f} U), "
          f"exercise t=240..360 intensity 1.0, expected crash below 70 mg/dL ~t=125")
    interval = 5.0 / a.accel
    for _ in range(a.duration // 5):
        row = p.step()
        payload = {
            "patient_id": a.patient, "type": "cgm", "t": row["t"],
            "cgm": {"glucose_mgdl": row["cgm_glucose"], "cgm_quality": row["cgm_quality"],
                    "hr": row["hr"], "activity": row["activity"]},
            "pump": {"iob_units": row["iob"], "commanded_basal_u_hr": row["commanded_basal"],
                     "delivered_basal_u_hr": row["delivered_basal"],
                     "pump_status": row["pump_status"]},
        }
        try:
            res = post(f"{a.backend}/ingest", payload)
            low = "  <-- LOW" if row["cgm_glucose"] is not None and row["cgm_glucose"] < 70 else ""
            print(f"t={row['t']:5d} cgm={row['cgm_glucose']} true={row['true_glucose']:6.1f} "
                  f"iob={row['iob']:4.2f} basal={row['commanded_basal']:3.1f} "
                  f"-> {res.get('status')}{low}")
        except Exception as exc:
            print(f"t={row['t']:5d} backend unreachable ({exc})")
        time.sleep(interval)
    print("scenario stream complete.")


if __name__ == "__main__":
    main()
