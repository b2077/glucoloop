# Decisions and assumptions

## 1. 2026-11-21: Local latency acceptance target

**Why:** The request asks to verify latency without specifying a numerical
budget. Use a configurable 100 ms 95th-percentile target for sequential local
HTTP predictions. No production target was supplied or researched.
**Affects:** `config.toml`, `benchmark.py`, `docs/LATENCY.json`.
**Assumptions:** A single local demo client is the relevant workload. Concurrent
clients, chat latency and network transit are outside this measurement.
**Status:** Provisional local validation target; it is not a service guarantee.
