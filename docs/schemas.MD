# GlucoLoop API Schemas — for Front-End integration

Base URL: `http://localhost:8100` (set `EXPO_PUBLIC_API_URL` in the mobile app to your LAN IP, e.g. `http://192.168.1.42:8100`)

All endpoints return JSON unless noted. All patient IDs are URL-encoded strings (e.g. `demo-001`).

---

## 1. Health

```
GET /health
```

```json
{
  "status": "up",
  "uptime_s": 123,
  "mistral": true,
  "agent_mode": "mistral | mock",
  "ml_url": "http://localhost:8101"
}
```

---

## 2. Ingest a device reading

```
POST /ingest
Content-Type: application/json
```

```json
{
  "patient_id": "demo-001",
  "type": "cgm",
  "t": 60,
  "cgm": {
    "glucose_mgdl": 95.1,        // number | null (null during dropout)
    "cgm_quality": "ok",          // "ok" | "drift" | "dropout"
    "hr": 71,                     // heart rate (bpm)
    "activity": "none"            // "none" | "light" | "moderate" | "intense"
  },
  "pump": {
    "iob_units": 0.56,            // insulin on board (U)
    "commanded_basal_u_hr": 1.1,
    "delivered_basal_u_hr": 1.1,
    "pump_status": "ok"           // "ok" | "occlusion" | "leakage" | "malfunction" | "suspended"
  }
}
```

**Responses:**
- `200` → `{ "status": "ingested", "t": 60 }`
- `400` → `{ "error": "patient_id required" }` or invalid JSON
- `422` → `{ "error": "invalid reading: ...", "validationErrors": ["..."] }`

---

## 3. Patient state (main polling endpoint)

```
GET /state/:patientId
```

```json
{
  "patient_id": "demo-001",
  "latest": { /* Reading, see #2 */ },
  "history": [ /* last 24 readings */ ],
  "readings_count": 23,           // total stored (max 288 = 24h)
  "checkin": {                    // latest conversational check-in
    "carbs_g": 60, "sleep_hours": 7, "exercise_min": 30,
    "stress_1_5": 3, "logged_at": "2026-11-21T13:00:00Z"
  } | null,
  "alerts": [                     // last 10 alerts
    {
      "id": "a-...", "level": "info | warning | critical",
      "message": "...", "suggested_action": "no_op | alarm_only | ...",
      "created_at": "..."
    }
  ],
  "forecast": { /* Forecast, see #4 */ } | null,
  "active_faults": ["cgm_drift"], // [] | ["cgm_drift","cgm_dropout","occlusion",...]
  "latest_iob": 0.56,
  "latest_cgm_quality": "ok",
  "latest_pump_status": "ok",
  "profile": { /* PatientProfile, see #7 */ } | null,
  "tir_1h":  { /* TIRResult, see #6 */ },
  "tir_24h": { /* TIRResult, see #6 */ }
}
```

**Poll this every 5 s** for the dashboard.

---

## 4. ML forecast

```
GET /forecast/:patientId
```

```json
{
  "short":  { "minutes": 5, "point": 95.8 },
  "medium": [
    { "minutes": 5,  "point": 95.8 },
    { "minutes": 15, "point": 97.1 },
    { "minutes": 30, "point": 98.0 },
    { "minutes": 45, "point": 99.2 },
    { "minutes": 60, "point": 100.1 }
  ],
  "long": [                       // 6 blocks × 4 h = 24 h envelope
    { "window_start_h": 0, "window_end_h": 4, "min_q10": 78, "max_q90": 140, "risk": "normal | high" }
  ],
  "action": {
    "class": "no_op",             // "no_op" | "alarm_only" | "reduce_basal" | "suspend" | "correction_bolus"
    "probs": { "no_op": 0.96, "alarm_only": 0.02, "...": 0 }
  },
  "model_version": "..."
}
```

**502** if ML service is down: `{ "error": "ml service unreachable: ..." }`

**Poll every 10–15 s.**

---

## 5. Chat with Ella

```
POST /chat/:patientId
Content-Type: application/json
```

```json
// Request:
{ "message": "I ate 60g of carbs and did a 30min run" }

// Response 200:
{
  "reply": "Got it — about 60 g of carbs logged...",
  "toolCalls": ["log_checkin", "predict"]   // tools the agent invoked
}
```

**400** → `{ "error": "message (string) required" }`
**500** → `{ "error": "agent failed: ..." }`

> The agent's reply is a **plain string** (thinking blocks are already extracted). Tool calls are listed in `toolCalls`.

---

## 6. Full 24 h readings + TIR

```
GET /readings/:patientId
```

```json
{
  "patient_id": "demo-001",
  "count": 288,
  "readings": [
    {
      "t": 5,
      "glucose_mgdl": 95.1,
      "glucose_mmol": 5.3,        // mg/dL ÷ 18, rounded to 0.1
      "cgm_quality": "ok",
      "hr": 71,
      "activity": "none",
      "iob": 0.56,
      "pump_status": "ok"
    }
  ]
}
```

```
GET /tir/:patientId?range=1h | 24h | all
```

```json
{
  "patient_id": "demo-001",
  "range_label": "24h",
  "tir_pct": 86.7,                // % of readings in 4–10 mmol/L (72–180 mg/dL)
  "in_range": 13,
  "total": 15,
  "low_pct": 0,                   // % below 4 mmol/L
  "high_pct": 13.3,               // % above 10 mmol/L
  "range": { "low_mmol": 4, "high_mmol": 10, "low_mgdl": 72, "high_mgdl": 180 }
}
```

> Note: `all` is capped at 24 h (in-memory store, max 288 readings).

---

## 7. Patient profile

```
PUT /profile/:patientId
Content-Type: application/json
```

```json
// Request (all optional, defaults applied):
{
  "ic_ratio_g_per_u": 12,    // carbs covered by 1 U insulin
  "isf_mgdl_per_u": 45,      // insulin sensitivity factor
  "basal_u_hr": 1.3,         // scheduled basal
  "target_mgdl": 100         // target glucose
}

// Response 200:
{
  "patient_id": "demo-001",
  "profile": {
    "ic_ratio_g_per_u": 12, "isf_mgdl_per_u": 45, "basal_u_hr": 1.3,
    "target_mgdl": 100, "target_mmol": 5.6, "updated_at": "..."
  }
}
```

```
GET /profile/:patientId
→ { "patient_id": "demo-001", "profile": { ... } | null }
```

---

## 8. Proactive recommendations

```
GET /recommendations/:patientId
```

```json
{
  "patient_id": "demo-001",
  "recommendations": [
    {
      "id": "r-...",
      "type": "hypo_risk | hyper_risk | device_fault | trend_down | policy",
      "level": "info | warning | critical",
      "message": "Glucose 50 mg/dL, predicted 77 in 5 min. Recommend ~5g fast carbs now.",
      "suggested_action": "suspend",
      "value_mgdl": 50,
      "predicted_mgdl": 77,
      "correction_units": 2.2,     // only for hyper_risk
      "confidence": 0.95,           // only for policy
      "created_at": "..."
    }
  ]
}
```

```
POST /recommendations/run     // trigger a pass manually (also auto-runs every 60 s)
→ { "status": "ok", "new_recommendations": 2 }
```

---

## 9. Ops endpoints

```
GET /metrics    → { uptime_s, requests: { total, byStatus, byPath, lastRequests[] }, store: { patient_count, patients[] } }
GET /dashboard  → HTML (ops dashboard — not for FE app)
GET /app        → HTML (web backup of the mobile app — not for FE app)
```

---

## TypeScript types

Already in `packages/contracts/index.ts`: `Reading`, `CheckIn`, `Forecast`, `Alert`, `ChatMessage`, `PatientProfile`, `TIRResult`, `Recommendation`, `ReadingPoint`, `ActionClass`.

## Error format

All errors: `{ "error": "message" }` — check `error` field before using data. Validation errors include `validationErrors: string[]`.

## CORS note

The backend does **not** set CORS headers — the mobile app uses native `fetch` (no CORS) and the web app is served from the same origin (`:8100/app`). If you need cross-origin from a dev server, proxy through the backend or add CORS headers.
