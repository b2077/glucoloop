/** Static HTML dashboard served at GET /dashboard. Zero-dep, inline CSS/JS. */

export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GlucoLoop Backend Dashboard</title>
<style>
  :root { --bg:#F2F4F7; --card:#FFFFFF; --border:#E5E7EB; --text:#111927; --muted:#6C737F;
          --green:#3F9A6A; --yellow:#C4923A; --red:#D4726A; --ink:#111927; --surface:#F3F4F6; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; background:var(--bg); color:var(--text); padding:28px; }
  h1 { font-size:1.5rem; margin-bottom:4px; letter-spacing:-0.03em; font-weight:700; }
  .sub { color:var(--muted); font-size:.9rem; margin-bottom:22px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:16px; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:16px; padding:18px;
          box-shadow:0 4px 14px rgba(7,21,37,.04); }
  .card h2 { font-size:.95rem; margin-bottom:12px; color:var(--text); font-weight:600; letter-spacing:-0.01em; }
  .card.wide { grid-column:1/-1; }
  .stat { display:flex; justify-content:space-between; padding:7px 0; border-bottom:1px solid var(--border); font-size:.9rem; }
  .stat:last-child { border-bottom:none; }
  .badge { display:inline-block; padding:2px 8px; border-radius:99px; font-size:.75rem; font-weight:600; }
  .b-green { background:#F0F6F3; color:var(--green); }
  .b-yellow { background:#F8F4EC; color:var(--yellow); }
  .b-red { background:#F8F1F0; color:var(--red); }
  .b-blue { background:var(--surface); color:var(--ink); }
  .b-purple { background:var(--surface); color:var(--muted); }
  table { width:100%; border-collapse:collapse; font-size:.82rem; }
  th,td { text-align:left; padding:6px 6px; border-bottom:1px solid var(--border); white-space:nowrap; }
  th { color:var(--muted); font-weight:600; position:sticky; top:0; background:var(--card); }
  .table-wrap { max-height:280px; overflow-y:auto; }
  #chat-log { height:200px; overflow-y:auto; background:var(--surface); border:1px solid var(--border);
              border-radius:12px; padding:12px; margin-bottom:8px; font-size:.85rem; }
  .msg-user { color:var(--text); font-weight:600; margin:4px 0; }
  .msg-bot { color:var(--text); margin:4px 0; }
  .msg-tools { color:var(--muted); font-size:.75rem; margin:2px 0 6px 12px; }
  input,button,select { font-size:.85rem; padding:8px 12px; border-radius:10px; border:1px solid var(--border); }
  input,select { background:#fff; color:var(--text); }
  input { flex:1; }
  button { background:var(--ink); color:#fff; border:none; cursor:pointer; border-radius:999px; font-weight:600; padding:8px 16px; }
  button:hover { background:#071525; }
  .row { display:flex; gap:8px; align-items:center; }
  .refresh-note { color:var(--muted); font-size:.75rem; margin-top:16px; }
  .glucose-cell { font-weight:700; }
  .g-low { color:#E65C5C; }
  .g-high { color:#A15CE6; }
  .g-normal { color:#5CE65C; }
  #chart { width:100%; height:220px; background:#fff; border-radius:8px; display:block; }
  .legend { display:flex; flex-wrap:wrap; gap:14px; font-size:.75rem; color:var(--muted); margin-top:6px; align-items:center; }
  .legend i { display:inline-block; width:8px; height:8px; border-radius:99px; margin-right:4px; vertical-align:middle; }
</style>
</head>
<body>
<h1>🩺 GlucoLoop Backend Dashboard</h1>
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
      <svg id="chart"></svg>
      <div class="legend">
        <span><i style="background:#5CE65C"></i>glucose</span>
        <span><i style="background:rgba(0,122,255,.55);border-radius:2px"></i>forecast</span>
        <span style="color:#E65C5C">- - 3.9 low</span>
        <span style="color:#A15CE6">- - 10 high</span>
        <span style="color:#34C759">— target</span>
      </div>
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
const glucoseClass = g => g === null ? '' : g <= 70 ? 'g-low' : g >= 180 ? 'g-high' : 'g-normal';

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
    // Glucose chart — same marks as Trio's main pane (dots, thresholds, cone).
    const rd = await fetch('/readings/' + encodeURIComponent(pid)).then(r => r.json());
    const series = (rd.readings && rd.readings.length)
      ? rd.readings
      : (s.history || []).map(r => ({ glucose_mgdl: r.cgm ? r.cgm.glucose_mgdl : null }));
    drawChart(series, s.forecast, s.profile && s.profile.target_mgdl);
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

function trioTone(v) {
  if (v <= 70) return '#E65C5C';
  if (v >= 180) return '#A15CE6';
  return '#5CE65C';
}

function trioDomain(glucose, extras) {
  const g = glucose.filter(v => v != null && isFinite(v));
  if (!g.length) return { min: 39, max: 200 };
  const minG = Math.min.apply(null, g), maxG = Math.max.apply(null, g);
  const ex = (extras || []).filter(v => v != null && isFinite(v));
  const maxExtra = ex.length ? Math.max.apply(null, ex) : maxG;
  const minExtra = ex.length ? Math.min.apply(null, ex) : minG;
  const maxOverall = Math.max(maxG, Math.min(maxExtra, maxG + 50));
  const minOverall = Math.min(minG, minExtra);
  let maxY = 200;
  if (maxOverall > 200 && maxOverall <= 225) maxY = 250;
  else if (maxOverall > 225 && maxOverall <= 275) maxY = 300;
  else if (maxOverall > 275 && maxOverall <= 325) maxY = 350;
  else if (maxOverall > 325) maxY = 400;
  return { min: Math.min(minOverall, 50), max: Math.max(maxY, Math.min(minOverall, 50) + 10) };
}

function drawChart(series, forecast, targetMgdl) {
  const svg = $('chart');
  const W = svg.clientWidth || 600, H = 220;
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  const vals = (series || []).map(r => r.glucose_mgdl);
  const known = vals.filter(v => v != null && isFinite(v));
  if (!known.length) {
    svg.innerHTML = '<text x="50%" y="50%" fill="#6C737F" text-anchor="middle" font-size="12">No glucose data</text>';
    return;
  }
  const step = 5;
  const histSpan = Math.max(step, (vals.length - 1) * step);
  const fut = ((forecast && forecast.medium) || [])
    .filter(p => p && p.minutes > 0 && p.point != null)
    .slice().sort((a, b) => a.minutes - b.minutes);
  const futureSpan = fut.length ? fut[fut.length - 1].minutes : 0;
  const total = histSpan + futureSpan;
  const last = known[known.length - 1];
  const block = forecast && forecast.long && forecast.long[0];
  const horizon = futureSpan || (block ? block.window_end_h * 60 : 0);
  const coneAt = (minute, point) => {
    if (!block || !horizon) return { lo: point - 1, hi: point + 1 };
    const t = Math.min(1, Math.max(0, minute / horizon));
    const lo = point + (block.min_q10 - point) * t;
    const hi = point + (block.max_q90 - point) * t;
    return { lo: Math.min(lo, hi), hi: Math.max(lo, hi) };
  };
  const samples = fut.length ? [{ minutes: 0, point: last }].concat(fut) : [];
  const extras = [];
  samples.forEach(s => { const b = coneAt(s.minutes, s.point); extras.push(b.lo, b.hi); });
  const dom = trioDomain(known, extras);
  const padL = 8, padR = 40, padT = 12, padB = 22;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const y = v => padT + (1 - (v - dom.min) / (dom.max - dom.min)) * plotH;
  const xAt = m => padL + (m / total) * plotW;
  const mmol = v => (v / 18).toFixed(1);
  const parts = [];
  const yStep = (dom.max - dom.min) > 250 ? 100 : (dom.max - dom.min) > 140 ? 50 : 40;
  for (let v = Math.ceil(dom.min / yStep) * yStep; v <= dom.max - 4; v += yStep) {
    parts.push('<line x1="'+padL+'" y1="'+y(v)+'" x2="'+(padL+plotW)+'" y2="'+y(v)+'" stroke="#C7C7CC" stroke-width="0.5" stroke-dasharray="2 3"/>');
    parts.push('<text x="'+(W-2)+'" y="'+(y(v)+4)+'" text-anchor="end" font-size="11" fill="#111927">'+mmol(v)+'</text>');
  }
  const stride = total <= 360 ? 60 : total <= 720 ? 120 : 240;
  const relMarks = [];
  for (let rel = -Math.floor(histSpan / stride) * stride; rel <= futureSpan + 0.1; rel += stride) relMarks.push(rel);
  if (futureSpan > 0 && !relMarks.some(m => Math.abs(xAt(histSpan + m) - xAt(histSpan + futureSpan)) < 36)) relMarks.push(futureSpan);
  relMarks.forEach(rel => {
    const x = xAt(histSpan + rel);
    if (rel !== 0) parts.push('<line x1="'+x+'" y1="'+padT+'" x2="'+x+'" y2="'+(padT+plotH)+'" stroke="#C7C7CC" stroke-width="0.5" stroke-dasharray="2 3"/>');
    const label = rel === 0 ? 'now' : (Math.abs(rel) % 60 === 0 ? ((rel > 0 ? '+' : '') + (rel / 60) + 'h') : ((rel > 0 ? '+' : '') + Math.round(rel) + 'm'));
    parts.push('<text x="'+x+'" y="'+(H-4)+'" text-anchor="middle" font-size="11" fill="#111927">'+label+'</text>');
  });
  const target = targetMgdl || 100;
  if (target > dom.min && target < dom.max)
    parts.push('<line x1="'+padL+'" y1="'+y(target)+'" x2="'+(padL+plotW)+'" y2="'+y(target)+'" stroke="#34C759" stroke-width="1"/>');
  if (180 > dom.min && 180 < dom.max)
    parts.push('<line x1="'+padL+'" y1="'+y(180)+'" x2="'+(padL+plotW)+'" y2="'+y(180)+'" stroke="#A15CE6" stroke-width="1" stroke-dasharray="5 5"/>');
  if (70 > dom.min && 70 < dom.max)
    parts.push('<line x1="'+padL+'" y1="'+y(70)+'" x2="'+(padL+plotW)+'" y2="'+y(70)+'" stroke="#E65C5C" stroke-width="1" stroke-dasharray="5 5"/>');
  if (samples.length > 1) {
    const upper = [], lower = [];
    samples.forEach(s => {
      const b = coneAt(s.minutes, s.point);
      const x = xAt(histSpan + s.minutes);
      upper.push(x + ',' + y(b.hi));
      lower.unshift(x + ',' + y(b.lo));
    });
    parts.push('<polygon points="'+upper.concat(lower).join(' ')+'" fill="rgba(0,122,255,0.5)"/>');
  }
  const nowX = xAt(histSpan);
  parts.push('<line x1="'+nowX+'" y1="'+padT+'" x2="'+nowX+'" y2="'+(padT+plotH)+'" stroke="#AEAEB2" stroke-width="2" stroke-dasharray="3 3"/>');
  vals.forEach((v, i) => {
    if (v == null || !isFinite(v)) return;
    parts.push('<circle cx="'+xAt(i * step)+'" cy="'+y(v)+'" r="2.5" fill="'+trioTone(v)+'"><title>'+v+' mg/dL</title></circle>');
  });
  svg.innerHTML = parts.join('');
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
