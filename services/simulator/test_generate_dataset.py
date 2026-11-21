"""Tests for generate_dataset.py — build() output files, schema, determinism.

Runs with pytest or standalone (`python test_generate_dataset.py`).
Uses a temp directory; small scenario counts to stay fast.
"""

import json
import tempfile
from pathlib import Path

import pandas as pd

from generate_dataset import build
from physiology import ACTION_CLASSES

EXPECTED_COLS = {
    "t", "minute_of_day", "cgm_glucose", "cgm_quality", "hr", "activity",
    "commanded_basal", "delivered_basal", "iob", "pump_status",
    "carbs_g_3h", "exercise_min_2h", "sleep_hours_last", "stress_1_5",
    "true_glucose", "action_label", "scenario_id",
    "f_g_t5", "f_g_t15", "f_g_t30", "f_g_t45", "f_g_t60",
    "b0_min", "b0_max", "b1_min", "b1_max", "b2_min", "b2_max",
    "b3_min", "b3_max", "b4_min", "b4_max", "b5_min", "b5_max",
}


def _build(tmp, n_train=2, n_eval=1, days=1):
    out = Path(tmp) / "data"
    build(n_train=n_train, n_eval=n_eval, days=days, out=out)
    return out


def test_build_writes_all_files():
    with tempfile.TemporaryDirectory() as tmp:
        out = _build(tmp)
        for name in ("train.csv", "eval.csv", "manifest_train.json", "manifest_eval.json"):
            assert (out / name).exists(), f"missing {name}"


def test_build_row_counts():
    with tempfile.TemporaryDirectory() as tmp:
        out = _build(tmp, n_train=2, n_eval=1, days=1)
        train = pd.read_csv(out / "train.csv")
        ev = pd.read_csv(out / "eval.csv")
        rows_per_scenario = 1440 // 5          # 288 for 1 day
        assert len(train) == 2 * rows_per_scenario
        assert len(ev) == 1 * rows_per_scenario


def test_build_schema_and_labels():
    with tempfile.TemporaryDirectory() as tmp:
        out = _build(tmp, n_train=2, n_eval=1, days=1)
        df = pd.read_csv(out / "train.csv")
        assert EXPECTED_COLS <= set(df.columns)
        assert set(df["action_label"].unique()) <= set(ACTION_CLASSES)
        # future targets: last 12 rows of EACH scenario have None f_g_t60
        assert df["f_g_t60"].isna().sum() == 12 * 2
        # glucose floor respected
        assert df["true_glucose"].min() >= 20.0


def test_build_manifests_match_splits():
    with tempfile.TemporaryDirectory() as tmp:
        out = _build(tmp, n_train=3, n_eval=2)
        mt = json.loads((out / "manifest_train.json").read_text())
        me = json.loads((out / "manifest_eval.json").read_text())
        assert len(mt) == 3 and len(me) == 2
        assert all(k.startswith("train_") for k in mt)
        assert all(k.startswith("eval_") for k in me)
        for man in list(mt.values()) + list(me.values()):
            assert man["days"] == 1
            assert isinstance(man["meals"], int)   # counts, not lists


def test_build_deterministic():
    with tempfile.TemporaryDirectory() as t1, tempfile.TemporaryDirectory() as t2:
        o1 = _build(t1, n_train=1, n_eval=1, days=1)
        o2 = _build(t2, n_train=1, n_eval=1, days=1)
        a = pd.read_csv(o1 / "train.csv")["true_glucose"].tolist()
        b = pd.read_csv(o2 / "train.csv")["true_glucose"].tolist()
        assert a == b


def test_eval_has_heavier_faults_than_train():
    with tempfile.TemporaryDirectory() as tmp:
        out = _build(tmp, n_train=4, n_eval=4, days=1)
        train = pd.read_csv(out / "train.csv")
        ev = pd.read_csv(out / "eval.csv")
        # heavy-fault eval scenarios should produce more alarm_only labels
        train_alarm = (train["action_label"] == "alarm_only").mean()
        eval_alarm = (ev["action_label"] == "alarm_only").mean()
        assert eval_alarm >= train_alarm


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
