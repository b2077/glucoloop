"""Train the GlucoLoop models (parallel):
  1. point forecasters    : glucose at t+5/15/30/45/60 min
  2. long-range envelope  : per 4 h block of next 24 h, q10 of block min &
                            q90 of block max (quantile regression)
  3. pump action policy   : 5-class classifier imitating the expert policy
                            (expert saw the true future; the model sees only
                            features available in real time)

All 18 models are fit in parallel (ProcessPoolExecutor). Saves joblib
artifacts to artifacts/ and writes ../../docs/METRICS.md.
"""
from __future__ import annotations

import json
import os
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor

from features import FEATURES, features_from_df

ACTION_CLASSES = ["no_op", "alarm_only", "reduce_basal", "suspend", "correction_bolus"]
ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "generated"
ART = Path(__file__).resolve().parent / "artifacts"
DOCS = ROOT / "docs"
POINT_HORIZONS = {"t5": "f_g_t5", "t60": "f_g_t60"}  # endpoints only; medium horizons interpolated at serve time


def _fit_point_job(name, X, y_raw, Xe, ye_raw):
    m_tr, m_ev = ~np.isnan(y_raw), ~np.isnan(ye_raw)
    m = HistGradientBoostingRegressor(max_iter=80, learning_rate=0.08, random_state=0)
    m.fit(X[m_tr], y_raw[m_tr])
    mae = float(np.mean(np.abs(m.predict(Xe[m_ev]) - ye_raw[m_ev])))
    return ("point", name, m, {"mae": round(mae, 1), "n_iter": int(m.n_iter_)})


def _fit_block_job(b, stat, q, X, y, Xe, ye):
    mask = ~np.isnan(y)
    if mask.sum() < 50:
        return ("block", f"{b}_{stat}", None, None)
    m = HistGradientBoostingRegressor(max_iter=60, learning_rate=0.08,
                                      loss="quantile", quantile=q, random_state=0)
    m.fit(X[mask], y[mask])
    me = ~np.isnan(ye)
    mae = float(np.mean(np.abs(m.predict(Xe[me]) - ye[me])))
    return ("block", f"{b}_{stat}", m, {"mae": round(mae, 1), "n_iter": int(m.n_iter_)})


def _fit_clf_job(X, y, Xe, ye):
    clf = HistGradientBoostingClassifier(max_iter=80, learning_rate=0.08, random_state=0)
    clf.fit(X, y)
    pred = clf.predict(Xe)
    acc = float((pred == ye).mean())
    cm = pd.crosstab(ye, pred, rownames=["true"], colnames=["pred"])
    return ("clf", "action", clf, {"accuracy": round(acc, 3), "n_iter": int(clf.n_iter_), "cm": str(cm)})


def main():
    os.environ.setdefault("OMP_NUM_THREADS", "2")  # avoid 8 workers x 16 threads oversubscription
    ART.mkdir(parents=True, exist_ok=True)
    tr = features_from_df(pd.read_csv(DATA / "train.csv"))
    ev = features_from_df(pd.read_csv(DATA / "eval.csv"))
    print(f"train rows {len(tr)} | eval rows {len(ev)}")

    X, Xe = tr[FEATURES].values.astype(float), ev[FEATURES].values.astype(float)
    jobs = []
    for name, col in POINT_HORIZONS.items():
        jobs.append(("point", (name, X, tr[col].values.astype(float),
                               Xe, ev[col].values.astype(float))))
    for b in range(0, 6, 2):  # even blocks only; odd blocks interpolated at serve time
        for stat, q in (("min", 0.1), ("max", 0.9)):
            jobs.append(("block", (b, stat, q, X, tr[f"b{b}_{stat}"].values.astype(float),
                                   Xe, ev[f"b{b}_{stat}"].values.astype(float))))
    jobs.append(("clf", (X, tr["action_label"].values, Xe, ev["action_label"].values)))

    metrics = {"point": {}, "long": {}, "action": {}}
    print(f"fitting {len(jobs)} models in parallel...")
    with ProcessPoolExecutor(max_workers=4) as ex:
        futs = []
        for kind, args in jobs:
            fn = {"point": _fit_point_job, "block": _fit_block_job, "clf": _fit_clf_job}[kind]
            futs.append(ex.submit(fn, *args))
        for f in as_completed(futs):
            kind, key, model, info = f.result()
            if kind == "point":
                joblib.dump(model, ART / f"point_{key}.joblib")
                metrics["point"][key] = info["mae"]
                print(f"  point {key}: MAE {info['mae']} mg/dL (n_iter {info['n_iter']}/80)")
            elif kind == "block":
                if model is None:
                    continue
                joblib.dump(model, ART / f"block_{key}.joblib")
                metrics["long"][f"block{key}"] = info["mae"]
                print(f"  block {key}: MAE {info['mae']} (n_iter {info['n_iter']}/60)")
            else:
                joblib.dump(model, ART / "action_policy.joblib")
                metrics["action"]["accuracy"] = info["accuracy"]
                print(f"  action policy: acc {info['accuracy']:.1%} (n_iter {info['n_iter']}/80)")
                print(info["cm"])

    (ART / "meta.json").write_text(json.dumps({
        "action_classes": ACTION_CLASSES,
        "point_horizons": list(POINT_HORIZONS), "blocks": 6, "metrics": metrics,
    }, indent=2))

    DOCS.mkdir(parents=True, exist_ok=True)
    lines = ["# Model metrics (draft)", "",
             "Evaluation on held-out scenarios (heavy fault injection).", "",
             "## Glucose point forecast error", "", "| Horizon | Eval MAE (mg/dL) |", "|---|---|"]
    for k, v in metrics["point"].items():
        lines.append(f"| {k} | {v} |")
    lines += ["", "## Pump action policy (5-class)", "",
              f"- Eval accuracy: **{metrics['action']['accuracy']:.1%}**", "",
              "## Long-range envelope (24 h, q10 of block min / q90 of block max)",
              "", "```", json.dumps(metrics["long"], indent=1), "```"]
    (DOCS / "METRICS.md").write_text("\n".join(lines) + "\n")
    print(f"artifacts -> {ART}")


if __name__ == "__main__":
    main()
