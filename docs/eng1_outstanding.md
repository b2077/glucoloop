# Eng 1 — Outstanding items

Status of Eng 1 (devices/data/simulator) work. Code is complete, documented, and tested (31/31 tests passing across `test_physiology.py`, `test_live_stream.py`, `test_generate_dataset.py`). What remains is integration validation and optional future hooks.

---

## Open validation items (blocked on other components)

### 1. Stream 3+ hours, verify `/forecast/demo-001` returns all three horizons

| Component | Port | Owner | Role |
|---|---|---|---|
| `services/simulator/live_stream.py` | — | **Eng 1** | Streams data (`--accel 3600`), injects demo faults |
| `services/backend/src/server.js` | 8100 | **Eng 2** | `POST /ingest` receives stream; `GET /forecast/:patient` proxies to ML |
| `services/ml/predict_api.py` | 8101 | **Eng 3** | Returns short (5 min) / medium (15–60 min) / long (24 h) horizons |

Command: `python live_stream.py --backend http://127.0.0.1:8100 --patient demo-001 --accel 3600`, then `GET /forecast/demo-001`.

### 2. Fault beats visible in `/state`

| Component | Port | Owner | Role |
|---|---|---|---|
| `live_stream.py` | — | **Eng 1** | Scripted faults: CGM drift t=600, pump occlusion t=1500, CGM dropout t=2100 |
| `server.js` `GET /state/:patient` | 8100 | **Eng 2** | `store.summary()` — IOB collapse must be visible here |
| `predict_api.py` policy output | 8101 | **Eng 3** | Must classify faults as `alarm_only` |

Expected: drift → `alarm_only`; occlusion → `alarm_only` + IOB collapse in `/state`.

> Eng 4 (mobile app) is **not** required for items 1–2 — only for the separate app-polling checklist item.

---

## Future hooks (only if time remains, per WORK_PLAN.md)

1. Wire real **Dexcom CGM sandbox API** into `live_stream.py`'s place — payload shape already matches what bridges send.
2. Real **HealthKit** integration for watch data (heart rate, activity).
3. No backend contract change needed for either — the simulator already POSTs exactly what real bridges would send.

---

## Done (reference: `eng1_workplan.md`)

- `physiology.py` — Bergman-based model, faults, expert labels; public API in module docstring
- `live_stream.py` / `generate_dataset.py` — verified runnable end-to-end
- `docs/eng1_workplan.md` — full documentation, appendices A–E
- 31 tests, all passing
