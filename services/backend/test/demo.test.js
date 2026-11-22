import { test } from "node:test";
import assert from "node:assert/strict";
import { estimate, curve, summary } from "../src/demo-model.js";
import fs from "node:fs";
const c = JSON.parse(fs.readFileSync(new URL("../src/demo-config.json", import.meta.url)));

test("no observations preserves the starting estimate; completed observations gradually adapt", () => {
  assert.equal(estimate(-20, [], 4), -20);
  assert.equal(estimate(-20, [-30,-30,-30,-30], 4), -25);
  assert.throws(() => estimate(-20,[NaN],4));
  assert.throws(() => estimate(-20,[],0));
});
test("response starts after event and returns to baseline", () => {
  const points=curve(-30,c);
  assert.equal(points.length,c.total_minutes/c.step_minutes+1);
  assert.ok(points.filter(p=>p.t<=c.event_start_minutes).every(p=>p.glucose===c.baseline_mgdl));
  assert.equal(points.at(-1).glucose,c.baseline_mgdl);
  assert.ok(Math.min(...points.map(p=>p.glucose))<c.baseline_mgdl);
  assert.throws(()=>curve(20,{...c,step_minutes:0}));
});
test("summary includes boundary and high readings without dropping them", () => {
  const m=summary([60,70,100,180,200].map(glucose=>({glucose})),70,180);
  assert.deepEqual(m,{low:20,inRange:60,high:20,mean:122});
  assert.equal(summary([{glucose:400}],70,180).high,100);
  assert.throws(()=>summary([],70,180));
});
test("all configured illustrative scenarios converge toward their synthetic personal response", () => {
  for(const s of Object.values(c.scenarios)) {
    const learned=estimate(s.initial_delta_mgdl,Array(12).fill(s.simulated_delta_mgdl),c.prior_observations);
    assert.ok(Math.abs(learned-s.simulated_delta_mgdl)<Math.abs(s.initial_delta_mgdl-s.simulated_delta_mgdl));
  }
});
