# Backend — what it uses, limitations, and why it fits a 5 h hackathon

Audience: teammates integrating with `services/backend/`.

---

## What the backend uses

| Layer | Choice | Why |
|---|---|---|
| **Runtime** | Node.js 18+ (built-in `http`, `fetch`) | Zero `npm install` — `node src/server.js` just works |
| **Dependencies** | **None.** No `node_modules`, no `package.json` deps | Nothing to install, nothing to break, works offline |
| **State** | In-memory `Map` (`state.js`) | Instant reads/writes, no DB setup |
| **Agent (Ella)** | Mistral API via `fetch` when `MISTRAL_API_KEY` is set; **mock FSM fallback** with zero key | Demo works with or without network/API key |
| **ML calls** | `fetch` to `services/ml` (`:8101`) | Loose coupling — ML can be down, backend still serves |
| **Dashboard / web app** | Inline HTML/CSS/JS served from the backend (`:8100/dashboard`, `:8100/app`) | No separate frontend build step |
| **Tests** | Built-in `node --test` (Node 18+) | `npm test` with zero test-framework deps |

**Ports:** backend `:8100` · ML `:8101` · simulator streams into `:8100/ingest`.

**Key files:**
```
services/backend/
├── src/server.js        # HTTP routes, request metrics, background reco engine
├── src/state.js         # In-memory store: readings, checkins, alerts, profiles, TIR
├── src/recommend.js     # Proactive recommendation engine (ML forecast + profile)
├── src/agent/           # Ella: mistral.js (real API + mock), tools.js, prompt.js
├── src/dashboard.js     # Ops dashboard (GET /dashboard)
├── src/app.js           # Web backup of mobile app (GET /app)
└── test/                # 57 unit + integration tests (node --test)
```

## REST API quick reference

```
GET  /health                          → service status
POST /ingest                          → ingest a device reading
GET  /state/:patientId                → latest, history, alerts, forecast, TIR, profile, active_faults
GET  /forecast/:patientId             → ML forecast (short/medium/long + action)
POST /chat/:patientId                 → chat with Ella → { reply, toolCalls }
GET  /readings/:patientId             → full 24 h glucose history (mg/dL + mmol/L)
GET  /tir/:patientId?range=1h|24h|all → time-in-range 4–10 mmol/L
PUT  /profile/:patientId              → set IC ratio, ISF, basal, target
GET  /profile/:patientId              → get profile
GET  /recommendations/:patientId      → proactive recommendations
POST /recommendations/run             → trigger a recommendation pass
GET  /metrics                         → request stats + patient summary
GET  /dashboard                       → ops dashboard (HTML)
GET  /app                             → web backup app (HTML)
```

## Limitations (be honest about these)

| Limitation | Impact | Hackathon mitigation |
|---|---|---|
| **In-memory state only** | Restart = data loss; max 288 readings (24 h) per patient | Fine for a demo. For production, swap `Store` for Redis — the interface stays the same |
| **Mock agent without API key** | Keyword-based FSM, not a real LLM | Set `MISTRAL_API_KEY` for real mode; both call identical tools |
| **No auth / TLS** | Anyone who can reach `:8100` can read/write | Bind to localhost for demo; add auth before any real use |
| **No persistent storage** | "Last month" TIR not possible (capped at 24 h) | `range=all` covers everything in memory |
| **Single process, no clustering** | One patient stream at a time is fine; won't scale | Hackathon = one demo patient |
| **ML must be running separately** | `/forecast` returns 502 if ML is down | Start ML first (`:8101`); dashboard/chat still work without it |
| **Recommendations are rule+ML hybrid, not clinical** | Not medical advice | UI says "recommend + patient approves" |

## Why this is the right call for a 5 h hackathon

1. **Zero install = zero setup failures.** `node src/server.js` works on any machine with Node 18+. No `npm install` timeouts, no native module compilation, no Docker.
2. **Works offline.** Mock agent mode needs no API key or network. If Wi-Fi dies at the venue, the demo still runs (see `docs/DEMO_SCRIPT.md` backup plan).
3. **Everything is observable.** `/dashboard` shows ingested data, requests, faults in real time. `/app` is a full web backup if the Expo mobile app can't run. `/metrics` for debugging.
4. **Tested.** 57 unit/integration tests (`npm test`) + e2e pipeline test (`node scripts/e2e.mjs`, 21 checks) mean you can refactor safely in the last hour.
5. **Easy to extend.** New endpoint = add a route in `server.js`. New agent tool = add to `tools.js`. New state = add to `Store`. The patterns are consistent.
6. **Swap-in ready.** `Store` interface could be backed by Redis later. Real CGM/HealthKit bridges POST the same payload the simulator sends. No rewrites needed.

## Quickstart

```bash
# Terminal 1 — ML service
cd services/ml && python predict_api.py          # :8101

# Terminal 2 — backend
cd services/backend && node src/server.js        # :8100

# Terminal 3 — simulator stream
cd services/simulator && python live_stream.py --backend http://127.0.0.1:8100 --patient demo-001 --accel 60

# Browser
http://localhost:8100/dashboard    # ops view
http://localhost:8100/app          # patient app (web backup)
```

## Run tests

```bash
cd services/backend && npm test          # 57 unit/integration tests
node scripts/e2e.mjs                     # 21 e2e checks (spawns ML + backend + simulator)
```
