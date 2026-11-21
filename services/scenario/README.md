# Scenario: predicted low → LLM-initiated warning → response window → protocol

A scripted end-to-end scenario on branch `scenario/predicted-hypo-watch`:

```
drive_low.py ──ingest──> backend :8100 ──/predict──> ML :8101
                              ▲                            │
low_watch.py ──GET /forecast──┘                            ▼
   │  detect predicted min < 70 mg/dL, trending down    forecast
   │  POST /chat [SYSTEM EVENT] ──> Ella (LLM) ──reply───┘
   │  wait response_window_min for a user reply in chat_history
   └─ no reply → POST /chat [SYSTEM EVENT no response] → protocol steps
```

1. **`drive_low.py`** streams a deterministic crash: a 250 g meal at t=60
   (naive controller boluses 12.5 U) + intense exercise at t=240 → true
   glucose crosses 70 mg/dL around t=125, and the trained ML point
   forecasts cross below 70 mg/dL at about the same time (verified against
   `services/ml/artifacts`).
2. **`low_watch.py`** polls `GET /forecast/:patient`. When a predicted point
   within `horizon_min` is below `threshold_mgdl` (default **70 mg/dL**) and
   the trajectory is still falling — confirmed for `confirm_polls`
   consecutive polls — it **initiates a conversation through the LLM**:
   `POST /chat/:patient` with a `[SYSTEM EVENT …]` message. Ella replies
   with what is about to happen (numbers + threshold + pump recommendation)
   and asks the patient to acknowledge; the exchange appears in
   `GET /state/:patient` → `chat_history`, i.e. in the app as an
   unsolicited assistant message. With `MISTRAL_API_KEY` set this is the
   real Mistral agent; without it the mock agent handles the same events
   through the identical tools (`predict`, `send_alert`).
3. **Response window**: the watcher waits `response_window_min`
   (default **30**) for a new user message in `chat_history`.
   `response_window_mode: "sim"` (default) counts minutes on the reading
   clock `t`, so a demo at `--accel 60` experiences "30 minutes" in 30 real
   seconds; `"wall"` counts real minutes.
4. **No response in time** → the watcher POSTs a second
   `[SYSTEM EVENT — no response …]`, so the **LLM agent starts the
   no-response protocol** (warns again, raises a critical alert via
   `send_alert`), and the watcher executes the `protocol` steps from
   `config.low_watch.json`. Steps not implemented yet are logged as
   *deferred — define later* (e.g. `emergency_contact`, `suspend_pump`).

Safety stance is unchanged: GlucoLoop recommends, the patient approves —
the watcher never actuates the pump.

## Run it (5 terminals)

```bash
# 1) ML service
cd services/ml && ./.venv/bin/python predict_api.py            # :8101 (or uvicorn)

# 2) backend (mock agent if no MISTRAL_API_KEY)
cd services/backend && node src/server.js                       # :8100

# 3) the scenario: glucose crashing below 70 mg/dL
cd services/scenario && python3 drive_low.py --patient demo-001 --accel 60

# 4) the watcher (30-min response window on the sim clock = 30 s at accel 60)
cd services/scenario && python3 low_watch.py --response-window-min 30

# 5) (optional) simulate the patient answering mid-window:
curl -s -X POST localhost:8100/chat/demo-001 -H 'Content-Type: application/json' \
     -d '{"message": "yes I see the warning, I ate 15g of sugar"}'
```

Watch the workflow events: `low_watch.py` prints them and appends JSONL to
`low_watch_events.jsonl`. Trigger → `triggered` (Ella's reply included) →
either `user_responded` (acknowledged) or, after the window,
`protocol_started` / `protocol_step_*` / `protocol_done`. The patient's
app sees the conversation via `GET /state/demo-001` → `chat_history`, and
the alerts via `alerts`.

## Configuration (`config.low_watch.json`, CLI flags override)

| Key | Default | Meaning |
|---|---|---|
| `threshold_mgdl` | 70 | critical low threshold |
| `horizon_min` | 60 | how far ahead to check predictions |
| `confirm_polls` | 2 | consecutive below-threshold polls before firing |
| `poll_interval_s` | 5 | real seconds between checks |
| `response_window_min` | **30** | time the user has to respond |
| `response_window_mode` | `sim` | `sim` = reading clock, `wall` = real minutes |
| `hysteresis_mgdl` | 5 | re-arm margin above threshold |
| `protocol` | see file | escalation steps; unknown steps logged as "define later" |

## Tests

```bash
cd services/scenario && python3 -m pytest test_low_watch.py -q   # 17 tests
cd services/backend && npm test                                  # incl. [SYSTEM EVENT] agent tests
```
