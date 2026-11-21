/** Static HTML dashboard served at GET /dashboard. Zero-dep, inline CSS/JS. */

export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GlucoLoop Backend Dashboard</title>
<style>
  :root { --bg:#0f172a; --card:#1e293b; --border:#334155; --text:#e2e8f0; --muted:#94a3b8;
          --green:#22c55e; --yellow:#eab308; --red:#ef4444; --blue:#3b82f6; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:-apple-system,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--text); padding:24px; }
  h1 { font-size:1.4rem; margin-bottom:4px; }
  .sub { color:var(--muted); font-size:.85rem; margin-bottom:20px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:16px; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:10px; padding:16px; }
  .card h2 { font-size:.95rem; margin-bottom:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; }
  .stat { display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--border); font-size:.9rem; }
  .stat:last-child { border-bottom:none; }
  .badge { display:inline-block; padding:2px 8px; border-radius:99px; font-size:.75rem; font-weight:600; }
  .b-green { background:rgba(34,197,94,.15); color:var(--green); }
  .b-yellow { background:rgba(234,179,8,.15); color:var(--yellow); }
  .b-red { background:rgba(239,68,68,.15); color:var(--red); }
  .b-blue { background:rgba(59,130,246,.15); color:var(--blue); }
  table { width:100%; border-collapse:collapse; font-size:.82rem; }
  th,td { text-align:left; padding:5px 6px; border-bottom:1px solid var(--border); }
  th { color:var(--muted); font-weight:600; }
  #chat-log { height:200px; overflow-y:auto; background:var(--bg); border:1px solid var(--border);
              border-radius:8px; padding:10px; margin-bottom:8px; font-size:.85rem; }
  .msg-user { color:var(--blue); margin:4px 0; }
  .msg-bot { color:var(--text); margin:4px 0; }
  .msg-tools { color:var(--yellow); font-size:.75rem; margin:2px 0 6px 12px; }
  input,button { font-size:.85rem; padding:7px 10px; border-radius:6px; border:1px solid var(--border); }
  input { background:var(--bg); color:var(--text); flex:1; }
  button { background:var(--blue); color:#fff; border:none; cursor:pointer; }
  button:hover { opacity:.85; }
  .row { display:flex; gap:8px; }
  .refresh-note { color:var(--muted); font-size:.75rem; margin-top:16px; }
</style>
</head>
<body>
<h1>🩺 GlucoLoop Backend Dashboard</h1>
<p class="sub">Live view of the REST API, agent, and patient state — auto-refreshes every 5s</p>

<div class="grid">
  <div class="card">
    <h2>Health</h2>
    <div id="health">loading…</div>
  </div>

  <div class="card">
    <h2>Request Metrics</h2>
    <div id="metrics">loading…</div>
  </div>

  <div class="card">
    <h2>Patients</h2>
    <div id="patients">loading…</div>
  </div>

  <div class="card">
    <h2>Recent Requests</h2>
    <div id="recent">loading…</div>
  </div>

  <div class="card" style="grid-column:1/-1">
    <h2>Chat Tester (mock agent)</h2>
    <div class="row" style="margin-bottom:8px">
      <input id="pid" value="demo-001" placeholder="patient_id">
    </div>
    <div id="chat-log"></div>
    <div class="row">
      <input id="chat-input" placeholder="e.g. I ate 60g of carbs" onkeydown="if(event.key==='Enter')sendChat()">
      <button onclick="sendChat()">Send</button>
    </div>
  </div>
</div>

<p class="refresh-note">Auto-refresh: 5s · <span id="last-update"></span></p>

<script>
const $ = id => document.getElementById(id);
const badge = (txt, cls) => '<span class="badge ' + cls + '">' + txt + '</span>';

async function refresh() {
  try {
    const [h, m] = await Promise.all([
      fetch('/health').then(r => r.json()),
      fetch('/metrics').then(r => r.json()),
    ]);
    $('health').innerHTML = [
      ['Status', badge(h.status, h.status==='up'?'b-green':'b-red')],
      ['Agent mode', badge(h.agent_mode, h.agent_mode==='mistral'?'b-blue':'b-yellow')],
      ['Uptime', h.uptime_s + 's'],
      ['ML URL', h.ml_url],
    ].map(([k,v]) => '<div class="stat"><span>'+k+'</span><span>'+v+'</span></div>').join('');

    const r = m.requests;
    $('metrics').innerHTML = [
      ['Total requests', r.total],
      ...Object.entries(r.byStatus).map(([s,c]) => ['  '+s, c]),
    ].map(([k,v]) => '<div class="stat"><span>'+k+'</span><span>'+v+'</span></div>').join('');

    $('patients').innerHTML = m.store.patient_count === 0
      ? '<p style="color:var(--muted);font-size:.85rem">No patients yet — POST to /ingest</p>'
      : '<table><tr><th>Patient</th><th>Readings</th><th>Alerts</th><th>Forecast</th></tr>' +
        m.store.patients.map(p => '<tr><td>'+p.patient_id+'</td><td>'+p.readings_count+'</td><td>'+p.alerts_count+'</td><td>'+(p.has_forecast?badge('yes','b-green'):badge('no','b-yellow'))+'</td></tr>').join('') + '</table>';

    $('recent').innerHTML = r.lastRequests.length === 0
      ? '<p style="color:var(--muted);font-size:.85rem">No requests yet</p>'
      : '<table><tr><th>Method</th><th>Path</th><th>Status</th><th>ms</th></tr>' +
        r.lastRequests.slice(0,10).map(q => '<tr><td>'+q.method+'</td><td>'+q.path+'</td><td>'+q.status+'</td><td>'+q.ms+'</td></tr>').join('') + '</table>';

    $('last-update').textContent = 'Last updated: ' + new Date().toLocaleTimeString();
  } catch(e) {
    $('health').innerHTML = '<p style="color:var(--red)">Backend unreachable</p>';
  }
}

async function sendChat() {
  const pid = $('pid').value.trim() || 'demo-001';
  const msg = $('chat-input').value.trim();
  if (!msg) return;
  $('chat-input').value = '';
  $('chat-log').innerHTML += '<div class="msg-user">🧑 '+msg+'</div>';
  try {
    const r = await fetch('/chat/'+encodeURIComponent(pid), {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({message: msg}),
    });
    const d = await r.json();
    if (d.error) {
      $('chat-log').innerHTML += '<div class="msg-bot">❌ '+d.error+'</div>';
    } else {
      $('chat-log').innerHTML += '<div class="msg-bot">🤖 '+d.reply+'</div>';
      if (d.toolCalls && d.toolCalls.length)
        $('chat-log').innerHTML += '<div class="msg-tools">tools: '+d.toolCalls.join(', ')+'</div>';
    }
  } catch(e) {
    $('chat-log').innerHTML += '<div class="msg-bot">❌ '+e.message+'</div>';
  }
  $('chat-log').scrollTop = $('chat-log').scrollHeight;
}

refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>`;
