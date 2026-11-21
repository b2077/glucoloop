// Tests for buildAgentContext — the BE context injected into LLM conversations
import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/state.js";
import { buildAgentContext } from "../src/agent/context.js";

function seed(store, pid, glucose, quality = "ok", pump = "ok") {
  for (let i = 0; i < 12; i++) {
    store.ingest({
      patient_id: pid, type: "cgm", t: i * 5,
      cgm: { glucose_mgdl: glucose + i, cgm_quality: quality, hr: 70 + i, activity: "none" },
      pump: { iob_units: 1, commanded_basal_u_hr: 1.1, delivered_basal_u_hr: 1.1, pump_status: pump },
    });
  }
}

test("context: includes patient id and glucose in mg/dL + mmol/L", () => {
  const s = new Store();
  seed(s, "ctx1", 90);
  const ctx = buildAgentContext(s, "ctx1");
  assert.match(ctx, /patient: ctx1/);
  assert.match(ctx, /\d+ mg\/dL \(\d+\.\d mmol\/L\)/);
  assert.match(ctx, /HR=\d+ bpm/);
});

test("context: flags CGM drift as active fault", () => {
  const s = new Store();
  seed(s, "ctx2", 100, "drift");
  const ctx = buildAgentContext(s, "ctx2");
  assert.match(ctx, /ACTIVE FAULTS.*CGM DRIFT/);
  assert.match(ctx, /alarm_only/);
});

test("context: flags pump occlusion", () => {
  const s = new Store();
  seed(s, "ctx3", 100, "ok", "occlusion");
  const ctx = buildAgentContext(s, "ctx3");
  assert.match(ctx, /PUMP OCCLUSION/);
});

test("context: includes TIR, profile, check-in", () => {
  const s = new Store();
  seed(s, "ctx4", 100);
  s.setProfile("ctx4", { ic_ratio_g_per_u: 12, isf_mgdl_per_u: 45, basal_u_hr: 1.3, target_mgdl: 100 });
  s.addCheckin("ctx4", { carbs_g: 60, sleep_hours: 6 });
  const ctx = buildAgentContext(s, "ctx4");
  assert.match(ctx, /TIR.*last 1h = \d+(\.\d+)?%/);
  assert.match(ctx, /IC ratio=12/);
  assert.match(ctx, /ISF=45/);
  assert.match(ctx, /carbs=60g/);
  assert.match(ctx, /sleep=6h/);
});

test("context: includes forecast action when available", () => {
  const s = new Store();
  seed(s, "ctx5", 100);
  s.get("ctx5").lastForecast = {
    short: { minutes: 5, point: 95 }, medium: [{ minutes: 60, point: 100 }],
    long: [], action: { class: "no_op", probs: { no_op: 0.9 } },
  };
  const ctx = buildAgentContext(s, "ctx5");
  assert.match(ctx, /action=no_op/);
});

test("context: empty patient still returns valid block", () => {
  const s = new Store();
  const ctx = buildAgentContext(s, "nobody");
  assert.match(ctx, /\[CURRENT PATIENT CONTEXT — patient: nobody\]/);
  assert.match(ctx, /\[\/CONTEXT\]/);
  assert.match(ctx, /Readings stored: 0/);
});

test("context: includes recent alerts and recommendations", () => {
  const s = new Store();
  seed(s, "ctx6", 50); // low glucose
  s.addAlert({ id: "a1", patient_id: "ctx6", level: "critical", message: "Low glucose!", created_at: "" });
  s.addRecommendation("ctx6", { type: "hypo_risk", level: "critical", message: "eat carbs" });
  const ctx = buildAgentContext(s, "ctx6");
  assert.match(ctx, /Recent alerts.*critical.*Low glucose/);
  assert.match(ctx, /Recent recommendations.*hypo_risk/);
});
