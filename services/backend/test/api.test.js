// Integration tests for the REST API — spins up the server on a test port
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

const TEST_PORT = 18100;
process.env.PORT = String(TEST_PORT);
process.env.ML_URL = "http://localhost:19999"; // intentionally unreachable
delete process.env.MISTRAL_API_KEY; // force mock agent mode

const base = `http://localhost:${TEST_PORT}`;

describe("REST API", () => {
  let server;

  before(async () => {
    const mod = await import("../src/server.js");
    server = mod.server;
    await new Promise((r) => server.listen(TEST_PORT, r));
  });

  after(() => server.close());

  const post = (path, body) => fetch(base + path, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json().then((d) => ({ status: r.status, body: d })));
  const get = (path) => fetch(base + path).then((r) => r.json().then((d) => ({ status: r.status, body: d })));

  test("GET /health returns up", async () => {
    const { status, body } = await get("/health");
    assert.equal(status, 200);
    assert.equal(body.status, "up");
    assert.ok("agent_mode" in body);
    assert.ok("uptime_s" in body);
  });

  test("GET /dashboard returns HTML", async () => {
    const r = await fetch(base + "/dashboard");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /text\/html/);
    const html = await r.text();
    assert.match(html, /GlucoLoop Backend Dashboard/);
  });

  test("GET /metrics returns request stats", async () => {
    const { status, body } = await get("/metrics");
    assert.equal(status, 200);
    assert.ok("uptime_s" in body);
    assert.ok("requests" in body);
    assert.ok("store" in body);
  });

  test("POST /ingest with valid reading", async () => {
    const { status, body } = await post("/ingest", {
      patient_id: "api-test", type: "cgm", t: 0,
      cgm: { glucose_mgdl: 110, cgm_quality: "ok", hr: 70, activity: "none" },
      pump: { iob_units: 1, commanded_basal_u_hr: 1.1, delivered_basal_u_hr: 1.1, pump_status: "ok" },
    });
    assert.equal(status, 200);
    assert.equal(body.status, "ingested");
  });

  test("POST /ingest missing patient_id → 400", async () => {
    const { status, body } = await post("/ingest", { type: "cgm", t: 0 });
    assert.equal(status, 400);
    assert.match(body.error, /patient_id/);
  });

  test("POST /ingest invalid reading → 422", async () => {
    const { status, body } = await post("/ingest", { patient_id: "x", type: "bad", t: "no" });
    assert.equal(status, 422);
    assert.ok(Array.isArray(body.validationErrors));
  });

  test("POST /ingest invalid JSON → 400", async () => {
    const r = await fetch(base + "/ingest", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{bad json",
    });
    assert.equal(r.status, 400);
  });

  test("GET /state/:id returns summary", async () => {
    const { status, body } = await get("/state/api-test");
    assert.equal(status, 200);
    assert.equal(body.patient_id, "api-test");
    assert.ok(Array.isArray(body.history));
  });

  test("GET /forecast/:id → 502 when ML down", async () => {
    const { status, body } = await get("/forecast/api-test");
    assert.equal(status, 502);
    assert.match(body.error, /ml service unreachable/);
  });

  test("POST /chat/:id missing message → 400", async () => {
    const { status } = await post("/chat/api-test", {});
    assert.equal(status, 400);
  });

  test("POST /chat/:id with message → 200 (mock agent)", async () => {
    const { status, body } = await post("/chat/api-test", { message: "hello" });
    assert.equal(status, 200);
    assert.ok(typeof body.reply === "string");
    assert.ok(Array.isArray(body.toolCalls));
  });

  test("GET unknown path → 404", async () => {
    const { status } = await get("/nope");
    assert.equal(status, 404);
  });

  // ---- FE issue #5: new endpoints ----
  test("GET /readings/:id returns full history with mmol conversion", async () => {
    // Ingest a few readings first
    for (let i = 0; i < 5; i++) {
      await post("/ingest", {
        patient_id: "rd-test", type: "cgm", t: i * 5,
        cgm: { glucose_mgdl: 90 + i * 10, cgm_quality: "ok", hr: 70, activity: "none" },
        pump: { iob_units: 1, commanded_basal_u_hr: 1.1, delivered_basal_u_hr: 1.1, pump_status: "ok" },
      });
    }
    const { status, body } = await get("/readings/rd-test");
    assert.equal(status, 200);
    assert.equal(body.count, 5);
    assert.equal(body.readings[0].glucose_mmol, 5); // 90/18 = 5.0
    assert.ok(body.readings[0].glucose_mgdl);
  });

  test("GET /tir/:id?range=all returns TIR in 4-10 mmol/L", async () => {
    const { status, body } = await get("/tir/rd-test?range=all");
    assert.equal(status, 200);
    assert.equal(body.range.low_mmol, 4);
    assert.equal(body.range.high_mmol, 10);
    assert.equal(body.total, 5);
    assert.ok(body.tir_pct >= 0 && body.tir_pct <= 100);
  });

  test("GET /tir/:id?range=1h returns 1h window", async () => {
    const { status, body } = await get("/tir/rd-test?range=1h");
    assert.equal(status, 200);
    assert.equal(body.range_label, "1h");
  });

  test("PUT /profile/:id then GET returns saved profile", async () => {
    const put = await fetch(base + "/profile/prof-test", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ic_ratio_g_per_u: 12, isf_mgdl_per_u: 45, basal_u_hr: 1.3 }),
    }).then((r) => r.json());
    assert.equal(put.profile.ic_ratio_g_per_u, 12);
    assert.equal(put.profile.basal_u_hr, 1.3);

    const { status, body } = await get("/profile/prof-test");
    assert.equal(status, 200);
    assert.equal(body.profile.isf_mgdl_per_u, 45);
  });

  test("GET /recommendations/:id returns list", async () => {
    const { status, body } = await get("/recommendations/rd-test");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.recommendations));
  });

  test("GET /state/:id includes tir_1h, tir_24h, profile, readings_count", async () => {
    const { status, body } = await get("/state/rd-test");
    assert.equal(status, 200);
    assert.ok("tir_1h" in body);
    assert.ok("tir_24h" in body);
    assert.ok("readings_count" in body);
    assert.ok("profile" in body);
  });

  test("GET /state/:id includes chat_history after chatting", async () => {
    // Chat twice to build history
    await post("/chat/chat-hist", { message: "hello" });
    await post("/chat/chat-hist", { message: "I ate 30g of carbs" });
    const { status, body } = await get("/state/chat-hist");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.chat_history), "chat_history should be an array");
    assert.equal(body.chat_history.length, 4); // 2 user + 2 assistant
    assert.equal(body.chat_history[0].role, "user");
    assert.equal(body.chat_history[1].role, "assistant");
    assert.ok(typeof body.chat_history[1].content === "string");
  });

  test("GET /state/:id chat_history is empty array for new patient", async () => {
    const { body } = await get("/state/brand-new");
    assert.deepEqual(body.chat_history, []);
  });

  test("POST /chat/:id response includes context snapshot", async () => {
    const { status, body } = await post("/chat/ctx-api", { message: "hello" });
    assert.equal(status, 200);
    assert.ok(typeof body.context === "string");
    assert.match(body.context, /\[CURRENT PATIENT CONTEXT — patient: ctx-api\]/);
  });
});
