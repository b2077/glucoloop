/** GlucoLoop frozen contracts (types mirror the JSON payloads actually served
 *  by services/backend — keep this file in sync when changing payloads). */

export const ACTION_CLASSES = [
  "no_op",
  "alarm_only",
  "reduce_basal",
  "suspend",
  "correction_bolus",
] as const;
export type ActionClass = (typeof ACTION_CLASSES)[number];

/** Pushed by device bridges (CGM/pump sim) to POST /ingest. */
export interface Reading {
  patient_id: string;
  type: "cgm" | "watch" | "pump" | "checkin";
  t: number; // sim minutes since stream start
  cgm?: {
    glucose_mgdl: number | null; // null during CGM dropout
    cgm_quality: "ok" | "drift" | "dropout";
    hr: number;
    activity: "none" | "light" | "moderate" | "intense";
  };
  pump?: {
    iob_units: number;
    commanded_basal_u_hr: number;
    delivered_basal_u_hr: number;
    pump_status: "ok" | "occlusion" | "leakage" | "malfunction" | "suspended";
  };
}

/** Structured extraction from the conversational check-in (log_checkin tool). */
export interface CheckIn {
  carbs_g?: number;
  sleep_hours?: number;
  exercise_min?: number;
  exercise_type?: string;
  intensity?: "none" | "light" | "moderate" | "intense";
  stress_1_5?: number;
  logged_at: string;
}

export interface Forecast {
  short: { minutes: 5; point: number };
  medium: { minutes: number; point: number }[];
  long: {
    window_start_h: number;
    window_end_h: number;
    min_q10: number;
    max_q90: number;
    risk: "high" | "normal";
  }[];
  action: { class: ActionClass; probs: Record<ActionClass, number> };
  model_version: string;
}

export interface Alert {
  id: string;
  patient_id: string;
  level: "info" | "warning" | "critical";
  message: string;
  suggested_action?: ActionClass;
  created_at: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Patient profile (IC ratio, ISF, basal, target) — FE issue #5.3. */
export interface PatientProfile {
  ic_ratio_g_per_u: number;   // grams of carbs covered by 1 U insulin
  isf_mgdl_per_u: number;     // insulin sensitivity factor (mg/dL per U)
  basal_u_hr: number;         // scheduled basal rate
  target_mgdl: number;        // target glucose
  target_mmol: number;        // target in mmol/L
  updated_at: string;
}

/** Time-in-range result (4–10 mmol/L) — FE issue #5.2. */
export interface TIRResult {
  patient_id: string;
  range_label: string;
  tir_pct: number | null;     // % of readings in 4–10 mmol/L
  in_range: number;
  total: number;
  low_pct: number | null;     // % below range
  high_pct: number | null;    // % above range
  range: { low_mmol: number; high_mmol: number; low_mgdl: number; high_mgdl: number };
}

/** Spontaneous recommendation from the backend — FE issue #5.3. */
export interface Recommendation {
  id: string;
  patient_id: string;
  type: "hypo_risk" | "hyper_risk" | "device_fault" | "trend_down" | "policy";
  level: "info" | "warning" | "critical";
  message: string;
  suggested_action?: ActionClass;
  value_mgdl?: number;
  predicted_mgdl?: number | null;
  correction_units?: number;
  confidence?: number;
  created_at: string;
}

/** Full reading with mmol/L conversion — FE issue #5.1. */
export interface ReadingPoint {
  t: number;
  glucose_mgdl: number | null;
  glucose_mmol: number | null;
  cgm_quality: string | null;
  hr: number | null;
  activity: string | null;
  iob: number | null;
  pump_status: string | null;
}

/* REST surface (all JSON):
 *  GET  /health
 *  POST /ingest                     body: Reading
 *  GET  /state/:patientId           -> { latest, history, checkin, alerts, forecast, active_faults, latest_iob, tir_1h, tir_24h, profile, readings_count }
 *  GET  /forecast/:patientId        -> Forecast
 *  POST /chat/:patientId            body: { message } -> { reply, toolCalls }
 *  GET  /readings/:patientId        -> { patient_id, count, readings: [{ t, glucose_mgdl, glucose_mmol, cgm_quality, hr, activity, iob, pump_status }] }   (full 24 h)
 *  GET  /tir/:patientId?range=1h|24h|all -> { tir_pct, in_range, total, low_pct, high_pct, range: { low_mmol: 4, high_mmol: 10 } }  (TIR = 4–10 mmol/L)
 *  GET  /profile/:patientId         -> { patient_id, profile }   (IC ratio, ISF, basal, target)
 *  PUT  /profile/:patientId         body: { ic_ratio_g_per_u?, isf_mgdl_per_u?, basal_u_hr?, target_mgdl? } -> { profile }
 *  GET  /recommendations/:patientId -> { patient_id, recommendations: [{ id, type, level, message, suggested_action, created_at }] }
 *  POST /recommendations/run        -> { status, new_recommendations }   (trigger a proactive pass)
 *  GET  /metrics                    -> { uptime_s, requests, store }
 *  GET  /dashboard                  -> HTML (ops dashboard)
 *  GET  /app                        -> HTML (web backup of mobile app)
 */
