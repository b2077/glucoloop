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

/* REST surface (all JSON):
 *  GET  /health
 *  POST /ingest                     body: Reading
 *  GET  /state/:patientId           -> { latest, history, checkin, alerts, forecast }
 *  GET  /forecast/:patientId        -> Forecast
 *  POST /chat/:patientId            body: { message } -> { reply, toolCalls }
 */
