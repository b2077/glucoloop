"""Generate the training/eval dataset for the GlucoLoop ML models.

Usage:
    python generate_dataset.py [--n-train 24] [--n-eval 6] [--days 3] [--out ../../data/generated]
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from physiology import random_scenario, run_scenario


def build(n_train: int, n_eval: int, days: int, out: Path):
    out.mkdir(parents=True, exist_ok=True)
    for split, n, base, heavy in (("train", n_train, 1, False),
                                  ("eval", n_eval, 900, True)):
        rows, manifests = [], {}
        for s in range(n):
            seed = base + s
            sc = random_scenario(seed, days=days, heavy_faults=heavy)
            manifests[f"{split}_{seed}"] = sc.manifest()
            rows.extend(run_scenario(sc))
        df = pd.DataFrame(rows)
        df.to_csv(out / f"{split}.csv", index=False)
        (out / f"manifest_{split}.json").write_text(json.dumps(manifests, indent=2))

        in_range = df["true_glucose"].between(70, 180).mean()
        print(f"{split}: {len(df)} rows x {n} scenarios | in-range(70-180): {in_range:.0%} | "
              f"glucose min/mean/max: {df['true_glucose'].min():.0f}/"
              f"{df['true_glucose'].mean():.0f}/{df['true_glucose'].max():.0f}")
        print("  actions:", df["action_label"].value_counts().to_dict())
    print(f"wrote {out}/train.csv, {out}/eval.csv")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--n-train", type=int, default=24)
    ap.add_argument("--n-eval", type=int, default=6)
    ap.add_argument("--days", type=int, default=3)
    ap.add_argument("--out", type=str, default=str(
        Path(__file__).resolve().parents[2] / "data" / "generated"))
    a = ap.parse_args()
    build(a.n_train, a.n_eval, a.days, Path(a.out))
