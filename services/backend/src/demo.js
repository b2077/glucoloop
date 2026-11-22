/** Standalone simulation page, linked from the dashboard and served by server.js.
 * Browser-only learning never writes patient state or calls treatment endpoints.
 */
export const DEMO_HTML = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GlucoLoop forecast personalisation demo</title>
<style>
body{font:17px system-ui,sans-serif;max-width:1000px;margin:auto;padding:24px;background:#f5f7fb;color:#17243b}
section{background:white;padding:20px;border:1px solid #ccd4df;border-radius:12px;margin:16px 0}
button,select{font:inherit;padding:10px;margin:4px}svg{width:100%;height:auto}p{line-height:1.6}
.legend{display:flex;flex-wrap:wrap;gap:20px}.prior{color:#52647a}.adapted{color:#1565c0}.truth{color:#8e2475}
.chart-scroll{overflow-x:auto}.chart-scroll svg{min-width:700px}
</style>
<a href="/dashboard">Back to dashboard</a><h1>Glucose forecast personalisation</h1>
<section><strong>Simulation only. These are invented examples, not measured human averages.</strong>
<p>Explore a possible response to one event. The starting estimate changes as completed simulated
observations become available. This page does not use the eighteen trained models or change insulin delivery.</p>
<label for="scenario">Example event</label> <select id="scenario"></select>
<button id="observe" type="button">Add a simulated observation</button>
<button id="reset" type="button">Reset this example</button><p id="learning" aria-live="polite"></p></section>
<section><h2>Illustrative five-hour glucose response</h2>
<div class="chart-scroll" tabindex="0" role="region" aria-label="Glucose chart; scroll horizontally on small screens"><svg viewBox="0 0 900 330" role="img" aria-labelledby="chart-title"><title id="chart-title">Simulated glucose curves, in milligrams per decilitre, over minutes</title><g id="plot"></g></svg></div>
<div class="legend"><span class="prior">Dashed grey: starting estimate</span><span class="adapted">Blue: adapted estimate</span>
<span class="truth">Dotted purple: held-out simulated outcome</span></div><p id="metrics"></p></section>
<section><h2>What this shows</h2><p>The learning weight is n / (n + k), where n is the number of completed
observations and k is the configured starting weight. Each event learns separately. Reset clears this browser session's example.</p>
<p>Here the baseline and event are known because we generated them. With real records, meals, insulin and other factors overlap;
a change after exercise alone would not establish its effect. The purple curve is for comparison and never enters the update.</p>
<p>Medical guidance supports considering these factors, but does not establish our chosen sizes, shapes or timing.
Moderate activity can lower glucose; intense activity can also raise it. Stress responses vary.
Periods, menopause and sleep need additional data and are not modelled here.</p>
<p><a href="https://www.mayoclinic.org/diseases-conditions/diabetes/in-depth/diabetes-management/art-20047963">Mayo lifestyle guidance</a> ·
<a href="https://diabetes.org/health-wellness/fitness/exercise-and-type-1">Exercise guidance</a></p></section>
<script type="module">
import {estimate, curve, summary} from '/demo/model.js';
const $ = id => document.getElementById(id);
try {
  const response = await fetch('/demo/config.json');
  if (!response.ok) throw new Error('Demo configuration unavailable');
  const c = await response.json(), histories = {};
  for (const [key, s] of Object.entries(c.scenarios)) {
    const option = document.createElement('option'); option.value = key; option.textContent = s.label;
    $('scenario').append(option); histories[key] = [];
  }
  function render() {
    const key = $('scenario').value, s = c.scenarios[key], history = histories[key];
    const adapted = estimate(s.initial_delta_mgdl, history, c.prior_observations);
    const series = [curve(s.initial_delta_mgdl,c), curve(adapted,c), curve(s.simulated_delta_mgdl,c)];
    const values = series.flat().map(p => p.glucose);
    const ymin = Math.min(c.low_mgdl,...values)-10, ymax = Math.max(c.high_mgdl,...values)+10;
    const x = t => 60 + t/c.total_minutes*810, y = g => 280-(g-ymin)/(ymax-ymin)*250;
    let svg = '<line x1="60" y1="280" x2="870" y2="280" stroke="#596575"/>';
    for (const g of [c.low_mgdl,c.baseline_mgdl,c.high_mgdl]) svg += '<line x1="60" x2="870" y1="'+y(g)+'" y2="'+y(g)+'" stroke="#d0d7df"/><text x="4" y="'+y(g)+'">'+g+'</text>';
    for (let t=0; t<=c.total_minutes; t+=60) svg += '<text x="'+x(t)+'" y="305" text-anchor="middle">'+t+'</text>';
    svg += '<text x="60" y="20">Glucose (mg/dL)</text><text x="460" y="327">Minutes</text>';
    series.forEach((points,i) => { svg += '<polyline fill="none" stroke="'+['#52647a','#1565c0','#8e2475'][i]+'" stroke-width="3" stroke-dasharray="'+['9 5','none','2 6'][i]+'" points="'+points.map(p=>x(p.t)+','+y(p.glucose)).join(' ')+'"/>'; });
    $('plot').innerHTML = svg;
    $('learning').textContent = history.length+' completed simulated observations. Estimated peak change: '+adapted.toFixed(1)+' mg/dL. Starting estimate: '+s.initial_delta_mgdl+' mg/dL.';
    const m = summary(series[1],c.low_mgdl,c.high_mgdl);
    $('metrics').textContent = 'Adapted curve reading percentages: '+m.low.toFixed(1)+'% below '+c.low_mgdl+', '+m.inRange.toFixed(1)+'% within '+c.low_mgdl+'–'+c.high_mgdl+', '+m.high.toFixed(1)+'% above '+c.high_mgdl+' mg/dL. Mean '+m.mean.toFixed(1)+' mg/dL. Equally spaced simulated readings; these are not clinical performance results.';
  }
  $('observe').onclick = () => { const key=$('scenario').value, h=histories[key]; h.push(c.scenarios[key].simulated_delta_mgdl+c.observation_noise_mgdl[h.length%c.observation_noise_mgdl.length]); render(); };
  $('reset').onclick = () => { histories[$('scenario').value]=[]; render(); };
  $('scenario').onchange = render; render();
} catch (error) { $('learning').textContent='Demo failed: '+error.message; $('observe').disabled=true; }
</script></html>`;
