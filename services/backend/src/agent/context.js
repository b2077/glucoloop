/**
 * Build a text snapshot of the backend's current patient context to inject
 * into the LLM conversation — so Ella always answers with live BE data in view
 * (glucose, HR, faults, TIR, alerts, recommendations, profile, forecast).
 *
 * Zero-dep. Called from runAgent() on every chat turn.
 */

/** mg/dL → mmol/L, 1 decimal */
const toMmol = (g) => (g == null ? null : Math.round((g / 18) * 10) / 10);

export function buildAgentContext(store, patientId) {
  const s = store.get(patientId);
  const latest = s.readings[s.readings.length - 1] || null;
  const profile = store.getProfile(patientId);
  const tir1h = store.tir(patientId, 60);
  const tir24h = store.tir(patientId, 1440);
  const ci = store.latestCheckin(patientId);
  const alerts = s.alerts.slice(-5);
  const recs = s.recommendations.slice(-5);
  const forecast = s.lastForecast;

  const lines = [];
  lines.push(`[CURRENT PATIENT CONTEXT — patient: ${patientId}]`);

  if (latest?.cgm) {
    const g = latest.cgm.glucose_mgdl;
    lines.push(`- Latest CGM: ${g != null ? `${Math.round(g)} mg/dL (${toMmol(g)} mmol/L)` : "no reading (dropout)"} · quality=${latest.cgm.cgm_quality} · HR=${latest.cgm.hr} bpm · activity=${latest.cgm.activity}`);
  }
  if (latest?.pump) {
    lines.push(`- Pump: status=${latest.pump.pump_status} · IOB=${latest.pump.iob_units?.toFixed(2)} U · basal cmd=${latest.pump.commanded_basal_u_hr} / delivered=${latest.pump.delivered_basal_u_hr} U/h`);
  }

  // Active faults
  const faults = [];
  if (latest?.cgm?.cgm_quality === "drift") faults.push("CGM DRIFT — sensor unreliable");
  if (latest?.cgm?.cgm_quality === "dropout") faults.push("CGM DROPOUT — no glucose data");
  if (latest?.pump?.pump_status && latest.pump.pump_status !== "ok") faults.push(`PUMP ${latest.pump.pump_status.toUpperCase()}`);
  if (faults.length) lines.push(`- ⚠ ACTIVE FAULTS: ${faults.join("; ")} — recommend alarm_only, never dose on faulty data`);

  // TIR
  if (tir1h.total > 0) lines.push(`- TIR (4–10 mmol/L): last 1h = ${tir1h.tir_pct}% (low ${tir1h.low_pct}% / high ${tir1h.high_pct}%), last 24h = ${tir24h.tir_pct ?? "n/a"}%`);

  // Forecast
  if (forecast) {
    lines.push(`- ML forecast: 5min=${forecast.short?.point} mg/dL · 1h=${forecast.medium?.[forecast.medium.length-1]?.point} mg/dL · action=${forecast.action?.class} (p=${forecast.action?.probs?.[forecast.action?.class]?.toFixed(2)})`);
  }

  // Profile
  if (profile) {
    lines.push(`- Profile: IC ratio=${profile.ic_ratio_g_per_u} g/U · ISF=${profile.isf_mgdl_per_u} mg/dL/U · basal=${profile.basal_u_hr} U/h · target=${profile.target_mgdl} mg/dL (${Math.round(profile.target_mmol * 10) / 10} mmol/L)`);
  }

  // Check-in
  if (ci) {
    lines.push(`- Last check-in: carbs=${ci.carbs_g ?? "—"}g · sleep=${ci.sleep_hours ?? "—"}h · exercise=${ci.exercise_min ?? "—"}min · stress=${ci.stress_1_5 ?? "—"}/5`);
  }

  // Recent alerts
  if (alerts.length) {
    lines.push(`- Recent alerts: ${alerts.map((a) => `[${a.level}] ${a.message.slice(0, 80)}`).join(" | ")}`);
  }

  // Recent recommendations
  if (recs.length) {
    lines.push(`- Recent recommendations: ${recs.map((r) => `${r.type}:${r.level}`).join(", ")}`);
  }

  lines.push(`- Readings stored: ${s.readings.length} (max 288 = 24h)`);
  lines.push(`[/CONTEXT]`);

  return lines.join("\n");
}
