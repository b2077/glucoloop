// Tests for the Agents API mode of mistral.js — zero-dep node:test.
// global.fetch is mocked; no network, no API key needed.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.MISTRAL_API_KEY = "test-key";
delete process.env.MISTRAL_AGENT_ID;

import { Store } from "../src/state.js";
import { makeToolSet } from "../src/agent/tools.js";
import { runAgent, extractText, resetAgentState } from "../src/agent/mistral.js";

function makeDeps(patientId = "agents-api-test") {
  const store = new Store();
  store.ingest({
    patient_id: patientId, type: "cgm", t: 0,
    cgm: { glucose_mgdl: 100, cgm_quality: "ok", hr: 70, activity: "none" },
    pump: { iob_units: 1, commanded_basal_u_hr: 1, delivered_basal_u_hr: 1, pump_status: "ok" },
  });
  return { store, mlUrl: "http://localhost:19999", patientId };
}

/** Install a fetch mock driven by a handler fn(url, body) -> {status, json}. */
function mockFetch(handler, calls) {
  globalThis.fetch = async (url, opts) => {
    const body = opts?.body ? JSON.parse(opts.body) : null;
    calls.push({ url: String(url), body });
    const r = await handler(String(url), body);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.json,
      text: async () => JSON.stringify(r.json),
    };
  };
}

beforeEach(() => {
  resetAgentState();
});

test("extractText handles string and chunk-array content", () => {
  assert.equal(extractText({ content: "hello" }), "hello");
  assert.equal(extractText({ content: [
    { type: "thinking", thinking: "hmm" },
    { type: "text", text: "foo" },
    { type: "text", text: "bar" },
  ] }), "foobar");
  assert.equal(extractText(null), "");
});

test("agents api: creates agent once, starts conversation, returns text reply", async () => {
  const calls = [];
  mockFetch((url, body) => {
    if (url.endsWith("/conversations")) {
      assert.equal(body.model, "mistral-large-latest");
      assert.equal(body.tools.length, 3);
      assert.equal(body.inputs[0].role, "user");     // system prompt seeded as user msg
      assert.equal(body.inputs[1].role, "assistant"); // ack
      assert.equal(body.inputs[2].role, "user");      // real message
      return { status: 200, json: {
        conversation_id: "conv_1",
        outputs: [{ type: "message.output", content: "Hi! How much did you eat?" }],
      } };
    }
    if (url.includes("/conversations/conv_1")) {
      return { status: 200, json: {
        outputs: [{ type: "message.output", content: "Noted — 80 g logged." }],
      } };
    }
    return { status: 404, json: { error: "unexpected " + url } };
  }, calls);

  const deps = makeDeps();
  const r1 = await runAgent(deps, [], "hello");
  assert.equal(r1.reply, "Hi! How much did you eat?");
  assert.deepEqual(r1.toolCalls, []);

  // second message reuses the conversation (append, not new conversation)
  const r2 = await runAgent(deps, [], "I ate 80g carbs");
  const convCalls = calls.filter((c) => c.url.includes("/conversations"));
  assert.equal(convCalls.filter((c) => c.url.endsWith("/conversations")).length, 1);
  assert.ok(convCalls.some((c) => c.url.includes("/conversations/conv_1")));
});

test("agents api: executes function.call and appends function.call_result", async () => {
  const calls = [];
  mockFetch((url, body) => {
    if (url.endsWith("/conversations")) {
      return { status: 200, json: {
        conversation_id: "conv_9",
        outputs: [{
          type: "function.call", tool_call_id: "fc_1", name: "predict",
          arguments: JSON.stringify({}),
        }],
      } };
    }
    if (/\/conversations\/conv_\w+$/.test(url)) {
      // function.call_result appended with the tool output
      const entry = body.inputs[0];
      assert.equal(entry.type, "function.result");
      assert.equal(entry.tool_call_id, "fc_1");
      const result = JSON.parse(entry.result);
      assert.ok(result.error); // ML unreachable in tests -> error payload is fine
      return { status: 200, json: {
        outputs: [{ type: "message.output", content: [
          { type: "text", text: "Your readings look unavailable right now." },
        ] }],
      } };
    }
    return { status: 404, json: { error: "unexpected " + url } };
  }, calls);

  const r = await runAgent(makeDeps("p-fc"), [], "how am I doing?");
  assert.equal(r.reply, "Your readings look unavailable right now.");
  assert.deepEqual(r.toolCalls, ["predict"]);
});

test("agents api: bad tool args produce error result, not a crash", async () => {
  const calls = [];
  mockFetch((url, body) => {
    if (url.endsWith("/conversations")) {
      return { status: 200, json: {
        conversation_id: "conv_x",
        outputs: [{ type: "function.call", tool_call_id: "fc_e", name: "send_alert",
                    arguments: JSON.stringify({ level: "bogus" }) }],
      } };
    }
    if (/\/conversations\/conv_\w+$/.test(url)) {
      const result = JSON.parse(body.inputs[0].result);
      assert.match(result.error, /send_alert.level/);
      return { status: 200, json: { outputs: [{ type: "message.output", content: "ok" }] } };
    }
    return { status: 404, json: { error: url } };
  }, calls);

  const r = await runAgent(makeDeps("p-err"), [], "alert me");
  assert.equal(r.reply, "ok");
  assert.deepEqual(r.toolCalls, ["send_alert"]);
});
