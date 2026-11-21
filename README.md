# GlucoLoop

**Passive sensing + conversational check-ins + ML trajectories → one smart,
explainable pump recommendation.** Hackathon draft, built to run end-to-end.

```
 CGM ─┐                                        ┌─> short  (5 min)
 Watch┤   ┌──────────────┐   ┌──────────────┐  ├─> medium (15..60 min)
 Pump ┴─> │ Fusion svc   │──>│  ML models   │──┤    └> action policy (5 classes)
 Chat ──>│ (backend)    │   │  (sklearn)   │  └─> long   (24 h envelope)
         └──────┬───────┘   └──────────────┘
                │    ▲ tools: predict / log_checkin / send_alert
                ▼    │
         Mistral agent (Ella)  ── chat: "how much did you eat? sleep? exercise? stress?"
                                 └─> answers feed the SAME feature vector
```

## Quickstart (4 terminals)

```bash
# 1) ML service (stdlib, no install) — from services/ml
python predict_api.py                      # :8101  (or: uvicorn predict_api:app --port 8101)

# 2) Backend fusion + agent (zero-dep Node 18+) — from services/backend
node src/server.js                         # :8100  (set MISTRAL_API_KEY for real LLM chat)

# 3) Simulated device stream (accel: sim minutes per second) — from services/simulator
python live_stream.py --backend http://127.0.0.1:8100 --patient demo-001 --accel 60
# raises scripted demo faults: CGM drift t=600, pump occlusion t=1500, CGM dropout t=2100

# 4) Mobile app (Expo) — from apps/mobile
EXPO_PUBLIC_API_URL=http://<your-lan-ip>:8100 npx expo start
```

Optional retrain from scratch:

```bash
cd services/simulator && python generate_dataset.py --n-train 24 --n-eval 6 --days 3
cd services/ml && python train.py          # rewrites artifacts/ and docs/METRICS.md
```

## The ML (what the models do)

| Model | Output | Technique |
|---|---|---|
| Point forecasters | glucose at t+5/15/30/45/60 min | HistGradientBoosting regression |
| Long-range envelope | per 4 h block of next 24 h: q10 of block min, q90 of block max → "risk windows" | quantile regression |
| Pump action policy | `no_op / alarm_only / reduce_basal / suspend / correction_bolus` | HistGradientBoosting classifier |

Training data: a physiological simulator (Bergman minimal model + meals,
exercise, stress, sleep, and device faults) generates labeled scenarios. Labels
come from an *expert policy that saw the healthy future*; at inference the
models only see features available in real time. Draft metrics: `docs/METRICS.md`.

The conversational features (carbs, sleep, exercise, stress from chatting with
Ella) are part of the frozen feature vector, so a check-in visibly shifts every
trajectory and the recommended action.

## Repo map / who owns what

| Path | Owner (per the hackathon plan) | What to validate today |
|---|---|---|
| `services/simulator/` | Eng 1 | physiology plausibility, fault injection, data generation |
| `services/scenario/` | scenario branch | scripted "predicted low" crash (`drive_low.py`) + watcher that fires an LLM-initiated warning and a no-response protocol (`low_watch.py`, see its README) |
| `services/ml/` | Eng 3 | retrain reproducibility, metrics, predict API responses |
| `services/backend/` | Eng 2 | REST contract, fusion window building, agent tool flow |
| `apps/mobile/` | Eng 4 | runs under Expo, polling, approve/dismiss cards |
| `packages/contracts/index.ts` | team | keep types in sync if you change payloads |
| `docs/` | Presenter | DEMO_SCRIPT.md, METRICS.md, WORK_PLAN.md, BACKEND.md (backend tech + limitations) |

## Known draft limitations (be honest in the pitch)

- In-memory state only (fine for a demo; add Redis later).
- Mock chat mode is a keyword FSM — set `MISTRAL_API_KEY` for the real agent;
  both call the identical tool implementations.
- Action policy trained on simulated physiology: a draft "learned safe policy",
  not a clinical instrument. Keep the "recommend + patient approves" framing.
- `iob` is deviation-from-basal equilibrium (documented in the simulator).

## Safety stance

GlucoLoop **recommends**, the patient **approves**. No closed-loop actuation.
Device mistrust (drift/dropout/occlusion) maps to `alarm_only`, never to dosing.
All guidance is labeled "not medical advice" in the UI.
# glucoloop
