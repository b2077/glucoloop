"""Train the GlucoLoop models (parallel):
  1. point forecasters    : glucose at t+5/15/30/45/60 min
  2. long-range envelope  : per 4 h block of next 24 h, q10 of block min &
                            q90 of block max (quantile regression)
  3. pump action policy   : 5-class classifier imitating the expert policy
                            (expert saw the true future; the model sees only
                            features available in real time)

All eighteen models are fit in parallel (ProcessPoolExecutor). Saves joblib
artifacts to artifacts/ and writes ../../docs/METRICS.md.
"""

from __future__ import annotations

import json
import os
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from time import perf_counter

import joblib
import numpy as np
import pandas as pd
from features import FEATURES, features_from_df
from settings import CONFIG
from sklearn.ensemble import (
    HistGradientBoostingClassifier,
    HistGradientBoostingRegressor,
)
from threadpoolctl import threadpool_info, threadpool_limits

ACTION_CLASSES = ["no_op", "alarm_only", "reduce_basal", "suspend", "correction_bolus"]
ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "generated"
ART = Path(__file__).resolve().parent / "artifacts"
DOCS = ROOT / "docs"
POINT_HORIZONS = {
    f"t{minutes}": f"f_g_t{minutes}" for minutes in CONFIG["models"]["forecast_minutes"]
}


def _init_worker(threads):
    # Apply after import: OpenMP may already be initialized when workers fork.
    threadpool_limits(limits=threads)
    pools = threadpool_info()
    if any(pool["num_threads"] > threads for pool in pools):
        raise RuntimeError(f"Worker thread limit failed: {pools}")
    print(
        f"worker pid={os.getpid()} thread_limit={threads} "
        f"effective_threads={[p['num_threads'] for p in pools]}",
        flush=True,
    )


def _fit_point_job(name, X, y_raw, Xe, ye_raw):
    m_tr, m_ev = ~np.isnan(y_raw), ~np.isnan(ye_raw)
    m = HistGradientBoostingRegressor(max_iter=80, learning_rate=0.08, random_state=0)
    m.fit(X[m_tr], y_raw[m_tr])
    mae = float(np.mean(np.abs(m.predict(Xe[m_ev]) - ye_raw[m_ev])))
    return ("point", name, m, {"mae": round(mae, 1), "n_iter": int(m.n_iter_)})


def _fit_block_job(b, stat, q, X, y, Xe, ye):
    mask = ~np.isnan(y)
    if mask.sum() < 50:
        raise ValueError(f"Not enough training labels for block {b}/{stat}")
    m = HistGradientBoostingRegressor(
        max_iter=60, learning_rate=0.08, loss="quantile", quantile=q, random_state=0
    )
    m.fit(X[mask], y[mask])
    me = ~np.isnan(ye)
    mae = float(np.mean(np.abs(m.predict(Xe[me]) - ye[me])))
    return ("block", f"{b}_{stat}", m, {"mae": round(mae, 1), "n_iter": int(m.n_iter_)})


def _fit_clf_job(X, y, Xe, ye):
    clf = HistGradientBoostingClassifier(
        max_iter=80, learning_rate=0.08, random_state=0
    )
    clf.fit(X, y)
    pred = clf.predict(Xe)
    acc = float((pred == ye).mean())
    cm = pd.crosstab(ye, pred, rownames=["true"], colnames=["pred"])
    return (
        "clf",
        "action",
        clf,
        {
            "accuracy": round(acc, 3),
            "n_iter": int(clf.n_iter_),
            "cm": "\n".join(line.rstrip() for line in str(cm).splitlines()),
        },
    )


def main():
    started = perf_counter()
    threads = int(
        os.environ.get("OMP_NUM_THREADS", CONFIG["runtime"]["training_threads"])
    )
    if threads < 1:
        raise ValueError("OMP_NUM_THREADS must be a positive integer")
    ART.mkdir(parents=True, exist_ok=True)
    raw_train = pd.read_csv(DATA / "train.csv")
    raw_eval = pd.read_csv(DATA / "eval.csv")
    overlap = set(raw_train["scenario_id"]) & set(raw_eval["scenario_id"])
    if overlap:
        raise ValueError(f"Train/evaluation scenarios overlap: {len(overlap)} IDs")
    tr = features_from_df(raw_train)
    ev = features_from_df(raw_eval)
    print(f"train rows {len(tr)} | eval rows {len(ev)}")

    X, Xe = tr[FEATURES].values.astype(float), ev[FEATURES].values.astype(float)
    jobs = []
    for name, col in POINT_HORIZONS.items():
        jobs.append(
            (
                "point",
                (
                    name,
                    X,
                    tr[col].values.astype(float),
                    Xe,
                    ev[col].values.astype(float),
                ),
            )
        )
    for b in range(CONFIG["models"]["block_count"]):
        for stat, q in (("min", 0.1), ("max", 0.9)):
            jobs.append(
                (
                    "block",
                    (
                        b,
                        stat,
                        q,
                        X,
                        tr[f"b{b}_{stat}"].values.astype(float),
                        Xe,
                        ev[f"b{b}_{stat}"].values.astype(float),
                    ),
                )
            )
    jobs.append(("clf", (X, tr["action_label"].values, Xe, ev["action_label"].values)))

    metrics = {
        "point": {},
        "long": {},
        "action": {},
        "data": {
            "train_rows": len(tr),
            "eval_rows": len(ev),
            "train_scenarios": int(raw_train["scenario_id"].nunique()),
            "eval_scenarios": int(raw_eval["scenario_id"].nunique()),
            "train_empty_windows_excluded": len(raw_train)
            - 12 * raw_train["scenario_id"].nunique()
            - len(tr),
            "eval_empty_windows_excluded": len(raw_eval)
            - 12 * raw_eval["scenario_id"].nunique()
            - len(ev),
        },
    }
    metrics["data"] = {key: int(value) for key, value in metrics["data"].items()}
    print(f"fitting {len(jobs)} models in parallel...")
    with ProcessPoolExecutor(
        max_workers=CONFIG["runtime"]["training_workers"],
        initializer=_init_worker,
        initargs=(threads,),
    ) as ex:
        futs = []
        for kind, args in jobs:
            fn = {
                "point": _fit_point_job,
                "block": _fit_block_job,
                "clf": _fit_clf_job,
            }[kind]
            futs.append(ex.submit(fn, *args))
        for f in as_completed(futs):
            kind, key, model, info = f.result()
            print(
                f"completed {kind}/{key} elapsed={perf_counter() - started:.1f}s",
                flush=True,
            )
            if kind == "point":
                joblib.dump(model, ART / f"point_{key}.joblib")
                metrics["point"][key] = info["mae"]
                print(
                    f"  point {key}: MAE {info['mae']} mg/dL (n_iter {info['n_iter']}/80)"
                )
            elif kind == "block":
                if model is None:
                    continue
                joblib.dump(model, ART / f"block_{key}.joblib")
                metrics["long"][f"block{key}"] = info["mae"]
                print(f"  block {key}: MAE {info['mae']} (n_iter {info['n_iter']}/60)")
            else:
                joblib.dump(model, ART / "action_policy.joblib")
                metrics["action"]["accuracy"] = info["accuracy"]
                metrics["action"]["trained_classes"] = list(model.classes_)
                metrics["action"]["missing_classes"] = sorted(
                    set(ACTION_CLASSES) - set(model.classes_)
                )
                if metrics["action"]["missing_classes"]:
                    print(
                        f"WARNING: untrained action classes: {metrics['action']['missing_classes']}"
                    )
                metrics["action"]["confusion_matrix"] = info["cm"]
                print(
                    f"  action policy: acc {info['accuracy']:.1%} (n_iter {info['n_iter']}/80)"
                )
                print(info["cm"])

    metrics["training_seconds"] = round(perf_counter() - started, 3)
    (ART / "meta.json").write_text(
        json.dumps(
            {
                "action_classes": ACTION_CLASSES,
                "point_horizons": list(POINT_HORIZONS),
                "blocks": CONFIG["models"]["block_count"],
                "metrics": metrics,
            },
            indent=2,
        )
    )

    DOCS.mkdir(parents=True, exist_ok=True)
    lines = [
        "# Model metrics (draft)",
        "",
        "Evaluation on held-out scenarios (heavy fault injection).",
        (
            f"Training/evaluation: {len(tr)} / {len(ev)} usable rows; "
            f"{metrics['data']['train_scenarios']} / {metrics['data']['eval_scenarios']} disjoint scenarios."
        ),
        (
            f"Excluded empty sensor windows after warmup: "
            f"{metrics['data']['train_empty_windows_excluded']} training / "
            f"{metrics['data']['eval_empty_windows_excluded']} evaluation. "
            "Serving rejects these windows too."
        ),
        f"Training and evaluation elapsed: {metrics['training_seconds']} seconds.",
        "",
        "## Glucose point forecast error",
        "",
        "| Horizon | Eval MAE (mg/dL) |",
        "|---|---|",
    ]
    for k in POINT_HORIZONS:
        lines.append(f"| {k} | {metrics['point'][k]} |")
    lines += [
        "",
        "## Pump action policy (5-class)",
        "",
        f"- Eval accuracy: **{metrics['action']['accuracy']:.1%}**",
        f"- Trained classes: {', '.join(metrics['action']['trained_classes'])}",
        f"- Missing training classes: {', '.join(metrics['action']['missing_classes']) or 'none'}",
        "",
        "```",
        metrics["action"]["confusion_matrix"],
        "```",
        "",
        "## Long-range envelope (24 h, q10 of block min / q90 of block max)",
        "",
        "```",
        json.dumps(metrics["long"], indent=1),
        "```",
    ]
    (DOCS / "METRICS.md").write_text("\n".join(lines) + "\n")
    print(f"artifacts -> {ART}")
    print(
        f"training and evaluation finished in {perf_counter() - started:.1f}s",
        flush=True,
    )


if __name__ == "__main__":
    main()
