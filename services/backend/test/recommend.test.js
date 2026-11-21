// Tests for the recommendation engine (FE issue #5.3)
import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/state.js";
import { generateRecommendations } from "../src/recommend.js";

function seedPatient(store, pid, glucose, quality = "ok", pumpStatus = "ok") {
  for (let i = 0; i < 12; i++) {
    store.ingest({
      patient_id: pid, type: "cgm", t: i * 5,
      cgm: { glucose_mgdl: glucose + i, cgm_quality: quality, hr: 70, activity: "none" },
      pump: { iob_units: 1, commanded_basal_u_hr: 1.1, delivered_basal_u_hr: 1.1, pump_status: pumpStatus },
    });
  }
}

const fakeForecast = (shortPt, actionClass = "no_op", prob = 0.9) => ({
  short: { minutes: 5, point: shortPt },
  medium: [{ minutes: 5, point: shortPt }, { minutes: 60, point: shortPt }],
  long: [],
  action: { class: actionClass, probs: { [actionClass]: prob, no_op: 1 - prob } },
});

test("recommend: hypo risk when glucose < 72", () => {
  const s = new Store();
  seedPatient(s, "r1", 65);
  s.setProfile("r1", { isf_mgdl_per_u: 50, ic_ratio_g_per_u: 10, target_mgdl: 100 });
  const recs = generateRecommendations(s, "r1", fakeForecast(60));
  const hypo = recs.find((r) => r.type === "hypo_risk");
  assert.ok(hypo, "should have hypo_risk");
  assert.equal(hypo.level, "critical");
  assert.match(hypo.message, /fast carbs/);
});

test("recommend: hyper risk with correction estimate", () => {
  const s = new Store();
  seedPatient(s, "r2", 220);
  s.setProfile("r2", { isf_mgdl_per_u: 50, target_mgdl: 100 });
  const recs = generateRecommendations(s, "r2", fakeForecast(240, "correction_bolus", 0.85));
  const hyper = recs.find((r) => r.type === "hyper_risk");
  assert.ok(hyper, "should have hyper_risk");
  assert.ok(hyper.correction_units > 0);
  assert.equal(hyper.suggested_action, "correction_bolus");
});

test("recommend: device fault → alarm_only, no dosing", () => {
  const s = new Store();
  seedPatient(s, "r3", 100, "drift");
  const recs = generateRecommendations(s, "r3", fakeForecast(100));
  assert.equal(recs.length, 1);
  assert.equal(recs[0].type, "device_fault");
  assert.equal(recs[0].suggested_action, "alarm_only");
});

test("recommend: pump occlusion → device_fault", () => {
  const s = new Store();
  seedPatient(s, "r4", 100, "ok", "occlusion");
  const recs = generateRecommendations(s, "r4", null);
  assert.ok(recs.some((r) => r.type === "device_fault"));
});

test("recommend: normal glucose → no critical recs", () => {
  const s = new Store();
  seedPatient(s, "r5", 110);
  const recs = generateRecommendations(s, "r5", fakeForecast(115, "no_op", 0.95));
  assert.ok(!recs.some((r) => r.level === "critical"));
});

test("recommend: ML policy action surfaced when confidence > 0.5", () => {
  const s = new Store();
  seedPatient(s, "r6", 95);
  const recs = generateRecommendations(s, "r6", fakeForecast(68, "suspend", 0.8));
  const policy = recs.find((r) => r.type === "policy");
  assert.ok(policy, "should have policy rec");
  assert.equal(policy.suggested_action, "suspend");
  assert.equal(policy.confidence, 0.8);
});

test("recommend: no readings → empty", () => {
  const s = new Store();
  const recs = generateRecommendations(s, "empty", null);
  assert.deepEqual(recs, []);
});
