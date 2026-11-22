# Model metrics (draft)

Evaluation on held-out scenarios (heavy fault injection).
Training/evaluation: 20318 / 5041 usable rows; 24 / 6 disjoint scenarios.
Excluded empty sensor windows after warmup: 130 training / 71 evaluation. Serving rejects these windows too.
Training and evaluation elapsed: 1.816 seconds.

## Glucose point forecast error

| Horizon | Eval MAE (mg/dL) |
|---|---|
| t5 | 1.5 |
| t15 | 2.1 |
| t30 | 2.8 |
| t45 | 3.6 |
| t60 | 3.9 |

## Pump action policy (5-class)

- Eval accuracy: **95.4%**
- Trained classes: alarm_only, correction_bolus, no_op, reduce_basal, suspend
- Missing training classes: none

```
pred          alarm_only  correction_bolus  no_op  reduce_basal
true
alarm_only           314                 5      6             1
no_op                 22                 6   3975            83
reduce_basal           1                 0    107           521
```

## Long-range envelope (24 h, q10 of block min / q90 of block max)

```
{
 "block0_max": 15.1,
 "block1_min": 6.7,
 "block0_min": 5.8,
 "block1_max": 35.3,
 "block2_max": 44.1,
 "block3_min": 7.7,
 "block2_min": 7.4,
 "block4_min": 8.0,
 "block3_max": 40.8,
 "block4_max": 33.0,
 "block5_min": 8.6,
 "block5_max": 43.1
}
```
