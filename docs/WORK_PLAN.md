# Work plan — team of 4 engineers + 1 presenter

## Component ownership in this repo
- **Eng 1 (devices/data):** `services/simulator/` — CGM/pump/watch simulation,
  physiology model, fault injection, dataset generation. Hooks: real CGM API &
  HealthKit can replace `live_stream.py`'s payload shape (it POSTs exactly what
  bridges would).
- **Eng 2 (backend + agent):** `services/backend/` — fusion store, REST, agent
  tools. Real Mistral mode: set `MISTRAL_API_KEY` (+ optional `MISTRAL_MODEL`).
  Mock mode = scripted fallback calling the same tools.
- **Eng 3 (ML):** `services/ml/` — feature builder (frozen!), training, predict
  service. Retrain: see README. Watch the train/serve parity in `features.py`
  (both paths live there — never fork them).
- **Eng 4 (mobile):** `apps/mobile/` — Expo app, three tabs, approve/dismiss.
  Chart is dependency-free Views (no svg lib) — keep it or swap in
  react-native-svg later.
- **Presenter:** `docs/DEMO_SCRIPT.md` + `docs/METRICS.md` + rehearsal +
  backup video.

## Validation checklist (divide and verify)
- [ ] `python predict_api.py` boots and `/health` returns up (Eng 3)
- [ ] `node src/server.js` boots; `/health` shows agent mock|mistral (Eng 2)
- [ ] Stream 3+ hours (`--accel 3600`), then `/forecast/demo-001` returns all
      three horizons (Eng 1 + Eng 3)
- [ ] Chat: meal/sleep/exercise/stress messages each trigger
      `log_checkin` + `predict` (check `toolCalls` in response) (Eng 2)
- [ ] Forecast shifts AFTER a check-in (log before/after values) (Eng 3)
- [ ] App runs under Expo, dashboard polls, approve button fires (Eng 4)
- [ ] Fault beats: drift → alarm_only; occlusion → alarm_only + IOB collapse
      visible in `/state` (Eng 1)
- [ ] Full dress rehearsal + screen recording (Presenter)

## If time remains (priority order)
1. Real Mistral mode with `MISTRAL_API_KEY` — prompt is in
   `services/backend/src/agent/prompt.js`, tools already defined.
2. Proactive check-in: agent-initiated prompts on fault triggers (Beat 4 hook:
   server can push next; today the demo asks manually).
3. Wire real CGM sandbox (Dexcom API) into `live_stream.py`'s place.
4. Rules vs ML benchmark slide: compare `no_op` majority baseline vs 94.6%.

## Risk register
- CGM sandbox approval delay → simulator keeps everything unblocked.
- Wi-Fi failure at demo → backup video, mock chat needs no network.
- Train/serve feature drift → forbidden by design: one `features.py`.
- Overselling clinical accuracy → keep "recommend + approve" framing,
  physiological simulator is future-work validation (UVA/Padova, clinical trials).
