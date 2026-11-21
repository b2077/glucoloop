"""
GlucoLoop physiological simulator (Bergman minimal model + behavior + faults).

1-minute internal resolution, 5-minute sampled rows.
- Insulin state = DEVIATION from basal equilibrium (negative IOB = deficit).
- The simulated patient uses a naive controller with FIXED assumed parameters
  (icr=20 g/U, sens=42 mg/dL/U) while the true parameters vary per patient
  (+/-25%). Those mistakes generate the hypo/hyper excursions the ML policy
  learns to prevent.

Public API — function signatures
--------------------------------
Data types:
    Meal(t: int, carbs_g: float)
    Exercise(t: int, duration_min: int, intensity: float)      # 0..1
    Stress(t: int, duration_min: int, level: int)               # 1..5
    Sleep(start_min: int, end_min: int, quality: float)         # 0..1
    Fault(kind: str, start_min: int, end_min: int, intensity: float = 1.0)
    Scenario(seed, days, faults, meals, exercises, stresses, sleeps)
        .manifest() -> dict

Scenario generation:
    random_scenario(seed: int, days: int = 3, fault_prob: float = 0.85,
                    heavy_faults: bool = False) -> Scenario
    run_scenario(sc: Scenario) -> list[dict]
    expert_label(row: dict, fut60: list[float]) -> str

Patient (simulator core):
    Patient(sc: Scenario)
        .step() -> dict              # advance 5 min, return sensor row
        ._step_min() -> None         # advance 1 min (internal)
        ._fault(kind: str) -> Fault | None

step() return shape:
    {"t": int, "minute_of_day": int,
     "cgm_glucose": float | None, "cgm_quality": str,   # ok | drift | dropout
     "hr": int, "activity": str,                         # none|light|moderate|intense
     "commanded_basal": float, "delivered_basal": float,
     "iob": float, "pump_status": str,                   # ok | occlusion | leakage
     "carbs_g_3h": float, "exercise_min_2h": int,
     "sleep_hours_last": float, "stress_1_5": int,
     "true_glucose": float}                              # ground truth (training only)
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Optional
import numpy as np

CARB_GAIN = 2.3        # mg/dL glucose potential per gram of carbs
K_GUT = 0.014
N_INS = 0.030
P1 = 0.010
P2 = 0.025
P3 = 4.2e-4

ACTION_CLASSES = ["no_op", "alarm_only", "reduce_basal", "suspend", "correction_bolus"]


@dataclass
class Meal:
    t: int
    carbs_g: float


@dataclass
class Exercise:
    t: int
    duration_min: int
    intensity: float  # 0..1


@dataclass
class Stress:
    t: int
    duration_min: int
    level: int  # 1..5


@dataclass
class Sleep:
    start_min: int
    end_min: int
    quality: float  # 0..1


@dataclass
class Fault:
    kind: str              # cgm_drift | cgm_dropout | pump_occlusion | pump_leakage
    start_min: int
    end_min: int
    intensity: float = 1.0


@dataclass
class Scenario:
    seed: int
    days: int
    faults: list
    meals: list
    exercises: list
    stresses: list
    sleeps: list

    def manifest(self) -> dict:
        d = asdict(self)
        for key in ("meals", "exercises", "stresses"):
            d[key] = len(d[key])
        return d


def random_scenario(seed: int, days: int = 3, fault_prob: float = 0.85,
                    heavy_faults: bool = False) -> Scenario:
    rng = np.random.default_rng(seed)
    meals, exercises, stresses, sleeps, faults = [], [], [], [], []

    for d in range(days):
        b = d * 1440
        for t0, c in ((480, 55), (770, 80), (1140, 65)):
            carbs = float(rng.uniform(c * 0.6, c * 1.5))
            meals.append(Meal(b + int(rng.integers(t0 - 45, t0 + 45)), round(carbs)))
        if rng.random() < 0.75:
            exercises.append(Exercise(
                b + int(rng.integers(960, 1180)),
                int(rng.integers(25, 55)),
                float(rng.uniform(0.35, 0.9))))
        if rng.random() < 0.45:
            stresses.append(Stress(
                b + int(rng.integers(540, 1080)),
                int(rng.integers(120, 300)),
                int(rng.integers(2, 6))))
        s_start = b + int(rng.integers(1350, 1415))
        dur = int(rng.uniform(6.5, 8.5) * 60)
        sleeps.append(Sleep(s_start, s_start + dur, float(rng.uniform(0.5, 1.0))))

    if rng.random() < fault_prob:
        n = int(rng.integers(3, 7)) if heavy_faults else int(rng.integers(2, 5))
        kinds = ["cgm_drift", "cgm_dropout", "pump_occlusion", "pump_leakage"]
        for _ in range(n):
            k = str(rng.choice(kinds))
            st = int(rng.integers(360, days * 1440 - 420))
            dur = int(rng.integers(40, 240)) if k == "pump_occlusion" else int(rng.integers(30, 180))
            faults.append(Fault(k, st, st + dur, float(rng.uniform(0.5, 1.5))))

    return Scenario(seed, days,
                    sorted(faults, key=lambda x: x.start_min),
                    sorted(meals, key=lambda x: x.t),
                    sorted(exercises, key=lambda x: x.t),
                    sorted(stresses, key=lambda x: x.t),
                    sleeps)


class Patient:
    def __init__(self, sc: Scenario):
        rng = np.random.default_rng(sc.seed + 7919)
        self.sc = sc
        self.Gb = float(rng.normal(95, 4))
        self.basal_rate = float(rng.normal(1.1, 0.15))
        self.sens = float(rng.normal(42, 10))    # true sensitivity (controller assumes 42)
        self.icr = float(rng.normal(20, 5))     # true carb ratio (controller assumes 20)
        self.G = self.Gb + float(rng.normal(0, 8))
        self.I = 0.0
        self.X = 0.0
        self.gut = 0.0
        self.t = 0
        self.hr = 70.0
        self.last_bolus_t = -1000
        self.last_sleep_q = 0.8
        self.gap_min = int(rng.integers(90, 180))   # impatient: re-boluses early

    def _fault(self, kind: str) -> Optional[Fault]:
        for f in self.sc.faults:
            if f.kind == kind and f.start_min <= self.t < f.end_min:
                return f
        return None

    def _step_min(self):
        t = self.t
        sc = self.sc

        stress = 0
        for s in sc.stresses:
            if s.t <= t < s.t + s.duration_min:
                stress = s.level
        ex_i = 0.0
        for e in sc.exercises:
            if e.t <= t < e.t + e.duration_min:
                ex_i = e.intensity
        asleep = False
        for sl in sc.sleeps:
            if sl.start_min <= t < sl.end_min:
                asleep = True
            if sl.end_min == t:
                self.last_sleep_q = sl.quality

        commanded = self.basal_rate if self.G >= 80 else self.basal_rate * 0.5
        occl = self._fault("pump_occlusion")
        leak = self._fault("pump_leakage")
        delivered = 0.0 if occl else commanded * (0.2 if leak else 1.0)
        pump_status = "occlusion" if occl else ("leakage" if leak else "ok")

        if not asleep and self.G > 170 and t - self.last_bolus_t >= self.gap_min:
            bolus = min((self.G - 110.0) / 42.0, 5.0)
            real = 0.0 if occl else bolus * (0.2 if leak else 1.0)
            self.I += real
            self.last_bolus_t = t

        for m in sc.meals:
            if m.t == t:
                self.gut += m.carbs_g * CARB_GAIN
                bolus = m.carbs_g / 20.0
                real = 0.0 if occl else bolus * (0.2 if leak else 1.0)
                self.I += real

        D = K_GUT * self.gut
        Gb_eff = self.Gb * (1 + 0.03 * stress)
        ex_util = ex_i * 0.45 * self.G / 100.0
        dawn = 0.0
        mod = t % 1440
        if 240 <= mod < 480 and not asleep:
            dawn = 0.06 * (1.25 - self.last_sleep_q)

        u_dev = (delivered - self.basal_rate) / 60.0
        self.G = max(20.0, self.G + (-P1 * (self.G - Gb_eff) - self.X * self.G + D - ex_util + dawn))
        self.I += (u_dev - N_INS * self.I)
        self.X = max(-0.03, self.X + (P3 * self.I - P2 * self.X))
        self.gut = max(0.0, self.gut - D)

        self.hr = 70 + 75 * ex_i + 6 * stress + float(np.random.normal(0, 2))
        if asleep:
            self.hr = min(self.hr, 65)
        self.t += 1

    def step(self) -> dict:
        for _ in range(5):
            self._step_min()

        t = self.t
        rng = np.random.default_rng((self.sc.seed, t))

        drift = self._fault("cgm_drift")
        drop = self._fault("cgm_dropout")
        cgm_quality, cgm = "ok", None
        if drop is not None:
            cgm_quality, cgm = "dropout", None
        elif drift is not None:
            off = (t - drift.start_min) * 0.5 * drift.intensity
            cgm_quality = "drift"
            cgm = round(self.G + off + float(rng.normal(0, 2.0)), 1)
        else:
            cgm = round(self.G + float(rng.normal(0, 2.5)), 1)

        hr = round(self.hr)
        activity = "none"
        if hr >= 125:
            activity = "intense"
        elif hr >= 100:
            activity = "moderate"
        elif hr >= 85:
            activity = "light"

        commanded = self.basal_rate if self.G >= 80 else self.basal_rate * 0.5
        occl = self._fault("pump_occlusion")
        leak = self._fault("pump_leakage")
        delivered = 0.0 if occl else commanded * (0.2 if leak else 1.0)
        pump_status = "occlusion" if occl else ("leakage" if leak else "ok")

        q = np.random.default_rng(self.sc.seed * 3 + t)
        carbs3h = sum(m.carbs_g for m in self.sc.meals if t - 180 < m.t <= t)
        carbs3h = round(carbs3h * float(q.uniform(0.85, 1.15)) / 5) * 5

        ex2h = sum(max(0, min(e.t + e.duration_min, t) - max(e.t, t - 120))
                   for e in self.sc.exercises)
        ex2h = round(ex2h * float(q.uniform(0.8, 1.2)))

        sleep_h = 7.0
        for sl in self.sc.sleeps:
            if sl.end_min <= t:
                sleep_h = round((sl.end_min - sl.start_min) / 30) / 2
        if t < 720:
            sleep_h = round(float(q.uniform(6, 8.5)) * 2) / 2

        stress_now = 1
        for s in self.sc.stresses:
            if s.t <= t < s.t + s.duration_min:
                stress_now = s.level

        iob = round(max(0.0, self.I + self.basal_rate / (N_INS * 60.0)), 2)

        return {
            "t": t, "minute_of_day": t % 1440,
            "cgm_glucose": cgm, "cgm_quality": cgm_quality,
            "hr": hr, "activity": activity,
            "commanded_basal": round(commanded, 2),
            "delivered_basal": round(delivered, 2),
            "iob": iob, "pump_status": pump_status,
            "carbs_g_3h": carbs3h, "exercise_min_2h": ex2h,
            "sleep_hours_last": sleep_h, "stress_1_5": stress_now,
            "true_glucose": round(self.G, 1),
        }


def run_scenario(sc: Scenario) -> list[dict]:
    p = Patient(sc)
    rows = []
    while p.t < sc.days * 1440:
        rows.append(p.step())

    for i, r in enumerate(rows):
        for name, k in (("f_g_t5", 1), ("f_g_t15", 3), ("f_g_t30", 6),
                        ("f_g_t45", 9), ("f_g_t60", 12)):
            r[name] = rows[i + k]["true_glucose"] if i + k < len(rows) else None
        for b in range(6):
            t0 = i + b * 48
            span = [rows[j]["true_glucose"] for j in range(t0, min(t0 + 48, len(rows)))]
            full = len(span) == 48
            r[f"b{b}_min"] = min(span) if full else None
            r[f"b{b}_max"] = max(span) if full else None
        fut = [rows[j]["true_glucose"] for j in range(i, min(i + 12, len(rows)))]
        r["action_label"] = expert_label(r, fut)
        r["scenario_id"] = sc.seed
    return rows


def expert_label(row: dict, fut60: list) -> str:
    """Expert policy: what the pump SHOULD do, given the true future."""
    if row["pump_status"] != "ok" or row["cgm_quality"] != "ok":
        return "alarm_only"
    fmin = min(fut60)
    if fmin < 70:
        return "suspend"
    if fmin < 82:
        return "reduce_basal"
    g, fut_end = row["true_glucose"], fut60[-1]
    if g > 215 and fut_end > g - 10:
        return "correction_bolus"
    return "no_op"
