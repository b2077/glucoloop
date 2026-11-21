# Model metrics (draft)

Evaluation on held-out scenarios (heavy fault injection).

## Glucose point forecast error

| Horizon | Eval MAE (mg/dL) |
|---|---|
| t5 | 1.5 |
| t15 | 2.1 |
| t30 | 2.7 |
| t45 | 3.5 |
| t60 | 3.8 |

## Pump action policy (5-class)

- Eval accuracy: **94.6%**

```
pred          alarm_only  correction_bolus  no_op  reduce_basal  suspend
true                                                                    
alarm_only           383                 2     12             0        0
no_op                 22                41   3949            73        1
reduce_basal           0                 1    123           505        0
```

## Long-range envelope (24 h, q10 of block min / q90 of block max)

```
{
 "block0_min": 5.0,
 "block0_max": 15.9,
 "block1_min": 6.2,
 "block1_max": 32.7,
 "block2_min": 6.5,
 "block2_max": 38.8,
 "block3_min": 6.6,
 "block3_max": 37.0,
 "block4_min": 7.2,
 "block4_max": 32.1,
 "block5_min": 7.7,
 "block5_max": 41.0
}
```
