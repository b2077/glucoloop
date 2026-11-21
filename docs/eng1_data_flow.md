# Eng 1 → Eng 3 data flow

The simulator output is the training data for the ML forecaster.

```
simulator (Eng 1)  →  labeled dataset  →  ML forecaster (Eng 3)
```

## Steps

1. **`generate_dataset.py`** runs random scenarios through `Patient` / `run_scenario()` (`services/simulator/`).
2. Each 5-minute row is labeled with future targets:
   - `f_g_t5 / f_g_t15 / f_g_t30 / f_g_t45 / f_g_t60` — true glucose at each horizon
   - `b0..b5_min / b0..b5_max` — 24 h envelope (per 4 h block)
   - `action_label` — 5-class expert pump policy
3. Writes `train.csv` / `eval.csv` (+ manifests) to `data/generated/`.
4. **`services/ml/`** (Eng 3) trains on those CSVs:
   - point forecasters (t+5..60 min), HistGradientBoosting regression
   - long-range envelope (quantile regression)
   - pump action policy (HistGradientBoosting classifier)

## Key nuance

Labels come from an **expert policy that saw the true simulated future**. At inference the ML models only see features available in real time — the simulator's ground-truth trajectory is what makes those labels possible.
