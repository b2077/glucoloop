// Tests for the mock agent and tool set — zero-dep node:test
import { test } from "node:test";
import assert from "node:assert/strict";
delete process.env.MISTRAL_API_KEY; // force mock mode
import { Store } from "../src/state.js";
import { makeToolSet } from "../src/agent/tools.js";
import { mockAgent } from "../src/agent/mistral.js";

function makeDeps(patientId = "agent-test") {
  const store = new Store();
  // Seed a reading so predict has data (but ML is unreachable → error path)
  store.ingest({
    patient_id: patientId, type: "cgm", t: 0,
    cgm: { glucose_mgdl: 100, cgm_quality: "ok", hr: 70, activity: "none" },
    pump: { iob_units: 1, commanded_basal_u_hr: 1, delivered_basal_u_hr: 1, pump_status: "ok" },
  });
  return { store, mlUrl: "http://localhost:19999", patientId };
}

test("makeToolSet: defs has 3 tools", () => {
  const tools = makeToolSet(makeDeps());
  assert.equal(tools.defs.length, 3);
  const names = tools.defs.map((d) => d.function.name).sort();
  assert.deepEqual(names, ["log_checkin", "predict", "send_alert"]);
});

test("tools.execute: predict returns error when ML unreachable", async () => {
  const deps = makeDeps();
  const tools = makeToolSet(deps);
  const out = await tools.execute("predict", {}, deps);
  assert.ok(out.error); // ml_unreachable or ml_error
});

test("tools.execute: predict returns no_data when no readings", async () => {
  const store = new Store();
  const deps = { store, mlUrl: "http://localhost:19999", patientId: "empty" };
  const tools = makeToolSet(deps);
  const out = await tools.execute("predict", {}, deps);
  assert.equal(out.error, "no_data");
});

test("tools.execute: log_checkin stores data", async () => {
  const deps = makeDeps();
  const tools = makeToolSet(deps);
  const out = await tools.execute("log_checkin", { carbs_g: 45 }, deps);
  assert.equal(out.ok, true);
  assert.equal(out.checkin.carbs_g, 45);
});

test("tools.execute: send_alert creates alert", async () => {
  const deps = makeDeps();
  const tools = makeToolSet(deps);
  const out = await tools.execute("send_alert", { level: "warning", message: "test" }, deps);
  assert.equal(out.ok, true);
  assert.equal(out.alert.level, "warning");
  assert.ok(out.alert.id);
});

test("tools.execute: unknown tool returns error", async () => {
  const deps = makeDeps();
  const tools = makeToolSet(deps);
  const out = await tools.execute("bogus", {}, deps);
  assert.match(out.error, /unknown tool/);
});

test("mockAgent: carbs message calls log_checkin + predict", async () => {
  const deps = makeDeps();
  const tools = makeToolSet(deps);
  const { reply, toolCalls } = await mockAgent(tools, "I ate 60g of carbs for lunch");
  assert.ok(toolCalls.includes("log_checkin"));
  assert.ok(toolCalls.includes("predict"));
  assert.ok(reply.length > 0);
});

test("mockAgent: sleep message logs sleep_hours", async () => {
  const deps = makeDeps();
  const tools = makeToolSet(deps);
  const { toolCalls } = await mockAgent(tools, "I slept 6 hours");
  assert.ok(toolCalls.includes("log_checkin"));
});

test("mockAgent: unknown message returns greeting", async () => {
  const deps = makeDeps();
  const tools = makeToolSet(deps);
  const { reply, toolCalls } = await mockAgent(tools, "blorp");
  assert.deepEqual(toolCalls, []);
  assert.match(reply, /GlucoLoop assistant/);
});

test("mockAgent: no data → NO_DATA_REPLY when predict fails", async () => {
  const store = new Store(); // no readings
  const deps = { store, mlUrl: "http://localhost:19999", patientId: "empty" };
  const tools = makeToolSet(deps);
  const { reply } = await mockAgent(tools, "what is my glucose level?");
  assert.match(reply, /don't have your CGM/);
});

// ---- proactive [SYSTEM EVENT] triggers (services/scenario/low_watch.py) ----

const FAKE_FORECAST = {
  short: { minutes: 5, point: 68.8 },
  medium: [{ minutes: 5, point: 68.8 }, { minutes: 15, point: 69 }, { minutes: 30, point: 68 },
           { minutes: 45, point: 68 }, { minutes: 60, point: 75 }],
  long: [],
  action: { class: "suspend", probs: { suspend: 0.9 } },
  model_version: "test",
};

function fakeTools(forecast = FAKE_FORECAST) {
  const calls = [];
  return {
    deps: {},
    calls,
    execute: async (name, args) => {
      calls.push({ name, args });
      if (name === "predict") return forecast;
      return { ok: true, alert: { level: args?.level, message: args?.message } };
    },
  };
}

test("mockAgent: [SYSTEM EVENT] predicted low warns the patient and alerts", async () => {
  const tools = fakeTools();
  const { reply, toolCalls } = await mockAgent(
    tools, "[SYSTEM EVENT — predicted hypoglycemia] forecast min 68 mg/dL at t+45, threshold 70. Inform the patient.");
  assert.deepEqual(toolCalls, ["predict", "send_alert"]);
  assert.match(reply, /trending down/);
  assert.match(reply, /70 mg\/dL/);
  assert.match(reply, /acknowledge/);
  const alert = tools.calls.find((c) => c.name === "send_alert");
  assert.equal(alert.args.level, "warning");
  assert.equal(alert.args.suggested_action, "suspend");
});

test("mockAgent: [SYSTEM EVENT] no response starts escalation protocol with critical alert", async () => {
  const tools = fakeTools();
  const { reply, toolCalls } = await mockAgent(
    tools, "[SYSTEM EVENT — no response within the response window] Initiate the no-response escalation protocol now.");
  assert.deepEqual(toolCalls, ["predict", "send_alert"]);
  assert.match(reply, /escalation protocol/);
  const alert = tools.calls.find((c) => c.name === "send_alert");
  assert.equal(alert.args.level, "critical");
});

test("mockAgent: [SYSTEM EVENT] with unreachable ML → NO_DATA_REPLY", async () => {
  const deps = makeDeps();
  const tools = makeToolSet(deps); // mlUrl unreachable
  const { reply, toolCalls } = await mockAgent(tools, "[SYSTEM EVENT — predicted hypoglycemia] ...");
  assert.deepEqual(toolCalls, ["predict"]);
  assert.match(reply, /don't have your CGM|can't forecast/);
});
