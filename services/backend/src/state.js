/** In-memory patient state: the "real-time fusion" store. Zero deps. */

const MAX = 288; // 24 h of 5-min readings
const MGDL_PER_MMOL = 18.0; // 1 mmol/L = 18 mg/dL
const TIR_LOW_MMOL = 4.0;   // FE requirement: TIR range is 4–10 mmol/L
const TIR_HIGH_MMOL = 10.0;
const TIR_LOW_MGDL = TIR_LOW_MMOL * MGDL_PER_MMOL;   // 72
const TIR_HIGH_MGDL = TIR_HIGH_MMOL * MGDL_PER_MMOL; // 180

const VALID_TYPES = new Set(["cgm", "watch", "pump", "checkin"]);
const VALID_QUALITY = new Set(["ok", "drift", "dropout"]);
const VALID_ACTIVITY = new Set(["none", "light", "moderate", "intense"]);
const VALID_PUMP_STATUS = new Set(["ok", "occlusion", "leakage", "malfunction", "suspended"]);

export const TIR_RANGE = { low_mmol: TIR_LOW_MMOL, high_mmol: TIR_HIGH_MMOL,
                           low_mgdl: TIR_LOW_MGDL, high_mgdl: TIR_HIGH_MGDL };

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

/** mg/dL → mmol/L */
export const toMmol = (mgdl) => mgdl / MGDL_PER_MMOL;

export class Store {
  constructor() {
    this.states = new Map();
    this.profiles = new Map(); // patientId -> { ic_ratio, isf, basal, target_mgdl, ... }
  }

  get(patientId) {
    let s = this.states.get(patientId);
    if (!s) {
      s = { readings: [], checkins: [], alerts: [], recommendations: [], lastForecast: null };
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

  // ---- profile (FE issue #5: IC ratio, ISF, basal, etc.) ----
  setProfile(patientId, p) {
    const defaults = { ic_ratio_g_per_u: 10, isf_mgdl_per_u: 50, basal_u_hr: 1.1,
                       target_mgdl: 100, target_mmol: toMmol(100) };
    const merged = { ...defaults, ...p, updated_at: new Date().toISOString() };
    this.profiles.set(patientId, merged);
    return merged;
  }

  getProfile(patientId) {
    return this.profiles.get(patientId) || null;
  }

  // ---- recommendations (FE issue #5: spontaneous BE recommendations) ----
  addRecommendation(patientId, rec) {
    const r = { id: `r-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
                patient_id: patientId, created_at: new Date().toISOString(), ...rec };
    this.get(patientId).recommendations.push(r);
    if (this.get(patientId).recommendations.length > 50)
      this.get(patientId).recommendations = this.get(patientId).recommendations.slice(-50);
    return r;
  }

  recommendations(patientId) {
    return this.get(patientId).recommendations.slice(-20);
  }

  // ---- full glucose history (FE issue #5.1: last 24 h) ----
  /** Return all stored readings (up to MAX = 24 h at 5-min intervals). */
  allReadings(patientId) {
    return this.get(patientId).readings;
  }

  // ---- TIR (FE issue #5.2: time in range 4–10 mmol/L) ----
  /**
   * Compute Time In Range for a given window.
   * @param rangeMinutes - 60 for last hour, 1440 for last 24 h, Infinity/null for all
   * Returns { tir_pct, in_range, total, low_pct, high_pct, range: {low_mmol, high_mmol} }
   */
  tir(patientId, rangeMinutes = null) {
    const s = this.get(patientId);
    const readings = s.readings.filter((r) => r.cgm && r.cgm.glucose_mgdl !== null &&
                                                 r.cgm.cgm_quality !== "dropout");
    let window = readings;
    if (rangeMinutes && readings.length > 0) {
      const maxT = readings[readings.length - 1].t;
      window = readings.filter((r) => r.t >= maxT - rangeMinutes);
    }
    const total = window.length;
    if (total === 0) return { tir_pct: null, in_range: 0, total: 0, low_pct: null,
                               high_pct: null, range: { low_mmol: TIR_LOW_MMOL, high_mmol: TIR_HIGH_MMOL } };
    let inRange = 0, low = 0, high = 0;
    for (const r of window) {
      const g = r.cgm.glucose_mgdl;
      if (g < TIR_LOW_MGDL) low++;
      else if (g > TIR_HIGH_MGDL) high++;
      else inRange++;
    }
    return {
      tir_pct: Math.round((inRange / total) * 1000) / 10,
      in_range: inRange, total,
      low_pct: Math.round((low / total) * 1000) / 10,
      high_pct: Math.round((high / total) * 1000) / 10,
      range: { low_mmol: TIR_LOW_MMOL, high_mmol: TIR_HIGH_MMOL,
               low_mgdl: TIR_LOW_MGDL, high_mgdl: TIR_HIGH_MGDL },
    };
  }

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
    const latest = s.readings[s.readings.length - 1] || null;
    // Surface active device faults so consumers (mobile app, dashboard, tests)
    // can see CGM drift/dropout and pump faults at a glance — addresses the
    // "IOB collapse must be visible in /state" integration check.
    const activeFaults = [];
    if (latest) {
      if (latest.cgm?.cgm_quality === "drift") activeFaults.push("cgm_drift");
      if (latest.cgm?.cgm_quality === "dropout") activeFaults.push("cgm_dropout");
      if (latest.pump?.pump_status && latest.pump.pump_status !== "ok")
        activeFaults.push(latest.pump.pump_status);
    }
    return {
      patient_id: patientId,
      latest,
      history: s.readings.slice(-24),
      readings_count: s.readings.length,
      checkin: this.latestCheckin(patientId),
      alerts: s.alerts.slice(-10),
      forecast: s.lastForecast,
      active_faults: activeFaults,
      latest_iob: latest?.pump?.iob_units ?? null,
      latest_cgm_quality: latest?.cgm?.cgm_quality ?? null,
      latest_pump_status: latest?.pump?.pump_status ?? null,
      profile: this.getProfile(patientId),
      tir_1h: this.tir(patientId, 60),
      tir_24h: this.tir(patientId, 1440),
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
        recommendations_count: s.recommendations.length,
        latest_t: s.readings.length ? s.readings[s.readings.length - 1].t : null,
        has_forecast: !!s.lastForecast,
        has_profile: this.profiles.has(pid),
      });
    }
    return { patient_count: this.states.size, patients };
  }
}
