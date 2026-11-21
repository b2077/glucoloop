/**
 * Proactive chat engine — Ella initiates a conversation when glucose drops.
 *
 * Runs as a background interval alongside the recommendation pass.
 * Detects low / rapidly-falling glucose and pushes a heads-up message
 * from Ella into the patient's chat history, asking for a status update.
 *
 * Zero-dep.
 */

/** Glucose thresholds (mg/dL). */
const LOW_THRESHOLD = 80;        // heads-up when at or below this
const CRITICAL_THRESHOLD = 70;   // urgent tone below this
const DROP_RATE_THRESHOLD = 8;   // mg/dL drop per 15 min (3 readings) → trending fast down

/**
 * Check a single patient and return a proactive message if warranted.
 * Returns { message, level } or null.
 */
export function checkProactiveChat(store, patientId) {
  const s = store.get(patientId);
  const readings = s.readings.filter(
    (r) => r.cgm && r.cgm.glucose_mgdl != null && r.cgm.cgm_quality === "ok"
  );
  if (readings.length < 4) return null; // need at least 4 good readings to detect a drop

  const latest = readings[readings.length - 1];
  const g = latest.cgm.glucose_mgdl;
  const threeAgo = readings[readings.length - 4].cgm.glucose_mgdl;

  // Rate of change over ~15 min (3 intervals of 5 min)
  const dropRate = (threeAgo - g) / 3; // mg/dL per 5 min

  const profile = store.getProfile(patientId) || {};
  const target = profile.target_mgdl ?? 100;
  const lowMmol = Math.round((g / 18) * 10) / 10;

  // Critical: very low now
  if (g < CRITICAL_THRESHOLD) {
    return {
      level: "critical",
      message:
        `⚠️ Heads up — your glucose is at **${Math.round(g)} mg/dL (${lowMmol} mmol/L)**, ` +
        `which is below the safety threshold. Have you eaten recently? ` +
        `Are you feeling shaky, sweaty, or dizzy? Tell me how you're doing right now.`,
    };
  }

  // Low or dropping fast
  if (g <= LOW_THRESHOLD || (dropRate >= DROP_RATE_THRESHOLD && g < 110)) {
    const trend = dropRate >= DROP_RATE_THRESHOLD
      ? ` and dropping fast (~${Math.round(dropRate)} mg/dL per 5 min)`
      : "";
    return {
      level: "warning",
      message:
        `Hey, I noticed your glucose is at **${Math.round(g)} mg/dL (${lowMmol} mmol/L)**${trend}. ` +
        `Just checking in — how are you feeling? Have you eaten or taken any insulin recently?`,
    };
  }

  return null;
}

/**
 * Run one proactive-chat pass for all patients.
 * Pushes assistant messages into the conversations map when glucose drops.
 * Returns the number of proactive messages sent.
 *
 * @param {Store} store
 * @param {Map<string, Array>} conversations - patientId -> chat history array
 * @param {object} opts
 * @param {number} opts.cooldownMin - minimum minutes between proactive messages per patient (default 15)
 */
export function runProactiveChatPass(store, conversations, opts = {}) {
  const cooldownMin = opts.cooldownMin ?? 15;
  const cooldownMs = cooldownMin * 60 * 1000;
  let sent = 0;

  for (const pid of store.states.keys()) {
    const check = checkProactiveChat(store, pid);
    if (!check) continue;

    const history = conversations.get(pid) || [];

    // Cooldown: don't spam — skip if we already sent a proactive message recently
    const lastProactive = [...history].reverse().find(
      (m) => m.role === "assistant" && m.proactive === true
    );
    if (lastProactive && Date.now() - new Date(lastProactive.at || 0).getTime() < cooldownMs) {
      continue;
    }

    // Also skip if the user has already responded after the last proactive message
    if (lastProactive) {
      const idx = history.lastIndexOf(lastProactive);
      const userResponded = history.slice(idx + 1).some((m) => m.role === "user");
      if (userResponded) continue;
    }

    const entry = {
      role: "assistant",
      content: check.message,
      proactive: true,
      level: check.level,
      at: new Date().toISOString(),
    };
    history.push(entry);
    conversations.set(pid, history.slice(-20));
    sent++;
  }

  return sent;
}
