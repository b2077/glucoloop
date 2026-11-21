/** Web backup app served at GET /app — replicates the mobile app's 3 tabs
 *  (Dashboard / Ella chat / Insights) as a single-page web app.
 *  Use this if the Expo mobile app can't run at demo time.
 *  Zero-dep, inline CSS/JS. Polls the same REST API as the mobile app.
 */

export const APP_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>GlucoLoop — Web App</title>
<style>
  :root { --bg:#F5F6FA; --card:#fff; --text:#0D2B45; --muted:#777; --blue:#1565C0;
          --red:#C62828; --orange:#EF6C00; --green:#2E7D32; --purple:#6A1B9A; --yellow:#F9A825;
          --border:#E4E6EF; }
  * { box-sizing:border-box; margin:0; padding:0; -webkit-tap-highlight-color:transparent; }
  body { font-family:-apple-system,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--text);
         max-width:480px; margin:0 auto; height:100vh; display:flex; flex-direction:column; }
  .header { padding:14px 14px 6px; }
  .header h1 { font-size:18px; font-weight:800; }
  .header p { font-size:12px; color:var(--muted); }
  .fault-banner { background:var(--red); color:#fff; font-size:12px; font-weight:700; padding:6px 14px; display:none; }
  .fault-banner.show { display:block; }
  .content { flex:1; overflow-y:auto; padding:14px; display:flex; flex-direction:column; gap:12px; }
  .card { background:var(--card); border-radius:14px; padding:14px; box-shadow:0 1px 3px rgba(0,0,0,.06); }
  .card h3 { font-size:13px; font-weight:700; margin-bottom:8px; color:var(--text); }
  .dim { color:var(--muted); font-size:12px; }
  .row { display:flex; gap:12px; }
  .row .card { flex:1; }
  .glucose-big { font-size:40px; font-weight:800; }
  .action-class { font-size:22px; font-weight:700; }
  .btn { padding:10px 18px; border-radius:10px; border:none; color:#fff; font-weight:700; font-size:14px; cursor:pointer; }
  .btn:active { opacity:.8; }
  .btn-approve { background:var(--blue); }
  .btn-dismiss { background:#9E9E9E; }
  .bar-chart { display:flex; align-items:flex-end; height:90px; gap:1px; }
  .bar-chart .bar { flex:1; border-radius:2px; min-height:3px; }
  .forecast-chart { display:flex; align-items:flex-end; height:60px; gap:4px; }
  .forecast-chart .fbar-wrap { flex:1; text-align:center; }
  .forecast-chart .fbar { height:0; background:var(--blue); border-radius:2px; margin:0 auto; width:80%; transition:height .5s; }
  .forecast-chart .flabel { font-size:8px; color:#666; }
  .risk-block { margin-top:8px; padding:10px; border-radius:8px; font-size:13px; }
  .risk-high { background:#FDECEA; }
  .risk-ok { background:#E8F5E9; }
  /* chat */
  .chat-log { flex:1; overflow-y:auto; padding:12px; display:flex; flex-direction:column; gap:8px; }
  .bubble { max-width:85%; padding:10px 12px; border-radius:14px; font-size:14px; align-self:flex-start; background:#fff; box-shadow:0 1px 2px rgba(0,0,0,.06); }
  .bubble.user { align-self:flex-end; background:var(--blue); color:#fff; }
  .bubble .tools { font-size:10px; color:var(--yellow); margin-top:4px; }
  .bubble.user .tools { color:rgba(255,255,255,.6); }
  .chat-input-row { display:flex; gap:8px; padding:10px; background:#fff; border-top:1px solid var(--border); }
  .chat-input-row input { flex:1; border:1px solid #ddd; border-radius:10px; padding:10px 12px; font-size:14px; }
  .chat-input-row button { background:var(--blue); color:#fff; border:none; border-radius:10px; padding:10px 16px; font-weight:700; cursor:pointer; }
  /* alerts */
  .alert-item { font-size:13px; margin-bottom:6px; }
  .alert-level { font-weight:700; }
  /* tab bar */
  .tabbar { display:flex; border-top:1px solid var(--border); background:#fff; }
  .tab { flex:1; text-align:center; padding:12px 0; font-weight:600; font-size:14px; color:#666; cursor:pointer; border-bottom:2px solid transparent; }
  .tab.active { color:var(--blue); border-bottom-color:var(--blue); }
  .hidden { display:none !important; }
  .badge { display:inline-block; padding:2px 8px; border-radius:99px; font-size:11px; font-weight:700; }
</style>
</head>
<body>
<div class="header">
  <h1>GlucoLoop</h1>
  <p>diabetes, three horizons, one assistant</p>
</div>
<div class="fault-banner" id="fault-banner"></div>

<div class="content" id="tab-dashboard">
  <div class="row">
    <div class="card">
      <h3>Glucose</h3>
      <div class="glucose-big" id="glucose-val">--</div>
      <div class="dim" id="glucose-sub">waiting…</div>
    </div>
    <div class="card" style="flex:1.4">
      <h3>Next 60 min</h3>
      <div class="forecast-chart" id="forecast-chart"><div class="dim">loading…</div></div>
    </div>
  </div>
  <div class="card">
    <h3>Last 2 h</h3>
    <div class="bar-chart" id="history-chart"><div class="dim">waiting for CGM…</div></div>
  </div>
  <div class="card" id="action-card">
    <h3>Recommended pump action</h3>
    <div class="dim">no forecast yet</div>
  </div>
  <div class="card">
    <h3>Alerts</h3>
    <div id="alerts-list"><div class="dim">no alerts</div></div>
  </div>
  <div class="card">
    <h3>Latest check-in</h3>
    <div id="checkin-info"><div class="dim">Ella hasn't collected a check-in yet — open the Ella tab.</div></div>
  </div>
</div>

<div class="content hidden" id="tab-chat" style="padding:0">
  <div class="chat-log" id="chat-log">
    <div class="bubble">Hi! I'm Ella. How are you feeling today?</div>
  </div>
  <div class="chat-input-row">
    <input id="chat-input" placeholder="Tell Ella about meals, sleep, exercise, stress…" onkeydown="if(event.key==='Enter')sendChat()">
    <button onclick="sendChat()">Send</button>
  </div>
</div>

<div class="content hidden" id="tab-insights">
  <div class="card">
    <h3>24-hour risk envelope</h3>
    <div class="dim">Each block shows the predicted 10th percentile of the minimum and 90th percentile of the maximum glucose in that 4-hour window.</div>
    <div id="risk-blocks"><div class="dim" style="margin-top:8px">waiting for forecast…</div></div>
  </div>
  <div class="card">
    <h3>About your forecast</h3>
    <div class="dim">Forecasts combine your CGM, pump telemetry, and what you tell Ella in chat. This is guidance, not medical advice.</div>
  </div>
</div>

<div class="tabbar">
  <div class="tab active" id="tab-btn-0" onclick="switchTab(0)">Dashboard</div>
  <div class="tab" id="tab-btn-1" onclick="switchTab(1)">Ella</div>
  <div class="tab" id="tab-btn-2" onclick="switchTab(2)">Insights</div>
</div>

<script>
const PATIENT = "demo-001";
const $ = id => document.getElementById(id);
const ACTION_COLORS = { no_op:"#2E7D32", alarm_only:"#F9A825", reduce_basal:"#EF6C00", suspend:"#C62828", correction_bolus:"#6A1B9A" };

function switchTab(i) {
  ["tab-dashboard","tab-chat","tab-insights"].forEach((id, j) => $(id).classList.toggle("hidden", j !== i));
  [0,1,2].forEach(j => $("tab-btn-"+j).classList.toggle("active", j === i));
}

async function poll() {
  try {
    const [state, forecast] = await Promise.all([
      fetch("/state/"+PATIENT).then(r=>r.json()),
      fetch("/forecast/"+PATIENT).then(r=>r.json()).catch(()=>null),
    ]);
    renderState(state);
    if (forecast && !forecast.error) renderForecast(forecast);
  } catch(e) { /* backend down */ }
}

function renderState(s) {
  const latest = s.latest || {};
  const g = latest.cgm?.glucose_mgdl;
  $("glucose-val").textContent = g == null ? "--" : Math.round(g);
  $("glucose-val").style.color = g == null ? "#999" : g < 70 ? "var(--red)" : g > 180 ? "var(--orange)" : "var(--text)";
  $("glucose-sub").textContent = "mg/dL · CGM " + (latest.cgm?.cgm_quality ?? "?") + " · pump " + (latest.pump?.pump_status ?? "?");

  // Fault banner
  const faults = s.active_faults || [];
  const banner = $("fault-banner");
  if (faults.length) { banner.textContent = "⚠ Active fault: " + faults.join(", "); banner.classList.add("show"); }
  else banner.classList.remove("show");

  // History bar chart
  const hist = (s.history || []).map(r => r.cgm?.glucose_mgdl).filter(x => x != null);
  const chart = $("history-chart");
  if (hist.length) {
    const mx = Math.max(...hist, 180), mn = Math.min(...hist, 60);
    chart.innerHTML = hist.slice(-24).map(v => {
      const h = 90 * (v - mn) / (mx - mn || 1);
      const c = v < 70 ? "var(--red)" : v > 180 ? "var(--orange)" : "var(--blue)";
      return '<div class="bar" style="height:'+Math.max(3,h)+'px;background:'+c+'"></div>';
    }).join("");
  } else chart.innerHTML = '<div class="dim">waiting for CGM…</div>';

  // Alerts
  const alerts = (s.alerts || []).slice().reverse();
  $("alerts-list").innerHTML = alerts.length === 0 ? '<div class="dim">no alerts</div>' :
    alerts.map(a => '<div class="alert-item"><span class="alert-level" style="color:'+(a.level==="critical"?"var(--red)":a.level==="warning"?"var(--orange)":"var(--blue)")+'">['+a.level.toUpperCase()+']</span> '+a.message+'</div>').join("");

  // Check-in
  $("checkin-info").innerHTML = s.checkin
    ? '<div class="dim">🍽 '+ (s.checkin.carbs_g ?? "—") +'g carbs · 😴 '+(s.checkin.sleep_hours ?? "—")+'h sleep · 🏃 '+(s.checkin.exercise_min ?? "—")+'min · 😰 stress '+(s.checkin.stress_1_5 ?? "—")+'/5</div>'
    : '<div class="dim">Ella hasn\'t collected a check-in yet — open the Ella tab.</div>';
}

function renderForecast(f) {
  // Forecast chart (medium horizons)
  const fc = $("forecast-chart");
  if (f.medium && f.medium.length) {
    const mx = Math.max(...f.medium.map(p=>p.point), 180), mn = Math.min(...f.medium.map(p=>p.point), 60);
    fc.innerHTML = f.medium.map(p => {
      const h = Math.max(4, (p.point - 40) / 2);
      return '<div class="fbar-wrap"><div class="fbar" style="height:'+h+'px"></div><div class="flabel">'+p.minutes+'m</div></div>';
    }).join("");
  }
  // Action card
  const a = f.action;
  if (a) {
    const color = ACTION_COLORS[a.class] || "#2E7D32";
    $("action-card").innerHTML = '<h3>Recommended pump action</h3>' +
      '<div class="action-class" style="color:'+color+'">'+a.class.replace(/_/g," ")+'</div>' +
      '<div class="dim">model confidence '+((a.probs?.[a.class] ?? 0).toFixed(2))+'</div>' +
      '<div style="display:flex;gap:10px;margin-top:10px">' +
      '<button class="btn btn-approve" style="background:'+color+'" onclick="alert(\'Action approved (demo): '+a.class+'\')">Approve</button>' +
      '<button class="btn btn-dismiss" onclick="">Dismiss</button></div>';
  }
  // Risk blocks
  const blocks = f.long || [];
  $("risk-blocks").innerHTML = blocks.length === 0 ? '<div class="dim" style="margin-top:8px">waiting for forecast…</div>' :
    blocks.map(b => '<div class="risk-block '+(b.risk==="high"?"risk-high":"risk-ok")+'">' +
      '<b>'+b.window_start_h+'h–'+b.window_end_h+'h</b> · '+(b.risk==="high"?"⚠️ high risk":"ok")+'<br>' +
      '<span class="dim">low q10: '+b.min_q10+' mg/dL · high q90: '+b.max_q90+' mg/dL</span></div>').join("");
}

async function sendChat() {
  const msg = $("chat-input").value.trim();
  if (!msg) return;
  $("chat-input").value = "";
  const log = $("chat-log");
  log.innerHTML += '<div class="bubble user">'+msg+'</div>';
  log.scrollTop = log.scrollHeight;
  try {
    const r = await fetch("/chat/"+PATIENT, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({message:msg}) });
    const d = await r.json();
    let html = '<div class="bubble">'+(d.reply || d.error || "?");
    if (d.toolCalls && d.toolCalls.length) html += '<div class="tools">tools: '+d.toolCalls.join(", ")+'</div>';
    html += '</div>';
    log.innerHTML += html;
  } catch(e) {
    log.innerHTML += '<div class="bubble">Connection problem — is the backend running?</div>';
  }
  log.scrollTop = log.scrollHeight;
}

poll();
setInterval(poll, 5000);
</script>
</body>
</html>`;
