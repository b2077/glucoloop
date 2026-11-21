/** Mistral agent layer: conversational check-in + evidence-based advice.
 *
 * Real mode  : MISTRAL_API_KEY set -> api.mistral.ai chat completions with
 *              function calling (tools: predict, log_checkin, send_alert).
 * Mock mode  : no key -> deterministic scripted agent that CALLS THE SAME TOOL
 *              IMPLEMENTATIONS, so the demo works without a key.
 */
import { makeToolSet } from "./tools.js";
import { SYSTEM_PROMPT } from "./prompt.js";

const MODEL = process.env.MISTRAL_MODEL || "mistral-large-latest";

export async function runAgent(deps, history, userMessage) {
  const tools = makeToolSet(deps);
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ];

  if (!process.env.MISTRAL_API_KEY) {
    return mockAgent(tools, userMessage);
  }

  const toolCalls = [];
  for (let round = 0; round < 3; round++) {
    const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
      },
      body: JSON.stringify({ model: MODEL, messages, tools: tools.defs,
                             tool_choice: "auto", temperature: 0.4 }),
    });
    if (!res.ok) throw new Error(`mistral api ${res.status}: ${await res.text()}`);
    const choice = (await res.json()).choices[0].message;
    if (choice.tool_calls && choice.tool_calls.length > 0) {
      messages.push(choice);
      for (const tc of choice.tool_calls) {
        const args = JSON.parse(tc.function.arguments || "{}");
        const out = await tools.execute(tc.function.name, args, deps);
        toolCalls.push(tc.function.name);
        messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(out) });
      }
      continue;
    }
    return { reply: choice.content, toolCalls };
  }
  return { reply: "Let me check your latest data again in a moment.", toolCalls };
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

  if (/(ate|eat|meal|lunch|dinner|breakfast|carbs?)/.test(m)) {
    const g = num(msg) ?? 60;
    await call("log_checkin", { carbs_g: g });
    const f = await call("predict", {});
    if (!f || f.error) return { reply: NO_DATA_REPLY, toolCalls: ["predict"] };
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
    if (!f || f.error) return { reply: NO_DATA_REPLY, toolCalls: ["predict"] };
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
    if (!f || f.error) return { reply: NO_DATA_REPLY, toolCalls: ["predict"] };
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
    if (!f || f.error) return { reply: NO_DATA_REPLY, toolCalls: ["predict"] };
    return { reply:
      `Thanks for being honest — stress of ${lvl}/5 tends to nudge glucose up, so I've ` +
      `factored it in. Current 1-hour forecast: ${f.medium[f.medium.length - 1].point} mg/dL. ` +
      `How much did you eat in the last few hours?`,
      toolCalls: ["log_checkin", "predict"] };
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
