// Unit tests for Store and validateReading — uses built-in node:test (zero deps)
import { test } from "node:test";
import assert from "node:assert/strict";
import { Store, validateReading } from "../src/state.js";

function validReading(overrides = {}) {
  return {
    patient_id: "test-001",
    type: "cgm",
    t: 0,
    cgm: { glucose_mgdl: 120, cgm_quality: "ok", hr: 72, activity: "none" },
    pump: { iob_units: 1.0, commanded_basal_u_hr: 1.1, delivered_basal_u_hr: 1.1, pump_status: "ok" },
    ...overrides,
  };
}

test("validateReading: accepts a valid reading", () => {
  assert.deepEqual(validateReading(validReading()), []);
});

test("validateReading: rejects missing patient_id", () => {
  const errors = validateReading({ type: "cgm", t: 0 });
  assert.ok(errors.some((e) => e.includes("patient_id")));
});

test("validateReading: rejects invalid type", () => {
  const errors = validateReading(validReading({ type: "bogus" }));
  assert.ok(errors.some((e) => e.includes("type")));
});

test("validateReading: rejects non-number t", () => {
  const errors = validateReading(validReading({ t: "abc" }));
  assert.ok(errors.some((e) => e.includes("t")));
});

test("validateReading: allows null glucose during dropout", () => {
  const r = validReading();
  r.cgm.glucose_mgdl = null;
  r.cgm.cgm_quality = "dropout";
  assert.deepEqual(validateReading(r), []);
});

test("Store: ingest and retrieve", () => {
  const s = new Store();
  s.ingest(validReading({ t: 5 }));
  const sum = s.summary("test-001");
  assert.equal(sum.patient_id, "test-001");
  assert.equal(sum.history.length, 1);
  assert.equal(sum.latest.t, 5);
});

test("Store: ingest throws on invalid reading", () => {
  const s = new Store();
  assert.throws(() => s.ingest({ patient_id: "x", type: "bad", t: "no" }), /invalid reading/);
});

test("Store: caps readings at MAX (288)", () => {
  const s = new Store();
  for (let i = 0; i < 300; i++) s.ingest(validReading({ t: i }));
  assert.equal(s.get("test-001").readings.length, 288);
});

test("Store: mlWindow returns last 12 readings with checkin defaults", () => {
  const s = new Store();
  for (let i = 0; i < 15; i++) s.ingest(validReading({ t: i }));
  const w = s.mlWindow("test-001");
  assert.equal(w.length, 12);
  assert.equal(w[0].t, 3); // last 12 of 0..14 → starts at 3
  assert.equal(w[0].sleep_hours_last, 7); // default
  assert.equal(w[0].carbs_g_3h, 0); // default
});

test("Store: addCheckin merges with previous", () => {
  const s = new Store();
  s.addCheckin("p1", { carbs_g: 60 });
  s.addCheckin("p1", { sleep_hours: 6 });
  const ci = s.latestCheckin("p1");
  assert.equal(ci.carbs_g, 60);
  assert.equal(ci.sleep_hours, 6);
  assert.ok(ci.logged_at);
});

test("Store: metrics aggregates patients", () => {
  const s = new Store();
  s.ingest(validReading({ patient_id: "a" }));
  s.ingest(validReading({ patient_id: "b", t: 1 }));
  s.addAlert({ patient_id: "a", id: "x", level: "info", message: "hi", created_at: "" });
  const m = s.metrics();
  assert.equal(m.patient_count, 2);
  const pa = m.patients.find((p) => p.patient_id === "a");
  assert.equal(pa.readings_count, 1);
  assert.equal(pa.alerts_count, 1);
});

test("Store: summary includes active_faults (none when healthy)", () => {
  const s = new Store();
  s.ingest(validReading({ patient_id: "f1" }));
  const sum = s.summary("f1");
  assert.deepEqual(sum.active_faults, []);
  assert.equal(sum.latest_cgm_quality, "ok");
  assert.equal(sum.latest_pump_status, "ok");
  assert.ok(typeof sum.latest_iob === "number");
});

test("Store: summary flags cgm_drift and pump occlusion", () => {
  const s = new Store();
  const drift = validReading({ patient_id: "f2", t: 0 });
  drift.cgm.cgm_quality = "drift";
  s.ingest(drift);
  let sum = s.summary("f2");
  assert.deepEqual(sum.active_faults, ["cgm_drift"]);

  const occ = validReading({ patient_id: "f2", t: 5 });
  occ.cgm.cgm_quality = "ok";
  occ.pump.pump_status = "occlusion";
  occ.pump.iob_units = 0.1;
  s.ingest(occ);
  sum = s.summary("f2");
  assert.deepEqual(sum.active_faults, ["occlusion"]);
  assert.equal(sum.latest_iob, 0.1);
  assert.equal(sum.latest_pump_status, "occlusion");
});

test("Store: summary flags cgm_dropout with null glucose", () => {
  const s = new Store();
  const drop = validReading({ patient_id: "f3", t: 0 });
  drop.cgm.glucose_mgdl = null;
  drop.cgm.cgm_quality = "dropout";
  s.ingest(drop);
  const sum = s.summary("f3");
  assert.deepEqual(sum.active_faults, ["cgm_dropout"]);
  assert.equal(sum.latest_cgm_quality, "dropout");
});

// ---- TIR tests (FE issue #5.2) ----
test("Store.tir: computes TIR for 4-10 mmol/L range", () => {
  const s = new Store();
  // 10 readings: 5 in range (72-180), 3 low (<72), 2 high (>180)
  const glucoses = [80, 100, 120, 150, 170, 60, 65, 50, 200, 250];
  glucoses.forEach((g, i) => {
    const r = validReading({ patient_id: "tir1", t: i * 5 });
    r.cgm.glucose_mgdl = g;
    s.ingest(r);
  });
  const tir = s.tir("tir1");
  assert.equal(tir.total, 10);
  assert.equal(tir.in_range, 5);
  assert.equal(tir.tir_pct, 50);
  assert.equal(tir.low_pct, 30);
  assert.equal(tir.high_pct, 20);
  assert.equal(tir.range.low_mmol, 4);
  assert.equal(tir.range.high_mmol, 10);
});

test("Store.tir: 1h range only counts recent readings", () => {
  const s = new Store();
  for (let i = 0; i < 24; i++) {
    const r = validReading({ patient_id: "tir2", t: i * 5 });
    r.cgm.glucose_mgdl = i < 11 ? 200 : 100; // first 11 high (t=0..50), rest in range (t=55..115)
    s.ingest(r);
  }
  const tir1h = s.tir("tir2", 60); // last 60 min from max t=115 → t>=55 → 13 readings, all in range
  assert.equal(tir1h.total, 13);
  assert.equal(tir1h.tir_pct, 100);
  const tirAll = s.tir("tir2", null);
  assert.equal(tirAll.tir_pct, 54.2); // 13 of 24 in range
});

test("Store.tir: ignores dropout readings", () => {
  const s = new Store();
  for (let i = 0; i < 5; i++) {
    const r = validReading({ patient_id: "tir3", t: i * 5 });
    r.cgm.glucose_mgdl = i === 2 ? null : 100;
    if (i === 2) r.cgm.cgm_quality = "dropout";
    s.ingest(r);
  }
  const tir = s.tir("tir3");
  assert.equal(tir.total, 4); // dropout excluded
  assert.equal(tir.tir_pct, 100);
});

test("Store.tir: empty patient returns null TIR", () => {
  const s = new Store();
  const tir = s.tir("nonexistent");
  assert.equal(tir.tir_pct, null);
  assert.equal(tir.total, 0);
});

// ---- Profile tests (FE issue #5.3) ----
test("Store: setProfile merges with defaults", () => {
  const s = new Store();
  const p = s.setProfile("prof1", { ic_ratio_g_per_u: 15, isf_mgdl_per_u: 40 });
  assert.equal(p.ic_ratio_g_per_u, 15);
  assert.equal(p.isf_mgdl_per_u, 40);
  assert.equal(p.basal_u_hr, 1.1); // default
  assert.ok(p.updated_at);
  assert.deepEqual(s.getProfile("prof1"), p);
});

test("Store: getProfile returns null for unknown patient", () => {
  const s = new Store();
  assert.equal(s.getProfile("nobody"), null);
});

// ---- Recommendations tests ----
test("Store: addRecommendation and recommendations()", () => {
  const s = new Store();
  s.addRecommendation("rec1", { type: "hypo_risk", level: "critical", message: "low" });
  s.addRecommendation("rec1", { type: "hyper_risk", level: "warning", message: "high" });
  const recs = s.recommendations("rec1");
  assert.equal(recs.length, 2);
  assert.equal(recs[0].type, "hypo_risk");
  assert.ok(recs[0].id);
  assert.ok(recs[0].created_at);
});

// ---- allReadings (FE issue #5.1) ----
test("Store: allReadings returns full history up to MAX", () => {
  const s = new Store();
  for (let i = 0; i < 300; i++) {
    const r = validReading({ patient_id: "hist1", t: i * 5 });
    s.ingest(r);
  }
  const all = s.allReadings("hist1");
  assert.equal(all.length, 288); // capped at MAX
  assert.equal(all[0].t, (300 - 288) * 5);
});
