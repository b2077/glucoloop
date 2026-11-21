/**
 * GlucoLoop fusion service — zero-dependency Node (stdlib http only).
 * Start:  node src/server.js   (no npm install needed)
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

// Load .env if present (zero-dep; never overrides real env vars; .env is gitignored).
// Skipped under `node --test` so tests can force mock mode via env.
const entry = process.argv[1] || "";
const isTest = process.env.NODE_ENV === "test" || entry.endsWith(".test.js") ||
               entry.includes(`${path.sep}test${path.sep}`);
try {
  if (isTest) throw new Error("test mode");
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch { /* .env is optional */ }
import { Store } from "./state.js";
import { runAgent } from "./agent/mistral.js";
import { DASHBOARD_HTML } from "./dashboard.js";
import { runRecommendationPass } from "./recommend.js";
import { buildAgentContext } from "./agent/context.js";

const PORT = Number(process.env.PORT || 8100);
const ML_URL = process.env.ML_URL || "http://localhost:8101";

const store = new Store();
const conversations = new Map();

// ---- request metrics ----------------------------------------------------------
const startedAt = Date.now();
const requestLog = { total: 0, byStatus: {}, byPath: {}, lastRequests: [] };

function recordRequest(method, path, status, ms) {
  requestLog.total++;
  requestLog.byStatus[status] = (requestLog.byStatus[status] || 0) + 1;
  const key = `${method} ${path}`;
  requestLog.byPath[key] = (requestLog.byPath[key] || 0) + 1;
  requestLog.lastRequests.unshift({ method, path, status, ms: Math.round(ms), at: new Date().toISOString() });
  if (requestLog.lastRequests.length > 50) requestLog.lastRequests.pop();
}

// ---- helpers ------------------------------------------------------------------
const json = (res, code, obj) => {
  const b = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(b, "utf8") });
  res.end(b);
};

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const err = new Error("invalid JSON body");
    err.badJson = true;
    throw err;
  }
}

async function callMl(patientId) {
  const r = await fetch(`${ML_URL}/predict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patient_id: patientId, readings: store.mlWindow(patientId) }),
  });
  if (!r.ok) throw new Error(`ml service ${r.status}`);
  const f = await r.json();
  store.get(patientId).lastForecast = f;
  return f;
}

// ---- server -------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const t0 = performance.now();
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const path = url.pathname;

  // Wrap handler so we always record metrics, even on thrown errors
  const done = (status) => {
    const ms = performance.now() - t0;
    recordRequest(req.method, path, status, ms);
  };

  try {
    // -- health --
    if (req.method === "GET" && path === "/health") {
      done(200);
      return json(res, 200, {
        status: "up",
        uptime_s: Math.round((Date.now() - startedAt) / 1000),
        mistral: !!process.env.MISTRAL_API_KEY,
        agent_mode: process.env.MISTRAL_API_KEY ? "mistral" : "mock",
        ml_url: ML_URL,
      });
    }

    // -- dashboard (static HTML) --
    if (req.method === "GET" && path === "/dashboard") {
      done(200);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(DASHBOARD_HTML);
    }

    // -- metrics --
    if (req.method === "GET" && path === "/metrics") {
      done(200);
      return json(res, 200, {
        uptime_s: Math.round((Date.now() - startedAt) / 1000),
        requests: requestLog,
        store: store.metrics(),
      });
    }

    // -- ingest --
    if (req.method === "POST" && path === "/ingest") {
      let r;
      try {
        r = await body(req);
      } catch (e) {
        done(400);
        return json(res, 400, { error: e.message });
      }
      if (!r || !r.patient_id) {
        done(400);
        return json(res, 400, { error: "patient_id required" });
      }
      try {
        store.ingest(r);
      } catch (e) {
        done(422);
        return json(res, 422, { error: e.message, validationErrors: e.validationErrors || [] });
      }
      done(200);
      return json(res, 200, { status: "ingested", t: r.t });
    }

    // -- state --
    const m = path.match(/^\/state\/(.+)$/);
    if (req.method === "GET" && m) {
      const pid = decodeURIComponent(m[1]);
      const summary = store.summary(pid);
      // Include chat history so the FE can render the conversation on load/reload
      summary.chat_history = (conversations.get(pid) || []).slice(-20);
      done(200);
      return json(res, 200, summary);
    }

    // -- forecast --
    const f = path.match(/^\/forecast\/(.+)$/);
    if (req.method === "GET" && f) {
      const patientId = decodeURIComponent(f[1]);
      try {
        const fc = await callMl(patientId);
        done(200);
        return json(res, 200, fc);
      } catch (exc) {
        done(502);
        return json(res, 502, { error: `ml service unreachable: ${exc.message}` });
      }
    }

    // -- chat --
    const c = path.match(/^\/chat\/(.+)$/);
    if (req.method === "POST" && c) {
      let parsed;
      try {
        parsed = await body(req);
      } catch (e) {
        done(400);
        return json(res, 400, { error: e.message });
      }
      const { message } = parsed;
      if (!message || typeof message !== "string") {
        done(400);
        return json(res, 400, { error: "message (string) required" });
      }
      const patientId = decodeURIComponent(c[1]);
      const history = conversations.get(patientId) || [];
      try {
        const { reply, toolCalls } = await runAgent(
          { store, mlUrl: ML_URL, patientId }, history, message);
        history.push({ role: "user", content: message },
                     { role: "assistant", content: reply });
        conversations.set(patientId, history.slice(-20));
        done(200);
        // Include the context snapshot sent to the LLM (for FE debugging/transparency)
        return json(res, 200, { reply, toolCalls,
          context: buildAgentContext(store, patientId) });
      } catch (exc) {
        done(500);
        return json(res, 500, { error: `agent failed: ${exc.message}` });
      }
    }

    // -- readings: full 24h glucose history (FE issue #5.1) --
    const rd = path.match(/^\/readings\/(.+)$/);
    if (req.method === "GET" && rd) {
      const pid = decodeURIComponent(rd[1]);
      const readings = store.allReadings(pid).map((r) => ({
        t: r.t,
        glucose_mgdl: r.cgm?.glucose_mgdl ?? null,
        glucose_mmol: r.cgm?.glucose_mgdl != null ? Math.round((r.cgm.glucose_mgdl / 18) * 10) / 10 : null,
        cgm_quality: r.cgm?.cgm_quality ?? null,
        hr: r.cgm?.hr ?? null,
        activity: r.cgm?.activity ?? null,
        iob: r.pump?.iob_units ?? null,
        pump_status: r.pump?.pump_status ?? null,
      }));
      done(200);
      return json(res, 200, { patient_id: pid, count: readings.length, readings });
    }

    // -- TIR: time in range 4–10 mmol/L (FE issue #5.2) --
    const tir = path.match(/^\/tir\/(.+)$/);
    if (req.method === "GET" && tir) {
      const pid = decodeURIComponent(tir[1]);
      const range = url.searchParams.get("range") || "all";
      const rangeMin = range === "1h" ? 60 : range === "24h" ? 1440 : null;
      const result = store.tir(pid, rangeMin);
      result.range_label = range;
      result.patient_id = pid;
      done(200);
      return json(res, 200, result);
    }

    // -- profile: PUT/GET patient profile (FE issue #5.3) --
    const prof = path.match(/^\/profile\/(.+)$/);
    if (prof && req.method === "GET") {
      const pid = decodeURIComponent(prof[1]);
      done(200);
      return json(res, 200, { patient_id: pid, profile: store.getProfile(pid) });
    }
    if (prof && req.method === "PUT") {
      const pid = decodeURIComponent(prof[1]);
      let p;
      try { p = await body(req); } catch (e) { done(400); return json(res, 400, { error: e.message }); }
      const saved = store.setProfile(pid, p);
      done(200);
      return json(res, 200, { patient_id: pid, profile: saved });
    }

    // -- recommendations: spontaneous BE recommendations (FE issue #5.3) --
    const rec = path.match(/^\/recommendations\/(.+)$/);
    if (req.method === "GET" && rec) {
      const pid = decodeURIComponent(rec[1]);
      done(200);
      return json(res, 200, { patient_id: pid, recommendations: store.recommendations(pid) });
    }
    // Trigger a recommendation pass on demand
    if (req.method === "POST" && path === "/recommendations/run") {
      try {
        const n = await runRecommendationPass(store, ML_URL);
        done(200);
        return json(res, 200, { status: "ok", new_recommendations: n });
      } catch (e) {
        done(500);
        return json(res, 500, { error: e.message });
      }
    }

    done(404);
    json(res, 404, { error: "not found", path });
  } catch (exc) {
    done(500);
    json(res, 500, { error: `internal: ${exc.message}` });
  }
});

// Only auto-listen when run directly (not imported by tests)
if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(PORT, () => {
    console.log(`glucoloop backend :${PORT} | ml=${ML_URL} | ` +
                `agent=${process.env.MISTRAL_API_KEY ? "mistral" : "mock"} | ` +
                `dashboard=http://localhost:${PORT}/dashboard`);
  });

  // Background proactive recommendation engine (FE issue #5.3)
  // Runs every RECO_INTERVAL_S (default 60s) — evaluates all patients
  // with enough data and pushes spontaneous recommendations.
  const RECO_INTERVAL_S = Number(process.env.RECO_INTERVAL_S || 60);
  if (RECO_INTERVAL_S > 0) {
    const timer = setInterval(async () => {
      try {
        const n = await runRecommendationPass(store, ML_URL);
        if (n > 0) console.log(`[reco] pushed ${n} new recommendation(s)`);
      } catch (e) {
        console.error(`[reco] pass failed: ${e.message}`);
      }
    }, RECO_INTERVAL_S * 1000);
    timer.unref(); // don't keep process alive just for this
  }
}

// Export for testing
export { server, store };
