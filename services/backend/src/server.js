/**
 * GlucoLoop fusion service — zero-dependency Node (stdlib http only).
 * Start:  node src/server.js   (no npm install needed)
 */
import http from "node:http";
import { Store } from "./state.js";
import { runAgent } from "./agent/mistral.js";
import { DASHBOARD_HTML } from "./dashboard.js";

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
  // HTTP counts UTF-8 bytes; character counts truncate replies with symbols.
  res.writeHead(code, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(b) });
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
      done(200);
      return json(res, 200, store.summary(decodeURIComponent(m[1])));
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
        return json(res, 200, { reply, toolCalls });
      } catch (exc) {
        done(500);
        return json(res, 500, { error: `agent failed: ${exc.message}` });
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
}

// Export for testing
export { server, store };
