#!/usr/bin/env node
/**
 * End-to-end integration test: simulator → backend → ML → forecast/chat/state.
 *
 * Spawns the ML service and the backend on test ports, streams simulated
 * patient data (with fault injection) into POST /ingest via the Python
 * simulator, then verifies:
 *   - GET /health (backend + ML reachable)
 *   - GET /forecast/:patient returns all 3 horizons + action
 *   - POST /chat/:patient returns reply + toolCalls (mock agent)
 *   - GET /state/:patient shows active_faults during fault windows
 *   - GET /metrics tracks requests
 *
 * Usage: node scripts/e2e.mjs
 * Exit code 0 = all passed, 1 = failure.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ML_PORT = 18201;
const BE_PORT = 18200;
const BE = `http://localhost:${BE_PORT}`;
const ML = `http://localhost:${ML_PORT}`;

const procs = [];
function spawnProc(cmd, args, opts = {}) {
  const p = spawn(cmd, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], ...opts });
  procs.push(p);
  p.stdout.on("data", () => {});
  p.stderr.on("data", () => {});
  return p;
}

let passed = 0, failed = 0;
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} ${extra}`); }
}

async function waitFor(url, timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {}
    await sleep(300);
  }
  return false;
}

const get = async (p) => {
  const r = await fetch(BE + p);
  const text = await r.text();
  try { return { status: r.status, body: JSON.parse(text) }; }
  catch { return { status: r.status, body: { raw: text.slice(0, 300) } }; }
};
const post = async (p, body) => {
  const r = await fetch(BE + p, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  try { return { status: r.status, body: JSON.parse(text) }; }
  catch { return { status: r.status, body: { raw: text.slice(0, 300) } }; }
};

/** Use the Python simulator to generate readings and POST them to the backend. */
async function streamSimulator(patientId, steps, faults) {
  const faultExpr = faults.length
    ? "[" + faults.map(f => `Fault(${JSON.stringify(f.kind)}, ${f.start_min}, ${f.end_min}, ${f.intensity ?? 1.0})`).join(", ") + "]"
    : "[]";
  const script = `
import json, sys, urllib.request
sys.path.insert(0, ${JSON.stringify(path.join(ROOT, "services/simulator"))})
from physiology import random_scenario, Patient, Fault

sc = random_scenario(4242, days=1)
sc.faults = ${faultExpr}
p = Patient(sc)
for _ in range(${steps}):
    row = p.step()
    payload = {
        "patient_id": ${JSON.stringify(patientId)}, "type": "cgm", "t": row["t"],
        "cgm": {"glucose_mgdl": row["cgm_glucose"], "cgm_quality": row["cgm_quality"],
                "hr": row["hr"], "activity": row["activity"]},
        "pump": {"iob_units": row["iob"], "commanded_basal_u_hr": row["commanded_basal"],
                 "delivered_basal_u_hr": row["delivered_basal"], "pump_status": row["pump_status"]},
    }
    req = urllib.request.Request(${JSON.stringify(BE + "/ingest")}, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        urllib.request.urlopen(req, timeout=5)
    except Exception as e:
        print(f"ingest error at t={row['t']}: {e}", file=sys.stderr)
`;
  const p = spawnProc("python3", ["-c", script]);
  await new Promise((resolve) => p.on("exit", resolve));
}

async function main() {
  console.log("🧪 GlucoLoop E2E integration test\n");

  // 1. Start ML service
  console.log("Starting ML service on :" + ML_PORT + "…");
  spawnProc("python3", ["predict_api.py"], {
    cwd: path.join(ROOT, "services/ml"),
    env: { ...process.env, PORT: String(ML_PORT) },
  });
  check("ML /health reachable", await waitFor(`${ML}/health`));

  // 2. Start backend
  console.log("Starting backend on :" + BE_PORT + "…");
  spawnProc("node", ["src/server.js"], {
    cwd: path.join(ROOT, "services/backend"),
    env: { ...process.env, PORT: String(BE_PORT), ML_URL: ML, MISTRAL_API_KEY: "" },
  });
  check("backend /health reachable", await waitFor(`${BE}/health`));

  const health = await get("/health");
  check("backend reports mock agent mode", health.body.agent_mode === "mock", JSON.stringify(health.body));

  // 3. Stream normal data (no faults) — 15 readings
  console.log("Streaming 15 normal readings from simulator…");
  await streamSimulator("e2e-patient", 15, []);

  const state1 = await get("/state/e2e-patient");
  check("/state has 15 readings", state1.body.history?.length === 15, `got ${state1.body.history?.length}`);
  check("/state active_faults empty when healthy", (state1.body.active_faults || []).length === 0);

  // 4. Forecast through the full pipeline (backend → ML)
  console.log("Testing /forecast (backend → ML pipeline)…");
  const fc = await get("/forecast/e2e-patient");
  check("/forecast returns 200", fc.status === 200, `got ${fc.status}: ${JSON.stringify(fc.body).slice(0,100)}`);
  check("/forecast has short horizon", typeof fc.body.short?.point === "number");
  check("/forecast has medium horizons (5 entries)", Array.isArray(fc.body.medium) && fc.body.medium.length === 5);
  check("/forecast has long envelope (6 blocks)", Array.isArray(fc.body.long) && fc.body.long.length === 6);
  check("/forecast has action class", typeof fc.body.action?.class === "string");
  console.log(`     forecast: short=${fc.body.short?.point} action=${fc.body.action?.class}`);

  // 5. Chat (mock agent) — should call log_checkin + predict
  console.log("Testing /chat with meal message…");
  const chat = await post("/chat/e2e-patient", { message: "I ate 60g of carbs for lunch" });
  check("/chat returns 200", chat.status === 200);
  check("/chat reply is string", typeof chat.body.reply === "string" && chat.body.reply.length > 0,
        `got: ${JSON.stringify(chat.body).slice(0, 200)}`);
  check("/chat called log_checkin", (chat.body.toolCalls || []).includes("log_checkin"),
        `tools: ${JSON.stringify(chat.body.toolCalls)}`);
  check("/chat called predict", (chat.body.toolCalls || []).includes("predict"),
        `tools: ${JSON.stringify(chat.body.toolCalls)}`);

  // 6. Stream data WITH faults — verify active_faults appears
  console.log("Streaming 10 readings with CGM drift fault…");
  await streamSimulator("e2e-fault", 10, [{ kind: "cgm_drift", start_min: 0, end_min: 100, intensity: 1.2 }]);
  const stateFault = await get("/state/e2e-fault");
  check("/state shows cgm_drift in active_faults", (stateFault.body.active_faults || []).includes("cgm_drift"),
        `got ${JSON.stringify(stateFault.body.active_faults)}`);

  console.log("Streaming 10 readings with pump occlusion…");
  await streamSimulator("e2e-occl", 10, [{ kind: "pump_occlusion", start_min: 0, end_min: 100, intensity: 1.0 }]);
  const stateOccl = await get("/state/e2e-occl");
  check("/state shows occlusion in active_faults", (stateOccl.body.active_faults || []).includes("occlusion"),
        `got ${JSON.stringify(stateOccl.body.active_faults)}`);
  check("/state exposes latest_iob", typeof stateOccl.body.latest_iob === "number");

  // 7. Metrics endpoint
  const metrics = await get("/metrics");
  check("/metrics tracks requests", metrics.body.requests?.total > 0);
  check("/metrics lists 3 patients", metrics.body.store?.patient_count === 3, `got ${metrics.body.store?.patient_count}`);

  // 8. Dashboard + App pages serve HTML
  const dash = await fetch(`${BE}/dashboard`);
  check("/dashboard serves HTML", dash.status === 200 && (await dash.text()).includes("GlucoLoop"));
  const app = await fetch(`${BE}/app`);
  check("/app serves HTML (web backup)", app.status === 200 && (await app.text()).includes("GlucoLoop"));

  // Summary
  console.log(`\n${"=".repeat(40)}`);
  console.log(`E2E: ${passed} passed, ${failed} failed`);
  procs.forEach((p) => { try { p.kill(); } catch {} });
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("E2E crashed:", e);
  procs.forEach((p) => { try { p.kill(); } catch {} });
  process.exit(1);
});
