"""Train the GlucoLoop models:
  1. point forecasters    : glucose at t+5/15/30/45/60 min
  2. long-range envelope  : per 4 h block of next 24 h, q10 of block min &
                            q90 of block max (quantile regression)
  3. pump action policy   : 5-class classifier imitating the expert policy
                            (expert saw the true future; the model sees only
                            features available in real time)

Saves joblib artifacts to artifacts/ and writes ../../docs/METRICS.md.
"""
from __future__ import annotations

import json
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
POINT_HORIZONS = {"t5": "f_g_t5", "t15": "f_g_t15", "t30": "f_g_t30",
                  "t45": "f_g_t45", "t60": "f_g_t60"}


def fit_point(name, X, y_raw, Xe, ye_raw):
    m_tr, m_ev = ~np.isnan(y_raw), ~np.isnan(ye_raw)
    m = HistGradientBoostingRegressor(max_iter=250, learning_rate=0.08, random_state=0)
    m.fit(X[m_tr], y_raw[m_tr])
    mae = float(np.mean(np.abs(m.predict(Xe[m_ev]) - ye_raw[m_ev])))
    print(f"  point {name}: eval MAE = {mae:.1f} mg/dL")
    return m, mae


def main():
    ART.mkdir(parents=True, exist_ok=True)
    tr = features_from_df(pd.read_csv(DATA / "train.csv"))
    ev = features_from_df(pd.read_csv(DATA / "eval.csv"))
    print(f"train rows {len(tr)} | eval rows {len(ev)}")

    X, Xe = tr[FEATURES].values.astype(float), ev[FEATURES].values.astype(float)
    metrics = {"point": {}, "long": {}, "action": {}}

    print("== point forecasters ==")
    for name, col in POINT_HORIZONS.items():
        m, mae = fit_point(name, X, tr[col].values.astype(float),
                           Xe, ev[col].values.astype(float))
        joblib.dump(m, ART / f"point_{name}.joblib")
        metrics["point"][name] = round(mae, 1)

    print("== long-range envelope ==")
    for b in range(6):
        for stat, q in (("min", 0.1), ("max", 0.9)):
            tgt = f"b{b}_{stat}"
            mask = tr[tgt].notna()
            if mask.sum() < 50:
                continue
            m = HistGradientBoostingRegressor(max_iter=200, learning_rate=0.08,
                                              loss="quantile", quantile=q, random_state=0)
            m.fit(X[mask.values], tr.loc[mask, tgt].values.astype(float))
            joblib.dump(m, ART / f"block_{b}_{stat}.joblib")
            masse = ev[tgt].notna()
            pred = m.predict(Xe[masse.values])
            mae = float(np.mean(np.abs(pred - ev.loc[masse, tgt].values.astype(float))))
            metrics["long"][f"block{b}_{stat}"] = round(mae, 1)
            print(f"  block {b} {stat} (q{q}): eval MAE {mae:.1f}")

    print("== pump action policy ==")
    clf = HistGradientBoostingClassifier(max_iter=250, learning_rate=0.08, random_state=0)
    clf.fit(X, tr["action_label"].values)
    pred = clf.predict(Xe)
    acc = float((pred == ev["action_label"].values).mean())
    metrics["action"]["accuracy"] = round(acc, 3)
    cm = pd.crosstab(ev["action_label"].values, pred, rownames=["true"], colnames=["pred"])
    print(f"  eval accuracy {acc:.1%}\n{cm}")
    joblib.dump(clf, ART / "action_policy.joblib")

    (ART / "meta.json").write_text(json.dumps({
        "action_classes": list(clf.classes_),
        "point_horizons": list(POINT_HORIZONS), "blocks": 6, "metrics": metrics,
    }, indent=2))

    DOCS.mkdir(parents=True, exist_ok=True)
    lines = ["# Model metrics (draft)", "",
             "Evaluation on held-out scenarios (heavy fault injection).", "",
             "## Glucose point forecast error", "", "| Horizon | Eval MAE (mg/dL) |", "|---|---|"]
    for k, v in metrics["point"].items():
        lines.append(f"| {k} | {v} |")
    lines += ["", "## Pump action policy (5-class)", "",
              f"- Eval accuracy: **{acc:.1%}**", "", "```", str(cm), "```", "",
              "## Long-range envelope (24 h, q10 of block min / q90 of block max)",
              "", "```", json.dumps(metrics["long"], indent=1), "```"]
    (DOCS / "METRICS.md").write_text("\n".join(lines) + "\n")
    print(f"artifacts -> {ART}")


if __name__ == "__main__":
    main()
