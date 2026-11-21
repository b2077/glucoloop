"""Live device streamer: simulates one patient in (accelerated) real time and
POSTs readings to the backend ingest endpoint.

Demo fault plan (defaults):
    t=600..720   CGM drift      -> "do you trust your sensor?"
    t=1500..1620 pump occlusion -> insulin deficit, agent alarms
    t=2100..2160 CGM dropout    -> agent cross-validates via chat

Usage:
    python live_stream.py --backend http://localhost:8100 --patient demo-001 --accel 60
"""
from __future__ import annotations

import argparse
import json
import time
import urllib.request

from physiology import Fault, random_scenario, Patient

DEMO_FAULTS = [
    Fault("cgm_drift", 600, 720, 1.2),
    Fault("pump_occlusion", 1500, 1620, 1.0),
    Fault("cgm_dropout", 2100, 2160, 1.0),
]


def post(url: str, payload: dict):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"},
                                 method="POST")
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.loads(r.read().decode())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--backend", default="http://localhost:8100")
    ap.add_argument("--patient", default="demo-001")
    ap.add_argument("--accel", type=float, default=60.0, help="sim minutes per real second")
    ap.add_argument("--duration", type=int, default=2880, help="sim minutes to stream")
    ap.add_argument("--seed", type=int, default=4242)
    a = ap.parse_args()

    sc = random_scenario(a.seed, days=3)
    extra = [f for f in sc.faults if f.kind == "pump_leakage"][:2]
    sc.faults = sorted([*DEMO_FAULTS, *extra], key=lambda f: f.start_min)
    p = Patient(sc)

    print(f"streaming {a.patient} -> {a.backend} (accel={a.accel}x)")
    print(f"fault plan: {[(f.kind, f.start_min // 60, f.end_min // 60) for f in sc.faults]}")
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
            note = "" if row["pump_status"] == "ok" and row["cgm_quality"] == "ok" \
                else f"  <-- {row['cgm_quality']}/{row['pump_status']}"
            print(f"t={row['t']:5d} cgm={row['cgm_glucose']} true={row['true_glucose']:6.1f} "
                  f"iob={row['iob']:4.2f} basal={row['commanded_basal']:3.1f} "
                  f"-> {res.get('status')}{note}")
        except Exception as exc:
            print(f"t={row['t']:5d} backend unreachable ({exc})")
        time.sleep(interval)
    print("stream complete.")


if __name__ == "__main__":
    main()
