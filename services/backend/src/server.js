/**
 * GlucoLoop fusion service — zero-dependency Node (stdlib http only).
 * Start:  node src/server.js   (no npm install needed)
 */
import http from "node:http";
import { Store } from "./state.js";
import { runAgent } from "./agent/mistral.js";

const PORT = Number(process.env.PORT || 8100);
const ML_URL = process.env.ML_URL || "http://localhost:8101";

const store = new Store();
const conversations = new Map();

const json = (res, code, obj) => {
  const b = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json", "Content-Length": b.length });
  res.end(b);
};

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString() || "{}");
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { status: "up", mistral: !!process.env.MISTRAL_API_KEY,
                            ml_url: ML_URL });
  }

  if (req.method === "POST" && url.pathname === "/ingest") {
    const r = await body(req);
    if (!r || !r.patient_id) return json(res, 400, { error: "patient_id required" });
    store.ingest(r);
    return json(res, 200, { status: "ingested", t: r.t });
  }

  const m = url.pathname.match(/^\/state\/(.+)$/);
  if (req.method === "GET" && m) return json(res, 200, store.summary(m[1]));

  const f = url.pathname.match(/^\/forecast\/(.+)$/);
  if (req.method === "GET" && f) {
    try {
      const fc = await callMl(f[1]);
      return json(res, 200, fc);
    } catch (exc) {
      return json(res, 502, { error: `ml service unreachable: ${exc.message}` });
    }
  }

  const c = url.pathname.match(/^\/chat\/(.+)$/);
  if (req.method === "POST" && c) {
    const { message } = await body(req);
    if (!message) return json(res, 400, { error: "message required" });
    const patientId = c[1];
    const history = conversations.get(patientId) || [];
    try {
      const { reply, toolCalls } = await runAgent(
        { store, mlUrl: ML_URL, patientId }, history, String(message));
      history.push({ role: "user", content: String(message) },
                   { role: "assistant", content: reply });
      conversations.set(patientId, history.slice(-20));
      return json(res, 200, { reply, toolCalls });
    } catch (exc) {
      return json(res, 500, { error: `agent failed: ${exc.message}` });
    }
  }

  json(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
  console.log(`glucoloop backend :${PORT} | ml=${ML_URL} | ` +
              `agent=${process.env.MISTRAL_API_KEY ? "mistral" : "mock"}`);
});
