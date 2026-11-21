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
});
