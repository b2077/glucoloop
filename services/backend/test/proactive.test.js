// Tests for proactive chat engine — zero-dep node:test
import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/state.js";
import { checkProactiveChat, runProactiveChatPass, resetProactiveState, buildSystemEvent } from "../src/agent/proactive.js";

function seedReadings(store, patientId, glucoseValues) {
  glucoseValues.forEach((g, i) => {
    store.ingest({
      patient_id: patientId, type: "cgm", t: i * 5,
      cgm: { glucose_mgdl: g, cgm_quality: "ok", hr: 70, activity: "none" },
      pump: { iob_units: 1, commanded_basal_u_hr: 1, delivered_basal_u_hr: 1, pump_status: "ok" },
    });
  });
}

test("checkProactiveChat: returns null when glucose is stable and in range", () => {
  const store = new Store();
  seedReadings(store, "p1", [120, 118, 115, 112]);
  assert.equal(checkProactiveChat(store, "p1"), null);
});

test("checkProactiveChat: returns null with too few readings", () => {
  const store = new Store();
  seedReadings(store, "p1", [65, 60]);
  assert.equal(checkProactiveChat(store, "p1"), null);
});

test("checkProactiveChat: critical message when glucose < 70", () => {
  const store = new Store();
  seedReadings(store, "p1", [85, 78, 72, 66]);
  const result = checkProactiveChat(store, "p1");
  assert.ok(result);
  assert.equal(result.level, "critical");
  assert.match(result.message, /66 mg\/dL/);
  assert.match(result.message, /shaky|sweaty|dizzy/i);
});

test("checkProactiveChat: warning when glucose <= 80", () => {
  const store = new Store();
  seedReadings(store, "p1", [95, 88, 82, 78]);
  const result = checkProactiveChat(store, "p1");
  assert.ok(result);
  assert.equal(result.level, "warning");
  assert.match(result.message, /78 mg\/dL/);
});

test("checkProactiveChat: warning when dropping fast from higher range", () => {
  const store = new Store();
  seedReadings(store, "p1", [130, 118, 108, 100]);
  const result = checkProactiveChat(store, "p1");
  assert.ok(result);
  assert.equal(result.level, "warning");
  assert.match(result.message, /dropping fast/i);
});

test("runProactiveChatPass: pushes assistant message into conversations", async () => {
  const store = new Store();
  seedReadings(store, "p1", [90, 82, 75, 68]);
  const conversations = new Map();
  const sent = await runProactiveChatPass(store, conversations);
  assert.equal(sent, 1);
  const history = conversations.get("p1");
  assert.equal(history.length, 2); // [SYSTEM EVENT] user entry + assistant reply
  assert.equal(history[0].role, "user");
  assert.equal(history[0].systemEvent, true);
  assert.equal(history[1].role, "assistant");
  assert.equal(history[1].proactive, true);
});

test("runProactiveChatPass: respects cooldown (no duplicate within cooldown)", async () => {
  const store = new Store();
  seedReadings(store, "p1", [90, 82, 75, 68]);
  const conversations = new Map();
  conversations.set("p1", [{
    role: "assistant", content: "previous heads-up", proactive: true,
    at: new Date().toISOString(),
  }]);
  const sent = await runProactiveChatPass(store, conversations, { cooldownMin: 15 });
  assert.equal(sent, 0); // cooldown active
});

test("runProactiveChatPass: skips if user already responded after proactive msg", async () => {
  const store = new Store();
  seedReadings(store, "p1", [90, 82, 75, 68]);
  const conversations = new Map();
  conversations.set("p1", [
    { role: "assistant", content: "heads-up", proactive: true, at: new Date(Date.now() - 20 * 60 * 1000).toISOString() },
    { role: "user", content: "I feel fine" },
  ]);
  const sent = await runProactiveChatPass(store, conversations, { cooldownMin: 15 });
  assert.equal(sent, 0); // user already responded
});


// ---- consolidated behaviour: forecast detection, LLM initiation, escalation ----

const FAKE_LOW_FORECAST = {
  short: { minutes: 5, point: 95 },
  medium: [{ minutes: 5, point: 95 }, { minutes: 15, point: 82 }, { minutes: 30, point: 68 },
           { minutes: 45, point: 66 }, { minutes: 60, point: 72 }],
  long: [],
  action: { class: "suspend", probs: { suspend: 0.9 } },
  model_version: "test",
};

test("checkProactiveChat: forecast min below threshold triggers (PR #11 detection)", () => {
  resetProactiveState();
  const store = new Store();
  seedReadings(store, "p1", [120, 118, 115, 112]); // currently fine
  const result = checkProactiveChat(store, "p1", FAKE_LOW_FORECAST);
  assert.ok(result);
  assert.equal(result.source, "forecast");
  assert.equal(result.level, "critical"); // min 66 < 70
  assert.match(result.message, /66 mg\/dL at t\+45/);
});

test("checkProactiveChat: forecast above threshold → null", () => {
  resetProactiveState();
  const store = new Store();
  seedReadings(store, "p1", [120, 118, 115, 112]);
  const ok = { ...FAKE_LOW_FORECAST, medium: [{ minutes: 5, point: 100 }, { minutes: 60, point: 95 }] };
  assert.equal(checkProactiveChat(store, "p1", ok), null);
});

test("runProactiveChatPass: routes initiation through opts.initiate ([SYSTEM EVENT] → LLM)", async () => {
  resetProactiveState();
  const store = new Store();
  seedReadings(store, "p1", [90, 82, 75, 68]);
  store.get("p1").lastForecast = FAKE_LOW_FORECAST;
  const conversations = new Map();
  const seen = [];
  const initiate = async (pid, msg) => { seen.push(msg); return "LLM-composed warning"; };
  const sent = await runProactiveChatPass(store, conversations, { initiate, now: 1000 });
  assert.equal(sent, 1);
  assert.equal(seen.length, 1);
  assert.match(seen[0], /^\[SYSTEM EVENT/);
  const history = conversations.get("p1");
  assert.equal(history[0].role, "user");
  assert.equal(history[0].systemEvent, true);
  assert.equal(history[1].role, "assistant");
  assert.equal(history[1].content, "LLM-composed warning");
  assert.equal(history[1].proactive, true);
});

test("runProactiveChatPass: no-response escalation after response window (PR #11 protocol)", async () => {
  resetProactiveState();
  const store = new Store();
  seedReadings(store, "p1", [90, 82, 75, 68]);
  const conversations = new Map();
  const t0 = 1_000_000;
  const seen = [];
  const initiate = async (_pid, msg) => { seen.push(msg); return "reply"; };
  const sent1 = await runProactiveChatPass(store, conversations, { initiate, now: t0, responseWindowMin: 30 });
  assert.equal(sent1, 1);
  const sent2 = await runProactiveChatPass(store, conversations, { initiate, now: t0 + 10 * 60 * 1000, responseWindowMin: 30 });
  assert.equal(sent2, 0); // still within window
  const sent3 = await runProactiveChatPass(store, conversations, { initiate, now: t0 + 31 * 60 * 1000, responseWindowMin: 30 });
  assert.equal(sent3, 1); // escalated once
  assert.match(seen[1], /no response/i);
  const history = conversations.get("p1");
  const last = history[history.length - 1];
  assert.equal(last.proactive, true);
  assert.equal(last.level, "critical");
  const sent4 = await runProactiveChatPass(store, conversations, { initiate, now: t0 + 60 * 60 * 1000, responseWindowMin: 30 });
  assert.equal(sent4, 0); // does not escalate twice
});

test("runProactiveChatPass: user reply cancels escalation", async () => {
  resetProactiveState();
  const store = new Store();
  seedReadings(store, "p1", [90, 82, 75, 68]);
  const conversations = new Map();
  const t0 = 1_000_000;
  const initiate = async () => "reply";
  await runProactiveChatPass(store, conversations, { initiate, now: t0, responseWindowMin: 30 });
  conversations.get("p1").push({ role: "user", content: "I'm fine" });
  const sent = await runProactiveChatPass(store, conversations, { initiate, now: t0 + 45 * 60 * 1000, responseWindowMin: 30 });
  assert.equal(sent, 0);
});

test("buildSystemEvent: forecast source mentions threshold and horizon", () => {
  resetProactiveState();
  const ev = buildSystemEvent({ source: "forecast", level: "warning", message: "x" });
  assert.match(ev, /predicted hypoglycemia/);
  assert.match(ev, /70 mg\/dL/);
});
