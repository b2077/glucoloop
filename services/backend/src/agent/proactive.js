/**
 * Proactive chat engine — Ella initiates a conversation when glucose drops.
 *
 * Consolidates PR #11 (scenario/predicted-hypo-watch) and PR #12 (glucose_drop_chat):
 *  - detection combines PR #12's current-level / drop-rate checks with PR #11's
 *    forecast-based check (predicted minimum within the horizon below threshold);
 *  - initiation goes through the LLM agent via a "[SYSTEM EVENT …]" message
 *    (PR #11's mechanism) instead of a canned push, so warnings are composed by
 *    Ella in mock AND real (MISTRAL_API_KEY) mode — server.js passes opts.initiate;
 *    without it the pass falls back to the canned message (used by tests);
 *  - PR #11's no-response protocol: if the patient does not reply within the
 *    response window, a second [SYSTEM EVENT — no response …] triggers the
 *    escalation path (critical alert via the agent), on top of PR #12's
 *    cooldown + user-responded dedup.
 *
 * Thresholds come from a single config: services/scenario/config.low_watch.json
 * (env-overridable), shared with the scripted watcher low_watch.py.
 *
 * Zero-dep.
 */
import fs from "node:fs";

/** Defaults; overridden by config.low_watch.json + PROACTIVE_* env vars. */
const DEFAULTS = {
  low_mgdl: 80,                    // heads-up when at or below this
  critical_mgdl: 70,               // urgent tone below this
  drop_rate_mgdl_per_5min: 8,      // mg/dL drop per 5 min → trending fast down
  fast_drop_max_mgdl: 110,         // fast-drop check only applies below this
  forecast_threshold_mgdl: 70,     // predicted min within horizon below this → warn
  forecast_horizon_min: 60,
  cooldown_min: 15,
  response_window_min: 30,         // wall-clock minutes to wait for a reply before escalating
};

let cachedCfg = null;

/** Load the unified low-watch config (scenario config file + env overrides). */
export function getProactiveConfig() {
  if (cachedCfg) return cachedCfg;
  const cfg = { ...DEFAULTS };
  try {
    const url = new URL("../../../scenario/config.low_watch.json", import.meta.url);
    const raw = JSON.parse(fs.readFileSync(url, "utf8"));
    if (raw.threshold_mgdl != null) cfg.forecast_threshold_mgdl = raw.threshold_mgdl;
    if (raw.threshold_mgdl != null) cfg.critical_mgdl = raw.threshold_mgdl;
    if (raw.horizon_min != null) cfg.forecast_horizon_min = raw.horizon_min;
    if (raw.response_window_min != null) cfg.response_window_min = raw.response_window_min;
  } catch { /* config file optional — defaults apply */ }
  const env = process.env;
  if (env.PROACTIVE_LOW_MGDL) cfg.low_mgdl = Number(env.PROACTIVE_LOW_MGDL);
  if (env.PROACTIVE_CRITICAL_MGDL) cfg.critical_mgdl = Number(env.PROACTIVE_CRITICAL_MGDL);
  if (env.PROACTIVE_FORECAST_THRESHOLD_MGDL) cfg.forecast_threshold_mgdl = Number(env.PROACTIVE_FORECAST_THRESHOLD_MGDL);
  if (env.PROACTIVE_COOLDOWN_MIN) cfg.cooldown_min = Number(env.PROACTIVE_COOLDOWN_MIN);
  if (env.PROACTIVE_RESPONSE_WINDOW_MIN) cfg.response_window_min = Number(env.PROACTIVE_RESPONSE_WINDOW_MIN);
  cachedCfg = cfg;
  return cfg;
}

/** patientId -> { at: epoch ms, escalated: bool } for the no-response protocol */
const pending = new Map();

/** Test hook: reset cached config and pending escalation state. */
export function resetProactiveState() {
  cachedCfg = null;
  pending.clear();
}

/**
 * Check a single patient and return a proactive trigger if warranted.
 * Combines current-glucose / drop-rate detection (PR #12) with forecast-minimum
 * detection (PR #11). `forecast` is the cached store.lastForecast (refreshed by
 * /forecast calls and the recommendation pass), may be null.
 * Returns { message, level, source } or null.
 */
export function checkProactiveChat(store, patientId, forecast = null, cfg = getProactiveConfig()) {
  const s = store.get(patientId);
  const readings = s.readings.filter(
    (r) => r.cgm && r.cgm.glucose_mgdl != null && r.cgm.cgm_quality === "ok"
  );
  if (readings.length < 4 && !forecast) return null; // need data to judge

  const latest = readings[readings.length - 1];
  const g = latest ? latest.cgm.glucose_mgdl : null;
  const lowMmol = g != null ? Math.round((g / 18) * 10) / 10 : null;

  // --- current level / drop rate (PR #12) ---
  if (g != null) {
    if (g < cfg.critical_mgdl) {
      return {
        level: "critical",
        source: "current",
        message:
          `⚠️ Heads up — your glucose is at **${Math.round(g)} mg/dL (${lowMmol} mmol/L)**, ` +
          `which is below the safety threshold. Have you eaten recently? ` +
          `Are you feeling shaky, sweaty, or dizzy? Tell me how you're doing right now.`,
      };
    }
    const threeAgo = readings[readings.length - 4].cgm.glucose_mgdl;
    const dropRate = (threeAgo - g) / 3; // mg/dL per 5 min
    if (g <= cfg.low_mgdl || (dropRate >= cfg.drop_rate_mgdl_per_5min && g < cfg.fast_drop_max_mgdl)) {
      const trend = dropRate >= cfg.drop_rate_mgdl_per_5min
        ? ` and dropping fast (~${Math.round(dropRate)} mg/dL per 5 min)`
        : "";
      return {
        level: "warning",
        source: dropRate >= cfg.drop_rate_mgdl_per_5min ? "drop_rate" : "current",
        message:
          `Hey, I noticed your glucose is at **${Math.round(g)} mg/dL (${lowMmol} mmol/L)**${trend}. ` +
          `Just checking in — how are you feeling? Have you eaten or taken any insulin recently?`,
      };
    }
  }

  // --- forecast minimum within horizon (PR #11) ---
  if (forecast && Array.isArray(forecast.medium) && forecast.medium.length) {
    const horizon = forecast.medium.filter((p) => p.minutes <= cfg.forecast_horizon_min);
    const minP = horizon.length ? Math.min(...horizon.map((p) => p.point)) : forecast.medium[0].point;
    const minAt = (horizon.find((p) => p.point === minP) || forecast.medium[0]).minutes;
    if (minP < cfg.forecast_threshold_mgdl) {
      return {
        level: minP < cfg.critical_mgdl ? "critical" : "warning",
        source: "forecast",
        message:
          `⚠️ Heads-up — flagging this before it happens: your predicted glucose is trending ` +
          `down to about **${Math.round(minP)} mg/dL at t+${minAt} min** (5-min forecast ` +
          `${forecast.short?.point} mg/dL), below the critical threshold of ${cfg.forecast_threshold_mgdl} mg/dL. ` +
          `Please reply within the response window to acknowledge — otherwise I'll start the ` +
          `escalation protocol.`,
      };
    }
  }

  return null;
}

/** Build the [SYSTEM EVENT] message that initiates the LLM conversation (PR #11 convention). */
export function buildSystemEvent(check, cfg = getProactiveConfig()) {
  if (check.source === "forecast") {
    return `[SYSTEM EVENT — predicted hypoglycemia] forecast minimum below ` +
      `${cfg.forecast_threshold_mgdl} mg/dL within ${cfg.forecast_horizon_min} min. ` +
      `Inform the patient what is about to happen and ask for acknowledgement.`;
  }
  return `[SYSTEM EVENT — low glucose detected] current reading ${check.level}. ` +
    `Check in with the patient: how do they feel, have they eaten or dosed recently?`;
}

const NO_RESPONSE_EVENT =
  "[SYSTEM EVENT — no response within the response window] Initiate the no-response " +
  "escalation protocol now: warn again, raise a critical alert, state which protocol steps are running.";

/**
 * Run one proactive-chat pass for all patients.
 *
 * @param {Store} store
 * @param {Map<string, Array>} conversations - patientId -> chat history array
 * @param {object} opts
 * @param {number} opts.cooldownMin - minimum minutes between proactive messages per patient
 * @param {number} opts.responseWindowMin - minutes to wait for a reply before escalating
 * @param {function} opts.initiate - async (patientId, systemEventMessage, check) => reply string.
 *   server.js passes a function that routes through runAgent (mock or real LLM).
 *   Default: resolves to the canned check.message (PR #12 behaviour, used by tests).
 * @param {number} opts.now - epoch ms override (tests)
 * Returns the number of proactive messages sent this pass.
 */
export async function runProactiveChatPass(store, conversations, opts = {}) {
  const cfg = getProactiveConfig();
  const cooldownMin = opts.cooldownMin ?? cfg.cooldown_min;
  const cooldownMs = cooldownMin * 60 * 1000;
  const windowMin = opts.responseWindowMin ?? cfg.response_window_min;
  const windowMs = windowMin * 60 * 1000;
  const now = opts.now ?? Date.now();
  const initiate = opts.initiate || (async (_pid, _msg, check) => check.message);
  let sent = 0;

  for (const pid of store.states.keys()) {
    const history = conversations.get(pid) || [];
    const lastProactiveIdx = history.findLastIndex(
      (m) => m.role === "assistant" && m.proactive === true
    );
    const lastProactive = lastProactiveIdx >= 0 ? history[lastProactiveIdx] : null;
    const userResponded = lastProactiveIdx >= 0 &&
      history.slice(lastProactiveIdx + 1).some((m) => m.role === "user");

    // --- no-response escalation (PR #11 protocol) ---
    const pend = pending.get(pid);
    if (pend) {
      if (!lastProactive || userResponded) {
        pending.delete(pid); // resolved (or history rotated) — stop tracking
      } else if (!pend.escalated && now - pend.at >= windowMs) {
        const reply = await initiate(pid, NO_RESPONSE_EVENT, { level: "critical", source: "no_response" });
        history.push({ role: "user", content: NO_RESPONSE_EVENT, systemEvent: true },
                     { role: "assistant", content: reply, proactive: true, level: "critical",
                       at: new Date(now).toISOString() });
        conversations.set(pid, history.slice(-20));
        pend.escalated = true;
        sent++;
        continue;
      } else {
        continue; // already watching / already escalated — don't re-trigger detection
      }
    }

    // --- detection (PR #12 state + PR #11 forecast) ---
    const forecast = store.get(pid).lastForecast || null;
    const check = checkProactiveChat(store, pid, forecast, cfg);
    if (!check) continue;

    // Cooldown: don't spam — skip if we already sent a proactive message recently
    if (lastProactive && now - new Date(lastProactive.at || 0).getTime() < cooldownMs) continue;
    // Skip if the user already responded after the last proactive message
    if (userResponded) continue;

    const event = buildSystemEvent(check, cfg);
    const reply = await initiate(pid, event, check);
    history.push({ role: "user", content: event, systemEvent: true },
                 { role: "assistant", content: reply, proactive: true, level: check.level,
                   at: new Date(now).toISOString() });
    conversations.set(pid, history.slice(-20));
    pending.set(pid, { at: now, escalated: false });
    sent++;
  }

  return sent;
}
