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
