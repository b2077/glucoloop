/** Static HTML dashboard served at GET /dashboard. Zero-dep, inline CSS/JS. */

export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GlucoLoop Backend Dashboard</title>
<style>
  :root { --bg:#0f172a; --card:#1e293b; --border:#334155; --text:#e2e8f0; --muted:#94a3b8;
          --green:#22c55e; --yellow:#eab308; --red:#ef4444; --blue:#3b82f6; --purple:#a855f7; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:-apple-system,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--text); padding:24px; }
  h1 { font-size:1.4rem; margin-bottom:4px; }
  .sub { color:var(--muted); font-size:.85rem; margin-bottom:20px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:16px; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:10px; padding:16px; }
  .card h2 { font-size:.95rem; margin-bottom:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; }
  .card.wide { grid-column:1/-1; }
  .stat { display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--border); font-size:.9rem; }
  .stat:last-child { border-bottom:none; }
  .badge { display:inline-block; padding:2px 8px; border-radius:99px; font-size:.75rem; font-weight:600; }
  .b-green { background:rgba(34,197,94,.15); color:var(--green); }
  .b-yellow { background:rgba(234,179,8,.15); color:var(--yellow); }
  .b-red { background:rgba(239,68,68,.15); color:var(--red); }
  .b-blue { background:rgba(59,130,246,.15); color:var(--blue); }
  .b-purple { background:rgba(168,85,247,.15); color:var(--purple); }
  table { width:100%; border-collapse:collapse; font-size:.82rem; }
  th,td { text-align:left; padding:5px 6px; border-bottom:1px solid var(--border); white-space:nowrap; }
  th { color:var(--muted); font-weight:600; position:sticky; top:0; background:var(--card); }
  .table-wrap { max-height:280px; overflow-y:auto; }
  #chat-log { height:200px; overflow-y:auto; background:var(--bg); border:1px solid var(--border);
              border-radius:8px; padding:10px; margin-bottom:8px; font-size:.85rem; }
  .msg-user { color:var(--blue); margin:4px 0; }
  .msg-bot { color:var(--text); margin:4px 0; }
  .msg-tools { color:var(--yellow); font-size:.75rem; margin:2px 0 6px 12px; }
  input,button,select { font-size:.85rem; padding:7px 10px; border-radius:6px; border:1px solid var(--border); }
  input,select { background:var(--bg); color:var(--text); }
  input { flex:1; }
  button { background:var(--blue); color:#fff; border:none; cursor:pointer; }
  button:hover { opacity:.85; }
  .row { display:flex; gap:8px; align-items:center; }
  .refresh-note { color:var(--muted); font-size:.75rem; margin-top:16px; }
  .glucose-cell { font-weight:700; }
  .g-low { color:var(--red); }
  .g-high { color:var(--yellow); }
  .g-normal { color:var(--green); }
  #chart { width:100%; height:160px; }
  .legend { display:flex; gap:16px; font-size:.75rem; color:var(--muted); margin-top:4px; }
</style>
</head>
<body>
<h1>🩺 GlucoLoop Backend Dashboard</h1>
<p><a href="/demo" style="color:var(--blue)">Explore the simulated forecast personalisation demo</a></p>
<p class="sub">Live view of ingested data, REST API, agent, and patient state — auto-refreshes every 5s</p>

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

  <!-- Ingested data viewer -->
  <div class="card wide">
    <h2>📥 Ingested Data</h2>
    <div class="row" style="margin-bottom:10px">
      <label style="font-size:.85rem;color:var(--muted)">Patient:</label>
      <select id="patient-select" onchange="loadPatient()"><option value="">— select —</option></select>
      <span id="patient-meta" style="font-size:.8rem;color:var(--muted)"></span>
    </div>
    <div id="glucose-chart-wrap">
      <svg id="chart" preserveAspectRatio="none"></svg>
      <div class="legend"><span>● glucose mg/dL</span><span style="color:var(--red)">--- low (70)</span><span style="color:var(--yellow)">--- high (180)</span></div>
    </div>
    <div class="table-wrap" style="margin-top:10px">
      <table id="readings-table">
        <thead><tr><th>t (min)</th><th>Glucose</th><th>Quality</th><th>HR</th><th>Activity</th><th>IOB</th><th>Basal cmd</th><th>Pump</th></tr></thead>
        <tbody><tr><td colspan="8" style="color:var(--muted);text-align:center">Select a patient to view readings</td></tr></tbody>
      </table>
    </div>
  </div>

  <!-- Checkin + Alerts -->
  <div class="card">
    <h2>💬 Latest Check-in</h2>
    <div id="checkin">—</div>
  </div>

  <div class="card">
    <h2>🚨 Alerts</h2>
    <div id="alerts" style="max-height:200px;overflow-y:auto">—</div>
  </div>

  <!-- Chat tester -->
  <div class="card wide">
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
const glucoseClass = g => g === null ? '' : g < 70 ? 'g-low' : g > 180 ? 'g-high' : 'g-normal';

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
      ...Object.entries(r.byStatus).map(([s,c]) => ['  HTTP '+s, c]),
    ].map(([k,v]) => '<div class="stat"><span>'+k+'</span><span>'+v+'</span></div>').join('');

    // Patients table + dropdown
    const sel = $('patient-select');
    const prevSel = sel.value;
    if (m.store.patient_count === 0) {
      $('patients').innerHTML = '<p style="color:var(--muted);font-size:.85rem">No patients yet — POST to /ingest</p>';
    } else {
      $('patients').innerHTML = '<table><tr><th>Patient</th><th>Readings</th><th>Alerts</th><th>Forecast</th></tr>' +
        m.store.patients.map(p => '<tr><td>'+p.patient_id+'</td><td>'+p.readings_count+'</td><td>'+p.alerts_count+'</td><td>'+(p.has_forecast?badge('yes','b-green'):badge('no','b-yellow'))+'</td></tr>').join('') + '</table>';
      sel.innerHTML = '<option value="">— select —</option>' +
        m.store.patients.map(p => '<option value="'+p.patient_id+'">'+p.patient_id+' ('+p.readings_count+' readings)</option>').join('');
      if (prevSel && m.store.patients.find(p => p.patient_id === prevSel)) sel.value = prevSel;
    }

    $('recent').innerHTML = r.lastRequests.length === 0
      ? '<p style="color:var(--muted);font-size:.85rem">No requests yet</p>'
      : '<table><tr><th>Method</th><th>Path</th><th>Status</th><th>ms</th></tr>' +
        r.lastRequests.slice(0,10).map(q => '<tr><td>'+q.method+'</td><td>'+q.path+'</td><td>'+q.status+'</td><td>'+q.ms+'</td></tr>').join('') + '</table>';

    // Reload patient data if one is selected
    if (sel.value) await loadPatient();

    $('last-update').textContent = 'Last updated: ' + new Date().toLocaleTimeString();
  } catch(e) {
    $('health').innerHTML = '<p style="color:var(--red)">Backend unreachable</p>';
  }
}

async function loadPatient() {
  const pid = $('patient-select').value;
  if (!pid) return;
  try {
    const s = await fetch('/state/' + encodeURIComponent(pid)).then(r => r.json());
    // Meta
    $('patient-meta').textContent = s.history.length + ' readings in history · latest t=' + (s.latest ? s.latest.t : 'n/a');
    if (s.active_faults && s.active_faults.length > 0) {
      $('patient-meta').innerHTML += ' &nbsp;' + s.active_faults.map(f => badge('⚠ '+f, 'b-red')).join(' ');
    }
    // Readings table
    const tbody = $('readings-table').querySelector('tbody');
    if (!s.history || s.history.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="color:var(--muted);text-align:center">No readings ingested yet</td></tr>';
    } else {
      tbody.innerHTML = s.history.slice().reverse().map(r => {
        const c = r.cgm || {};
        const p = r.pump || {};
        const g = c.glucose_mgdl;
        return '<tr>' +
          '<td>'+r.t+'</td>' +
          '<td class="glucose-cell '+glucoseClass(g)+'">'+(g === null ? '—' : g)+'</td>' +
          '<td>'+badge(c.cgm_quality || '—', c.cgm_quality==='ok'?'b-green':c.cgm_quality==='drift'?'b-yellow':'b-red')+'</td>' +
          '<td>'+(c.hr ?? '—')+'</td>' +
          '<td>'+(c.activity || '—')+'</td>' +
          '<td>'+(p.iob_units ?? '—')+'</td>' +
          '<td>'+(p.commanded_basal_u_hr ?? '—')+'</td>' +
          '<td>'+badge(p.pump_status || '—', p.pump_status==='ok'?'b-green':'b-red')+'</td>' +
        '</tr>';
      }).join('');
    }
    // Glucose chart (inline SVG)
    drawChart(s.history.map(r => r.cgm ? r.cgm.glucose_mgdl : null).filter(g => g !== null), s.history.filter(r => r.cgm && r.cgm.glucose_mgdl !== null).map(r => r.t));
    // Checkin
    if (s.checkin) {
      $('checkin').innerHTML = '<div class="stat"><span>Carbs (3h)</span><span>'+(s.checkin.carbs_g ?? '—')+' g</span></div>' +
        '<div class="stat"><span>Sleep</span><span>'+(s.checkin.sleep_hours ?? '—')+' h</span></div>' +
        '<div class="stat"><span>Exercise</span><span>'+(s.checkin.exercise_min ?? '—')+' min</span></div>' +
        '<div class="stat"><span>Stress</span><span>'+(s.checkin.stress_1_5 ?? '—')+'/5</span></div>' +
        '<div class="stat"><span>Logged</span><span style="font-size:.75rem">'+s.checkin.logged_at+'</span></div>';
    } else {
      $('checkin').innerHTML = '<p style="color:var(--muted);font-size:.85rem">No check-ins yet</p>';
    }
    // Alerts
    if (s.alerts && s.alerts.length > 0) {
      $('alerts').innerHTML = s.alerts.slice().reverse().map(a =>
        '<div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:.82rem">' +
        badge(a.level, a.level==='critical'?'b-red':a.level==='warning'?'b-yellow':'b-blue') + ' ' +
        a.message + '<br><span style="color:var(--muted);font-size:.72rem">'+a.created_at+'</span></div>'
      ).join('');
    } else {
      $('alerts').innerHTML = '<p style="color:var(--muted);font-size:.85rem">No alerts</p>';
    }
  } catch(e) {
    console.error(e);
  }
}

function drawChart(glucoseVals, times) {
  const svg = $('chart');
  const W = svg.clientWidth || 600, H = 160;
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  if (!glucoseVals || glucoseVals.length === 0) { svg.innerHTML = '<text x="50%" y="50%" fill="#94a3b8" text-anchor="middle" font-size="12">No glucose data</text>'; return; }
  const min = Math.min(...glucoseVals, 50), max = Math.max(...glucoseVals, 200);
  const pad = 10;
  const x = i => pad + (i / Math.max(glucoseVals.length - 1, 1)) * (W - pad * 2);
  const y = v => H - pad - ((v - min) / (max - min)) * (H - pad * 2);
  const pts = glucoseVals.map((v, i) => x(i) + ',' + y(v)).join(' ');
  const yLow = y(70), yHigh = y(180);
  svg.innerHTML =
    '<line x1="0" y1="'+yLow+'" x2="'+W+'" y2="'+yLow+'" stroke="#ef4444" stroke-dasharray="4" stroke-width="1" opacity="0.5"/>' +
    '<line x1="0" y1="'+yHigh+'" x2="'+W+'" y2="'+yHigh+'" stroke="#eab308" stroke-dasharray="4" stroke-width="1" opacity="0.5"/>' +
    '<polyline points="'+pts+'" fill="none" stroke="#3b82f6" stroke-width="2"/>' +
    glucoseVals.map((v, i) => '<circle cx="'+x(i)+'" cy="'+y(v)+'" r="3" fill="#3b82f6"><title>t='+times[i]+'min: '+v+' mg/dL</title></circle>').join('');
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
