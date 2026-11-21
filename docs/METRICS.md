# Model metrics (draft)

Evaluation on held-out scenarios (heavy fault injection).

## Glucose point forecast error

| Horizon | Eval MAE (mg/dL) |
|---|---|
| t5 | 1.5 |
| t15 | 2.1 |
| t30 | 2.8 |
| t45 | 3.6 |
| t60 | 3.9 |

## Pump action policy (5-class)

- Eval accuracy: **95.5%**

```
pred          alarm_only  correction_bolus  no_op  reduce_basal
true                                                           
alarm_only           388                 7      2             0
no_op                 24                 8   3981            73
reduce_basal           0                 1    116           512
```

## Long-range envelope (24 h, q10 of block min / q90 of block max)

```
{
 "block0_min": 4.8,
 "block0_max": 15.7,
 "block1_min": 6.2,
 "block1_max": 33.4,
 "block2_min": 6.5,
 "block2_max": 40.9,
 "block3_min": 6.7,
 "block3_max": 36.3,
 "block4_min": 7.4,
 "block4_max": 32.1,
 "block5_min": 7.5,
 "block5_max": 41.8
}
```
