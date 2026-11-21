/** Mistral agent layer: conversational check-in + evidence-based advice.
 *
 * Agents API mode : MISTRAL_API_KEY set -> hosted agent on La Plateforme
 *                   (POST /v1/agents once, then POST /v1/conversations per
 *                   patient). Tool calls come back as function.call entries;
 *                   we execute them locally (tools.js) and append
 *                   function.call_result entries until the agent replies.
 *                   Conversation history lives server-side per patient.
 *                   Set MISTRAL_AGENT_ID to reuse an existing agent.
 * Mock mode       : no key -> deterministic scripted agent that CALLS THE SAME
 *                   TOOL IMPLEMENTATIONS, so the demo works without a key.
 *
 * Both modes return { reply, toolCalls } — the /chat/:patient contract is
 * unchanged, so apps/mobile needs no changes.
 */
import { makeToolSet } from "./tools.js";
import { SYSTEM_PROMPT } from "./prompt.js";
import { buildAgentContext } from "./context.js";

const MODEL = process.env.MISTRAL_MODEL || "mistral-large-latest";
const API = "https://api.mistral.ai/v1";

const MAX_ROUNDS = 3;
const MAX_RETRIES = 1;

/** Fetch with one retry on 5xx or network error. */
async function fetchWithRetry(url, opts, retries = MAX_RETRIES) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, opts);
      if (res.status >= 500 && attempt < retries) {
        lastErr = new Error(`mistral api ${res.status}`);
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

async function mistral(path, body) {
  const res = await fetchWithRetry(`${API}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`mistral api ${res.status}: ${await res.text()}`);
  return res.json();
}

/** Validate tool call arguments against expected shape. Returns error string or null. */
function validateToolArgs(name, args) {
  if (!args || typeof args !== "object") return `${name}: args must be an object`;
  switch (name) {
    case "predict":
      return null; // no args expected
    case "log_checkin": {
      for (const [k, v] of Object.entries(args)) {
        if (typeof v !== "number" && typeof v !== "string")
          return `log_checkin.${k} must be number or string`;
      }
      if (args.stress_1_5 !== undefined && (args.stress_1_5 < 1 || args.stress_1_5 > 5))
        return "log_checkin.stress_1_5 must be 1..5";
      return null;
    }
    case "send_alert": {
      if (!args.level || !["info", "warning", "critical"].includes(args.level))
        return "send_alert.level must be info|warning|critical";
      if (!args.message || typeof args.message !== "string")
        return "send_alert.message (string) required";
      return null;
    }
    default:
      return `unknown tool ${name}`;
  }
}

/** Extract plain text from a conversation output entry (string or chunk array). */
export function extractText(entry) {
  if (!entry) return "";
  const c = entry.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.filter((p) => p && p.type === "text").map((p) => p.text).join("");
  return "";
}

// ---- hosted conversations (Conversations API mode) ---------------------------
// Uses POST /v1/conversations with model+tools directly (works on orgs where
// agent creation is disabled). Set MISTRAL_AGENT_ID to use a hosted agent
// instead. History lives server-side per conversation.

const conversations = new Map(); // patientId -> conversation_id

/** Reset cached conversation state (tests). */
export function resetAgentState() {
  conversations.clear();
}

/** Drop the hosted conversation for one patient so the next message starts fresh. */
export function forgetConversation(patientId) {
  conversations.delete(patientId);
}

function conversationBase(toolDefs) {
  if (process.env.MISTRAL_AGENT_ID) return { agent_id: process.env.MISTRAL_AGENT_ID };
  return { model: MODEL, tools: toolDefs };
}

async function agentsApiRun(deps, tools, userMessage) {
  const patientId = deps.patientId;
  const toolCalls = [];
  // Inject current BE context on every turn so the LLM always sees live state
  const contextBlock = buildAgentContext(deps.store, patientId);
  const msgWithContext = `${contextBlock}\n\nPatient says: ${userMessage}`;

  let convId = conversations.get(patientId);
  let resp;
  if (convId) {
    resp = await mistral(`/conversations/${convId}`, {
      inputs: [{ object: "entry", type: "message.input", role: "user", content: msgWithContext }],
    });
  } else {
    // Base-model conversations don't accept a system role, so seed the prompt
    // as a user instruction + assistant acknowledgement, then the context+message.
    resp = await mistral("/conversations", {
      ...conversationBase(tools.defs),
      stream: false,
      inputs: [
        { object: "entry", type: "message.input", role: "user", content: SYSTEM_PROMPT },
        { object: "entry", type: "message.output", role: "assistant",
          content: "Understood — I'll follow these instructions." },
        { object: "entry", type: "message.input", role: "user", content: msgWithContext },
      ],
    });
    convId = resp.conversation_id;
    conversations.set(patientId, convId);
  }

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const calls = (resp.outputs || []).filter((o) => o.type === "function.call");
    if (calls.length === 0) {
      const lastMsg = [...(resp.outputs || [])].reverse().find((o) => o.type === "message.output");
      return { reply: extractText(lastMsg), toolCalls };
    }
    const results = [];
    for (const call of calls) {
      toolCalls.push(call.name);
      let args = {};
      try {
        args = typeof call.arguments === "string" ? JSON.parse(call.arguments || "{}") : call.arguments;
      } catch {
        args = {};
      }
      const argErr = validateToolArgs(call.name, args);
      const out = argErr ? { error: argErr } : await tools.execute(call.name, args, deps);
      results.push({
        object: "entry",
        type: "function.result",
        tool_call_id: call.tool_call_id,
        result: JSON.stringify(out),
      });
    }
    resp = await mistral(`/conversations/${convId}`, { inputs: results });
  }
  return { reply: "Let me check your latest data again in a moment.", toolCalls };
}

export async function runAgent(deps, history, userMessage) {
  const tools = makeToolSet(deps);
  if (!process.env.MISTRAL_API_KEY) {
    return mockAgent(tools, userMessage);
  }
  // Agents API mode: history is stored server-side per conversation; the
  // passed-in history is only used by mock mode.
  return agentsApiRun(deps, tools, String(userMessage));
}

// ---- mock agent: keyword FSM over the same tools (demo fallback) -----------
const num = (s) => { const m = s.match(/\d+(\.\d+)?/); return m ? Number(m[0]) : null; };
const NO_DATA_REPLY =
  "I don't have your CGM or pump readings yet, so I can't forecast — once your " +
  "device stream is running I'll have a live picture. I've noted what you told me. " +
  "Anything else?";

export async function mockAgent(tools, msg) {
  const m = msg.toLowerCase();
  const call = async (n, a) => tools.execute(n, a, tools.deps);

  // Proactive backend triggers (services/scenario/low_watch.py POSTs these so the
  // agent initiates the conversation): "[SYSTEM EVENT — predicted hypoglycemia] ..."
  // starts the patient-informing warning; "[SYSTEM EVENT — no response ...]" starts
  // the no-response escalation protocol. Same tools as a normal turn.
  if (m.startsWith("[system event")) {
    const f = await call("predict", {});
    if (!f || f.error) return { reply: NO_DATA_REPLY, toolCalls: ["predict"] };
    const horizon = f.medium || [];
    const minP = horizon.length ? Math.min(...horizon.map((p) => p.point)) : f.short.point;
    const minAt = horizon.find((p) => p.point === minP) || { minutes: 5 };
    const noResponse = m.includes("no response");
    const level = noResponse ? "critical" : "warning";
    await call("send_alert", {
      level,
      message: noResponse
        ? `No patient response within the response window after the predicted-low warning ` +
          `(min ${minP} mg/dL at t+${minAt.minutes} min). Escalation protocol started.`
        : `Predicted glucose trending down: min ${minP} mg/dL at t+${minAt.minutes} min, ` +
          `below the critical threshold of 70 mg/dL.`,
      suggested_action: f.action.class,
    });
    return {
      reply: noResponse
        ? `I haven't heard back from you within the response window, so I'm starting the ` +
          `escalation protocol now: predicted low of ${minP} mg/dL at t+${minAt.minutes} min ` +
          `(critical threshold 70 mg/dL), pump recommendation **${f.action.class}**. I've ` +
          `raised a ${level} alert on your dashboard. If you feel shaky or sweaty right now, ` +
          `treat the low with fast carbs immediately. This is guidance, not medical advice.`
        : `⚠️ Heads-up — flagging this before it happens: your predicted glucose is trending ` +
          `down, about ${minP} mg/dL at t+${minAt.minutes} min (5-min forecast ${f.short.point}), ` +
          `below the critical threshold of 70 mg/dL. Pump recommendation: **${f.action.class}**. ` +
          `Please reply within the response window to acknowledge — otherwise I'll start the ` +
          `escalation protocol. This is guidance, not medical advice.`,
      toolCalls: ["predict", "send_alert"],
    };
  }

  if (/(ate|eat|meal|lunch|dinner|breakfast|carbs?)/.test(m)) {
    const g = num(msg) ?? 60;
    await call("log_checkin", { carbs_g: g });
    const f = await call("predict", {});
    if (!f || f.error) return { reply: NO_DATA_REPLY, toolCalls: ["log_checkin", "predict"] };
    return { reply:
      `Got it — about ${g} g of carbs logged. Your forecast: ${f.short.point} mg/dL in 5 ` +
      `minutes, ${f.medium[f.medium.length - 1].point} in an hour. Pump recommendation: ` +
      `**${f.action.class}** (p=${f.action.probs[f.action.class]}). ` +
      `How did you sleep last night, by the way?`, toolCalls: ["log_checkin", "predict"] };
  }
  if (/(sleep|slept|tired|insomnia)/.test(m)) {
    const h = num(msg) ?? 7;
    await call("log_checkin", { sleep_hours: h });
    const f = await call("predict", {});
    if (!f || f.error) return { reply: NO_DATA_REPLY, toolCalls: ["log_checkin", "predict"] };
    return { reply:
      `${h} hours — noted, that feeds your overnight risk forecast. Tonight's first ` +
      `window: min ${f.long[0].min_q10} mg/dL (${f.long[0].risk} risk). Did you exercise today?`,
      toolCalls: ["log_checkin", "predict"] };
  }
  if (/(ran|run|exercis|workout|gym|walk|cycl|sport)/.test(m)) {
    const minsCache = /(\d+)\s*min/i.exec(msg);
    const mins = minsCache ? Number(minsCache[1]) : (num(msg) ?? 30);
    await call("log_checkin", { exercise_min: mins, exercise_type: "cardio", intensity: "moderate" });
    const f = await call("predict", {});
    if (!f || f.error) return { reply: NO_DATA_REPLY, toolCalls: ["log_checkin", "predict"] };
    let extra = "";
    if (f.action.class === "reduce_basal" || f.action.class === "suspend") {
      await call("send_alert", {
        level: "warning",
        message: `Exercise detected. Forecast suggests ${f.action.class.replace("_", " ")} ` +
                 `to avoid a low (${f.short.point} mg/dL and falling).`,
        suggested_action: f.action.class,
      });
      extra = " I've raised an approval card on your dashboard.";
    }
    return { reply:
      `Nice work! ${mins} minutes of activity logged. Exercise raises your insulin ` +
      `sensitivity, so your 1-hour forecast dipped to ` +
      `${f.medium[f.medium.length - 1].point} mg/dL. Pump recommendation: ` +
      `**${f.action.class}**.${extra} How's your stress today (1–5)?`,
      toolCalls: ["log_checkin", "predict", "send_alert"] };
  }
  if (/(stress|anxious|anxiety|pressure|swamped|calm)/.test(m)) {
    const lvl = Math.min(5, Math.max(1, num(msg) ?? 3));
    await call("log_checkin", { stress_1_5: lvl });
    const f = await call("predict", {});
    if (!f || f.error) return { reply: NO_DATA_REPLY, toolCalls: ["log_checkin", "predict"] };
    return { reply:
      `Thanks for being honest — stress of ${lvl}/5 tends to nudge glucose up, so I've ` +
      `factored it in. Current 1-hour forecast: ${f.medium[f.medium.length - 1].point} mg/dL. ` +
      `How much did you eat in the last few hours?`,
      toolCalls: ["log_checkin", "predict"] };
  }
  // Status update in response to a proactive low-glucose heads-up
  // Status-update keywords as whole words not glued to other letters/hyphens, so
  // e.g. "low-carb lunch" does not misfire. The "[system event" branch above runs first.
  if (/(?<![\w-])(fine|ok|okay|good|shaky|sweaty|dizzy|hypo|treated|juice|snack|low|dropping|falling|dropped)(?![\w-])/.test(m)) {
    const f = await call("predict", {});
    const isSymptomatic = /(shaky|sweaty|dizzy|hypo)/.test(m);
    const treated = /(treated|juice|snack|ate)/.test(m);

    if (isSymptomatic && !treated) {
      await call("send_alert", {
        level: "critical",
        message: `Patient reports hypo symptoms (shaky/sweaty/dizzy) at low glucose. ` +
                 `Recommend immediate fast carbs (~15g) and monitor.`,
        suggested_action: "no_op",
      });
      const outlook = f && !f.error
        ? ` Forecast: ${f.short.point} mg/dL in 5 min, ${f.medium[f.medium.length - 1].point} in 1 h.`
        : "";
      return { reply:
        `I'm glad you told me — shaky/sweaty/dizzy means your body needs sugar **now**. ` +
        `Have ~15g of fast carbs (juice, glucose tabs) and stay somewhere safe.${outlook} ` +
        `I've flagged this on your dashboard. Let me know once you've treated it.`,
        toolCalls: ["predict", "send_alert"] };
    }
    if (treated) {
      await call("log_checkin", { carbs_g: 15 });
      const outlook = f && !f.error
        ? ` Forecast: ${f.short.point} mg/dL in 5 min, trending to ${f.medium[f.medium.length - 1].point} in 1 h.`
        : "";
      return { reply:
        `Good — I've logged ~15g of fast carbs.${outlook} Keep an eye on your CGM over the next ` +
        `30 min. If you still feel off or the numbers keep dropping, have another 15g and tell me. ` +
        `Anything else on your mind?`,
        toolCalls: ["log_checkin", "predict"] };
    }
    // Just "fine" / "ok" — acknowledge and keep monitoring
    const outlook = f && !f.error
      ? ` Right now: ${f.short.point} mg/dL in 5 min, ${f.medium[f.medium.length - 1].point} in 1 h.`
      : "";
    return { reply:
      `Good to hear.${outlook} I'll keep watching your numbers — if the trend continues down ` +
      `I'll check in again. Anything you want to log (food, insulin, activity)?`,
      toolCalls: ["predict"] };
  }
  if (/(sugar|glucose|reading|forecast|predict|level|how am i|status|feel|shaky)/.test(m)) {
    const f = await call("predict", {});
    if (!f || f.error) return { reply: NO_DATA_REPLY, toolCalls: ["predict"] };
    const risky = f.long.find((b) => b.risk === "high");
    return { reply:
      `Here's your outlook. 5 min: ${f.short.point}. 1 h: ` +
      `${f.medium[f.medium.length - 1].point}. ` +
      (risky ? `The highest-risk window in the next 24 h starts at hour ${risky.window_start_h}. `
             : `No high-risk windows in the next 24 h. `) +
      `Pump recommendation: **${f.action.class}**. How much did you eat recently?`,
      toolCalls: ["predict"] };
  }
  return { reply:
    `Hi! I'm your GlucoLoop assistant. To sharpen your forecast, tell me a few things: ` +
    `how much did you eat recently? Did you sleep well? Any exercise? How's your ` +
    `stress, 1 to 5?`, toolCalls: [] };
}
