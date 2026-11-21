# Model metrics (draft)

Evaluation on held-out scenarios (heavy fault injection).
Training/evaluation: 6709 / 2213 usable rows; 12 / 4 disjoint scenarios.
Excluded empty sensor windows after warmup: 59 training / 43 evaluation. Serving rejects these windows too.
Training and evaluation elapsed: 1.365 seconds.

## Glucose point forecast error

| Horizon | Eval MAE (mg/dL) |
|---|---|
| t5 | 3.8 |
| t15 | 4.4 |
| t30 | 5.7 |
| t45 | 6.7 |
| t60 | 7.5 |

## Pump action policy (5-class)

- Eval accuracy: **90.2%**
- Trained classes: alarm_only, no_op, reduce_basal
- Missing training classes: correction_bolus, suspend

```
pred              alarm_only  no_op  reduce_basal
true
alarm_only               292     46             5
correction_bolus           2      4             0
no_op                     14   1560            20
reduce_basal               0     80           144
suspend                    1     25            20
```

## Long-range envelope (24 h, q10 of block min / q90 of block max)

```
{
 "block0_max": 20.5,
 "block0_min": 5.9,
 "block1_min": 6.4,
 "block1_max": 35.7,
 "block2_min": 6.5,
 "block2_max": 35.7,
 "block3_min": 6.7,
 "block3_max": 30.4,
 "block4_max": 33.8,
 "block4_min": 6.0,
 "block5_min": 6.1,
 "block5_max": 36.2
}
```
