// Tests for proactive chat engine — zero-dep node:test
import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/state.js";
import { checkProactiveChat, runProactiveChatPass } from "../src/agent/proactive.js";

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

test("runProactiveChatPass: pushes assistant message into conversations", () => {
  const store = new Store();
  seedReadings(store, "p1", [90, 82, 75, 68]);
  const conversations = new Map();
  const sent = runProactiveChatPass(store, conversations);
  assert.equal(sent, 1);
  const history = conversations.get("p1");
  assert.equal(history.length, 1);
  assert.equal(history[0].role, "assistant");
  assert.equal(history[0].proactive, true);
});

test("runProactiveChatPass: respects cooldown (no duplicate within cooldown)", () => {
  const store = new Store();
  seedReadings(store, "p1", [90, 82, 75, 68]);
  const conversations = new Map();
  conversations.set("p1", [{
    role: "assistant", content: "previous heads-up", proactive: true,
    at: new Date().toISOString(),
  }]);
  const sent = runProactiveChatPass(store, conversations, { cooldownMin: 15 });
  assert.equal(sent, 0); // cooldown active
});

test("runProactiveChatPass: skips if user already responded after proactive msg", () => {
  const store = new Store();
  seedReadings(store, "p1", [90, 82, 75, 68]);
  const conversations = new Map();
  conversations.set("p1", [
    { role: "assistant", content: "heads-up", proactive: true, at: new Date(Date.now() - 20 * 60 * 1000).toISOString() },
    { role: "user", content: "I feel fine" },
  ]);
  const sent = runProactiveChatPass(store, conversations, { cooldownMin: 15 });
  assert.equal(sent, 0); // user already responded
});
