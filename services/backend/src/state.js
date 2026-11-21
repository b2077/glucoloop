/** In-memory patient state: the "real-time fusion" store. Zero deps. */

const MAX = 288; // 24 h of 5-min readings

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
}
