"""Frozen feature builder for GlucoLoop — SINGLE SOURCE OF TRUTH.
Used by both train.py and predict_api.py so features can never drift.

Feature vector (frozen at kickoff):
    g0..g11   last 12 CGM readings (60 min, forward-filled through dropouts)
    roc15     glucose rate of change over 15 min
    iob       insulin on board (units)
    basal_cmd commanded basal rate (U/hr)
    hr        heart rate (bpm)
    activity  0 none / 1 light / 2 moderate / 3 intense
    tod_sin, tod_cos  time of day (cyclic)
    carbs3h   check-in: carbs last 3 h (g)       <- conversational check-in
    ex2h      check-in: exercise last 2 h (min)  <- conversational check-in
    sleeph    check-in: last night's sleep (h)   <- conversational check-in
    stress    check-in: stress 1..5              <- conversational check-in
    cgm_flag  1 if CGM drift/dropout within last 15 min
    pump_flag 1 if pump fault within last 15 min
"""
from __future__ import annotations

import math
from typing import Optional

import numpy as np
import pandas as pd

FEATURES = [
    *[f"g{i}" for i in range(12)],
    "roc15", "iob", "basal_cmd", "hr", "activity", "tod_sin", "tod_cos",
    "carbs3h", "ex2h", "sleeph", "stress", "cgm_flag", "pump_flag",
]

_ACTIVITY = {"none": 0, "light": 1, "moderate": 2, "intense": 3}


def _ffill(v):
    out, last = [], None
    for x in v:
        if x is None or (isinstance(x, float) and math.isnan(x)):
            out.append(last)
        else:
            last = x
            out.append(x)
    return out


def _num_or_none(x):
    if x is None:
        return None
    try:
        v = float(x)
        return None if math.isnan(v) else v
    except (TypeError, ValueError):
        return None


def features_from_window(win: list[dict]) -> Optional[list[float]]:
    """Serving path: newest-last window (>=1 rows) of 5-min step dicts with keys
    glucose_mgdl, cgm_quality, hr, activity, iob, commanded_basal, pump_status,
    carbs_g_3h, exercise_min_2h, sleep_hours_last, stress_1_5, t|minute_of_day."""
    if not win:
        return None
    g = _ffill([_num_or_none(r.get("glucose_mgdl")) for r in win])
    g = [x for x in g if x is not None]
    if not g:
        return None
    while len(g) < 12:
        g = [g[0]] + g
    g = g[-12:]
    gg = g[::-1]

    last = win[-1]
    num = lambda k, d: float(last.get(k) if last.get(k) is not None else d)
    recent = win[-3:]
    cgm_flag = int(any(r.get("cgm_quality") in ("drift", "dropout") for r in recent))
    pump_flag = int(any(r.get("pump_status") != "ok" for r in recent))
    mod = int(last.get("minute_of_day", last.get("t", 0)) % 1440)
    return [
        *gg,
        (g[-1] - g[-4]) if len(g) >= 4 else 0.0,
        num("iob", 0.0), num("commanded_basal", 1.0), num("hr", 70.0),
        float(_ACTIVITY.get(last.get("activity", "none"), 0)),
        math.sin(2 * math.pi * mod / 1440.0),
        math.cos(2 * math.pi * mod / 1440.0),
        num("carbs_g_3h", 0.0), num("exercise_min_2h", 0.0),
        num("sleep_hours_last", 7.0), num("stress_1_5", 1.0),
        cgm_flag, pump_flag,
    ]


def features_from_df(df: pd.DataFrame) -> pd.DataFrame:
    """Training path: vectorized builder, generate_dataset column names."""
    rows = []
    for sid, grp in df.groupby("scenario_id"):
        grp = grp.sort_values("t").reset_index(drop=True)
        g = grp["cgm_glucose"].ffill().bfill()
        f = pd.DataFrame({f"g{i}": g.shift(i) for i in range(12)}).bfill()
        f["roc15"] = g - g.shift(3)
        f["iob"] = grp["iob"]
        f["basal_cmd"] = grp["commanded_basal"]
        f["hr"] = grp["hr"]
        f["activity"] = grp["activity"].map(_ACTIVITY)
        mod = grp["minute_of_day"].astype(float)
        f["tod_sin"] = np.sin(2 * np.pi * mod / 1440.0)
        f["tod_cos"] = np.cos(2 * np.pi * mod / 1440.0)
        f["carbs3h"] = grp["carbs_g_3h"]
        f["ex2h"] = grp["exercise_min_2h"]
        f["sleeph"] = grp["sleep_hours_last"]
        f["stress"] = grp["stress_1_5"]
        bad_cgm = (grp["cgm_quality"] != "ok").astype(int)
        bad_pump = (grp["pump_status"] != "ok").astype(int)
        f["cgm_flag"] = bad_cgm.rolling(3, min_periods=1).max().astype(int)
        f["pump_flag"] = bad_pump.rolling(3, min_periods=1).max().astype(int)
        f["scenario_id"] = sid
        for c in ("action_label", "t", "f_g_t5", "f_g_t15", "f_g_t30", "f_g_t45",
                  "f_g_t60", *[f"b{i}_{s}" for i in range(6) for s in ("min", "max")]):
            f[c] = grp[c].values if c in grp.columns else np.nan
        rows.append(f.iloc[12:])   # skip first hour (insufficient history)
    return pd.concat(rows, ignore_index=True)
