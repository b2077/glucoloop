/**
 * Proactive recommendation engine (FE issue #5.3).
 *
 * Periodically evaluates each patient's latest state + ML forecast against
 * their profile (IC ratio, ISF, basal, target) and pushes spontaneous
 * recommendations via the store. Zero-dep, runs as an interval in server.js.
 */

/** Generate recommendations for a patient based on their latest reading, forecast, and profile. */
export function generateRecommendations(store, patientId, forecast) {
  const s = store.get(patientId);
  const latest = s.readings[s.readings.length - 1];
  if (!latest?.cgm) return [];
  const profile = store.getProfile(patientId) || {};
  const g = latest.cgm.glucose_mgdl;
  const quality = latest.cgm.cgm_quality;
  const pumpStatus = latest.pump?.pump_status || "ok";
  const recs = [];

  // Device fault → always recommend alarm_only, never dose
  if (quality === "drift" || quality === "dropout" || (pumpStatus !== "ok" && pumpStatus !== "suspended")) {
    recs.push({
      type: "device_fault",
      level: "warning",
      message: `Device fault detected (${quality}/${pumpStatus}). Trust manual checks until resolved.`,
      suggested_action: "alarm_only",
    });
    return recs;
  }

  if (g === null) return recs;

  const target = profile.target_mgdl ?? 100;
  const isf = profile.isf_mgdl_per_u ?? 50;
  const icRatio = profile.ic_ratio_g_per_u ?? 10;
  const basal = profile.basal_u_hr ?? 1.1;

  // Use forecast if available
  const shortPt = forecast?.short?.point;
  const actionClass = forecast?.action?.class;
  const actionProb = forecast?.action?.probs?.[actionClass] ?? 0;

  // Low glucose or predicted low → recommend fast carbs
  if (g < 72 || (shortPt !== undefined && shortPt < 72)) {
    const hypoGrams = Math.ceil(((72 - (shortPt ?? g)) / isf) * icRatio * 0.3);
    recs.push({
      type: "hypo_risk",
      level: "critical",
      message: `Glucose ${Math.round(g)} mg/dL${shortPt ? `, predicted ${Math.round(shortPt)} in 5 min` : ""}. ` +
               `Recommend ~${Math.max(5, hypoGrams)}g fast carbs now.`,
      suggested_action: actionClass === "suspend" ? "suspend" : "alarm_only",
      value_mgdl: Math.round(g),
      predicted_mgdl: shortPt ? Math.round(shortPt) : null,
    });
  }

  // High glucose or predicted high → correction bolus estimate using ISF
  if (g > 180 || (shortPt !== undefined && shortPt > 180)) {
    const excess = (shortPt ?? g) - target;
    const correctionUnits = Math.round((excess / isf) * 10) / 10;
    recs.push({
      type: "hyper_risk",
      level: "warning",
      message: `Glucose ${Math.round(g)} mg/dL${shortPt ? `, predicted ${Math.round(shortPt)} in 5 min` : ""}. ` +
               `Correction estimate: ~${correctionUnits} U (ISF ${isf} mg/dL/U, target ${target}). ` +
               `Approve in app before dosing.`,
      suggested_action: "correction_bolus",
      value_mgdl: Math.round(g),
      predicted_mgdl: shortPt ? Math.round(shortPt) : null,
      correction_units: correctionUnits,
    });
  }

  // Trending down toward range boundary
  if (forecast?.medium && forecast.medium.length >= 2) {
    const m0 = forecast.medium[0].point, mLast = forecast.medium[forecast.medium.length - 1].point;
    if (mLast < m0 - 10 && g < 110 && g >= 72) {
      recs.push({
        type: "trend_down",
        level: "info",
        message: `Glucose trending down (${Math.round(m0)} → ${Math.round(mLast)} mg/dL over 1 h). ` +
                 `Consider a small snack (~${Math.round(icRatio * 0.5)}g) if trend continues.`,
        suggested_action: actionClass || "no_op",
      });
    }
  }

  // Pump action from ML policy with confidence
  if (actionClass && actionClass !== "no_op" && actionProb > 0.5) {
    recs.push({
      type: "policy",
      level: actionClass === "suspend" || actionClass === "reduce_basal" ? "warning" : "info",
      message: `ML policy recommends **${actionClass.replace(/_/g, " ")}** (confidence ${(actionProb * 100).toFixed(0)}%). ` +
               `Basal ${basal} U/h, IOB ${latest.pump?.iob_units?.toFixed(1) ?? "?"} U.`,
      suggested_action: actionClass,
      confidence: Math.round(actionProb * 100) / 100,
    });
  }

  // Stale data check
  if (s.readings.length > 0) {
    const ageMin = (Date.now() - new Date(s.readings[s.readings.length - 1].ingested_at || Date.now()).getTime()) / 60000;
    // (ingested_at not tracked; skip if unavailable)
  }

  return recs;
}

/** Run one evaluation pass for all patients. Returns count of new recommendations. */
export async function runRecommendationPass(store, mlUrl, fetchImpl = fetch) {
  let count = 0;
  for (const pid of store.states.keys()) {
    const s = store.get(pid);
    if (s.readings.length < 12) continue; // need enough data for ML window
    try {
      const r = await fetchImpl(`${mlUrl}/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patient_id: pid, readings: store.mlWindow(pid) }),
      });
      if (!r.ok) continue;
      const forecast = await r.json();
      s.lastForecast = forecast;
      const recs = generateRecommendations(store, pid, forecast);
      for (const rec of recs) {
        // Dedup: don't push the same type within 5 minutes
        const recent = s.recommendations.filter(
          (x) => x.type === rec.type && Date.now() - new Date(x.created_at).getTime() < 5 * 60 * 1000);
        if (recent.length === 0) {
          store.addRecommendation(pid, rec);
          count++;
          // Also push as alert for critical/warning
          if (rec.level === "critical" || rec.level === "warning") {
            store.addAlert({ id: `a-${Date.now()}`, patient_id: pid, level: rec.level,
                             message: rec.message, suggested_action: rec.suggested_action,
                             created_at: new Date().toISOString() });
          }
        }
      }
    } catch { /* ML down, skip this patient */ }
  }
  return count;
}
