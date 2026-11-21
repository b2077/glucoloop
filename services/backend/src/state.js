/** In-memory patient state: the "real-time fusion" store. Zero deps. */

const MAX = 288; // 24 h of 5-min readings

const VALID_TYPES = new Set(["cgm", "watch", "pump", "checkin"]);
const VALID_QUALITY = new Set(["ok", "drift", "dropout"]);
const VALID_ACTIVITY = new Set(["none", "light", "moderate", "intense"]);
const VALID_PUMP_STATUS = new Set(["ok", "occlusion", "leakage", "malfunction", "suspended"]);

/** Validate a Reading object. Returns an array of error strings (empty = valid). */
export function validateReading(r) {
  const errors = [];
  if (!r || typeof r !== "object") return ["reading must be an object"];
  if (!r.patient_id || typeof r.patient_id !== "string") errors.push("patient_id (string) required");
  if (!VALID_TYPES.has(r.type)) errors.push(`type must be one of: ${[...VALID_TYPES].join(", ")}`);
  if (typeof r.t !== "number" || !Number.isFinite(r.t)) errors.push("t (number) required");
  if (r.cgm) {
    if (r.cgm.glucose_mgdl !== null && typeof r.cgm.glucose_mgdl !== "number")
      errors.push("cgm.glucose_mgdl must be number or null");
    if (!VALID_QUALITY.has(r.cgm.cgm_quality)) errors.push("cgm.cgm_quality invalid");
    if (typeof r.cgm.hr !== "number") errors.push("cgm.hr (number) required");
    if (!VALID_ACTIVITY.has(r.cgm.activity)) errors.push("cgm.activity invalid");
  }
  if (r.pump) {
    if (typeof r.pump.iob_units !== "number") errors.push("pump.iob_units (number) required");
    if (typeof r.pump.commanded_basal_u_hr !== "number") errors.push("pump.commanded_basal_u_hr (number) required");
    if (typeof r.pump.delivered_basal_u_hr !== "number") errors.push("pump.delivered_basal_u_hr (number) required");
    if (!VALID_PUMP_STATUS.has(r.pump.pump_status)) errors.push("pump.pump_status invalid");
  }
  return errors;
}

export class Store {
  constructor() { this.states = new Map(); }

  get(patientId) {
    let s = this.states.get(patientId);
    if (!s) {
      s = { readings: [], checkins: [], alerts: [], lastForecast: null };
      this.states.set(patientId, s);
    }
    return s;
  }

  ingest(r) {
    const errors = validateReading(r);
    if (errors.length > 0) {
      const err = new Error("invalid reading: " + errors.join("; "));
      err.validationErrors = errors;
      throw err;
    }
    const s = this.get(r.patient_id);
    s.readings.push(r);
    if (s.readings.length > MAX) s.readings = s.readings.slice(-MAX);
    return s;
  }

  addCheckin(patientId, c) {
    const merged = { ...this.latestCheckin(patientId), ...c,
                     logged_at: new Date().toISOString() };
    this.get(patientId).checkins.push(merged);
    return merged;
  }

  latestCheckin(patientId) {
    const cs = this.get(patientId).checkins;
    return cs.length ? cs[cs.length - 1] : null;
  }

  addAlert(a) { this.get(a.patient_id).alerts.push(a); return a; }

  /** Build the ML feature window: last 12 readings fused with latest check-in. */
  mlWindow(patientId) {
    const s = this.get(patientId);
    const last = s.readings.slice(-12);
    const ci = this.latestCheckin(patientId);
    return last.map((r) => ({
      t: r.t,
      glucose_mgdl: r.cgm ? r.cgm.glucose_mgdl : null,
      cgm_quality: r.cgm ? r.cgm.cgm_quality : "ok",
      hr: r.cgm ? r.cgm.hr : 70,
      activity: r.cgm ? r.cgm.activity : "none",
      iob: r.pump ? r.pump.iob_units : 1.0,
      commanded_basal: r.pump ? r.pump.commanded_basal_u_hr : 1.1,
      pump_status: r.pump ? r.pump.pump_status : "ok",
      carbs_g_3h: ci?.carbs_g ?? 0,
      exercise_min_2h: ci?.exercise_min ?? 0,
      sleep_hours_last: ci?.sleep_hours ?? 7,
      stress_1_5: ci?.stress_1_5 ?? 1,
    }));
  }

  summary(patientId) {
    const s = this.get(patientId);
    return {
      patient_id: patientId,
      latest: s.readings[s.readings.length - 1] || null,
      history: s.readings.slice(-24),
      checkin: this.latestCheckin(patientId),
      alerts: s.alerts.slice(-10),
      forecast: s.lastForecast,
    };
  }

  /** Aggregate metrics across all patients — for GET /metrics. */
  metrics() {
    const patients = [];
    for (const [pid, s] of this.states) {
      patients.push({
        patient_id: pid,
        readings_count: s.readings.length,
        checkins_count: s.checkins.length,
        alerts_count: s.alerts.length,
        latest_t: s.readings.length ? s.readings[s.readings.length - 1].t : null,
        has_forecast: !!s.lastForecast,
      });
    }
    return { patient_count: this.states.size, patients };
  }
}
