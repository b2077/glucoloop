# Eng 1 Work Plan — Devices / Data / Simulator

## Ownership

```
services/simulator/
├── physiology.py        # Bergman minimal model + behavior + fault injection
├── live_stream.py       # Real-time device streamer → backend /ingest
├── generate_dataset.py  # Training/eval dataset generation
└── requirements.txt     # numpy, pandas
```

---

## Core responsibilities

| Area | What Eng 1 does |
|---|---|
| **Physiology model** | Implements the Bergman minimal model at 1-min resolution (5-min sampled rows). Models glucose dynamics via insulin state `I`, remote insulin effect `X`, gut absorption, meals, exercise, stress, sleep, and dawn phenomenon. |
| **Device simulation** | Simulates CGM (glucose + quality), pump (commanded/delivered basal, IOB, status), and watch (heart rate + activity). |
| **Fault injection** | Four fault types: `cgm_drift`, `cgm_dropout`, `pump_occlusion`, `pump_leakage` — with configurable start/end/intensity. Demo faults hardcoded at t=600 (drift), t=1500 (occlusion), t=2100 (dropout). |
| **Live streaming** | `live_stream.py` POSTs simulated device payloads to the backend `/ingest` endpoint at an accelerated rate (`--accel 60` = 60 sim-min per real second). Payload shape matches what real CGM bridges (Dexcom API, HealthKit) would send. |
| **Dataset generation** | `generate_dataset.py` runs N random scenarios (train: normal faults, eval: heavy faults) and writes `train.csv` / `eval.csv` with labels for the ML models — future glucose at t+5/15/30/45/60, 24h block min/max, and the expert `action_label` (5-class pump policy). |

---

## Key design details

- **Expert labeling**: Labels come from a policy that "saw the healthy future" — at inference the ML only sees real-time features, but training uses ground truth.
- **Naive controller**: The simulated patient uses fixed assumed parameters (icr=20, sens=42) while true parameters vary ±25%, deliberately generating hypo/hyper excursions the ML learns to prevent.
- **IOB** is deviation-from-basal equilibrium (not absolute insulin on board).
- **Demo fault plan** (hardcoded in `live_stream.py`):
  - `t=600..720` — CGM drift → "do you trust your sensor?"
  - `t=1500..1620` — pump occlusion → insulin deficit, agent alarms
  - `t=2100..2160` — CGM dropout → agent cross-validates via chat

---

## Validation checklist (Eng 1)

- [ ] Stream 3+ hours (`--accel 3600`), then `/forecast/demo-001` returns all three horizons (with Eng 3)
- [ ] Fault beats: drift → `alarm_only`; occlusion → `alarm_only` + IOB collapse visible in `/state`

---

## Quickstart commands

```bash
# Live stream (accelerated demo)
python live_stream.py --backend http://127.0.0.1:8100 --patient demo-001 --accel 60

# Generate training/eval dataset
python generate_dataset.py --n-train 24 --n-eval 6 --days 3
```

---

## Future hooks (if time remains)

1. Wire real **Dexcom CGM sandbox API** into `live_stream.py`'s place — payload shape already matches.
2. Real **HealthKit** integration for watch data (heart rate, activity).
3. These swap in without changing the backend contract — the simulator already POSTs exactly what bridges would send.

---

## Source references

| Detail | Where documented |
|---|---|
| Ownership & validation targets | `README.md` → "Repo map / who owns what" |
| Full component breakdown | `docs/WORK_PLAN.md` → "Component ownership in this repo" |
| Demo fault beats | `docs/DEMO_SCRIPT.md` → "Beat 4 — Fault intelligence" |
| Physiology & fault implementation | `services/simulator/physiology.py` |
| Live streaming & demo fault plan | `services/simulator/live_stream.py` |
| Dataset generation | `services/simulator/generate_dataset.py` |

---

## Appendix — Bergman physiology model

Implemented in `services/simulator/physiology.py`. 1-minute internal resolution, sampled to 5-minute rows.

### Minimal implementation (core two equations)

```python
# Per 1-minute step:
G += -P1*(G - Gb_eff) - X*G + D - ex_util + dawn    # glucose
X += P3*I - P2*X                                    # remote insulin action
```

Insulin `I` updates separately: `I += u_dev - N_INS*I`. Meals, exercise, dawn, and stress feed into the `G` line via `D`, `ex_util`, `dawn`, and `Gb_eff`.

### State variables

| Variable | Meaning |
|---|---|
| `G` | Plasma glucose (mg/dL), clamped ≥ 20 |
| `I` | Plasma insulin deviation from basal equilibrium (U) — negative = deficit |
| `X` | Remote insulin effect (insulin action on glucose disposal), clamped ≥ −0.03 |
| `gut` | Glucose potential in the gut from recent meals (mg/dL equivalent) |
| `Gb` | Basal (target) glucose, perturbed +3% per stress level |
| `hr` | Heart rate (bpm), derived from exercise / stress / sleep |

### Model constants

| Constant | Value | Role |
|---|---|---|
| `CARB_GAIN` | 2.3 | mg/dL glucose potential per gram of carbs |
| `K_GUT` | 0.014 | Gut → blood glucose transfer rate |
| `N_INS` | 0.030 | Insulin decay rate |
| `P1` | 0.010 | Glucose "self-disposal" (insulin-independent) |
| `P2` | 0.025 | Remote insulin effect decay |
| `P3` | 4.2e-4 | Remote insulin effect gain from plasma insulin |

### Per-minute step equations

```
D      = K_GUT * gut                                  # glucose influx from gut
Gb_eff = Gb * (1 + 0.03 * stress)                     # stress raises target
D_ex   = exercise_intensity * 0.45 * G / 100          # exercise glucose utilization
dawn   = 0.06 * (1.25 - sleep_quality)  (04:00–08:00, if awake)

G     += -P1*(G - Gb_eff) - X*G + D - D_ex + dawn    # glucose update
I     += (delivered - basal)/60 - N_INS*I             # insulin update (deviation from basal)
X     += P3*I - P2*X                                  # remote insulin action
gut   -= D                                             # gut depletion
```

### Behavioral inputs (per scenario)

- **Meals**: add `carbs_g * CARB_GAIN` to gut; naive controller boluses `carbs_g / 20` (assumed ICR=20).
- **Exercise**: increases `D_ex` and heart rate (`hr += 75 * intensity`).
- **Stress**: raises `Gb_eff` (+3% per level) and heart rate (`+6 * level`).
- **Sleep**: caps heart rate ≤ 65; dawn phenomenon suppressed while asleep; sleep quality feeds the dawn factor after waking.
- **Dawn phenomenon**: `+0.06 * (1.25 - sleep_quality)` per minute between 04:00–08:00 when awake.

### Naive controller (the simulated patient)

- Basal: `basal_rate` if G ≥ 80, else `basal_rate * 0.5`.
- Correction bolus: if G > 170 and ≥ `gap_min` (90–180 min) since last bolus, delivers `min((G - 110) / 42, 5.0)` U — assumes sensitivity = 42 mg/dL/U.
- True patient parameters (`sens`, `icr`) vary ±25% around those assumed values, so the controller's mistakes produce the hypo/hyper excursions the ML policy learns to correct.

### Device faults (injected on top of the model)

| Fault | Effect |
|---|---|
| `cgm_drift` | CGM reading diverges linearly from true glucose: `offset = (t - start) * 0.5 * intensity` |
| `cgm_dropout` | CGM returns `None` (no reading) |
| `pump_occlusion` | Delivered basal and bolus = 0 while commanded stays flat |
| `pump_leakage` | Delivered basal and bolus reduced to 20% of commanded |

### Expert label (ground truth for ML training)

```python
def expert_label(row, fut60):  # fut60 = true glucose for next 60 min
    if pump_status != "ok" or cgm_quality != "ok": return "alarm_only"
    if min(fut60) < 70:  return "suspend"
    if min(fut60) < 82:  return "reduce_basal"
    if G > 215 and fut60[-1] > G - 10: return "correction_bolus"
    return "no_op"
```

---

## Appendix B — Bergman minimal model: literature research

### Origin

- **Bergman RN, Ider YZ, Bowden CR, Cobelli C (1979)** — *"Quantitative estimation of insulin sensitivity"*, Am J Physiol 236(6):E667–E677.
- Developed from frequently-sampled IVGTT (FSIVGTT) data in conscious dogs to estimate insulin sensitivity without a euglycemic clamp.
- History reviewed in *Frontiers in Endocrinology* (2020): doi:10.3389/fendo.2020.583016.

### Canonical equations (classic 3-parameter form)

```
dG/dt = −(p1 + X(t)) · (G(t) − Gb) + u_G(t)      G(0) = G0
dX/dt = −p2 · X(t) + p3 · (I(t) − Ib)             X(0) = 0
```

| Symbol | Meaning |
|---|---|
| `G(t)` | Plasma glucose (mg/dL) |
| `I(t)` | Plasma insulin — measured input, not modeled in the classic form |
| `X(t)` | "Remote" (interstitial) insulin-action compartment |
| `Gb`, `Ib` | Basal glucose / insulin concentrations |
| `p1` | Glucose effectiveness **Sg** — insulin-independent disposal |
| `p2` | Decay rate of remote insulin action |
| `p3` | Gain of remote action per unit plasma insulin |

**Key indices:** `SI = p3 / p2` (insulin sensitivity, min⁻¹ per μU/mL) · `Sg = p1` (glucose effectiveness) · `DI = SI × AIR` (disposition index).

### FSIVGTT protocol

Overnight fast → IV glucose bolus 300 mg/kg at t=0 → optional tolbutamide/insulin bolus at t=20 min (modified FSIVGTT) → ~30 blood samples over 180 min → parameters fitted via MINMOD weighted least squares.

### Validation

- **1981**: Bergman et al. showed minimal-model SI is equivalent to euglycemic-hyperinsulinemic clamp SI in nondiabetic humans.
- Became the standard epidemiological tool for insulin sensitivity/resistance (less technically demanding than the clamp).

### Known limitations

- Single glucose compartment — no portal vs peripheral insulin split, no first-pass hepatic extraction.
- No explicit hepatic glucose production or endogenous insulin secretion (insulin is an external input).
- No meal/gut absorption — designed for IV glucose only.
- Identifiability problems in insulin-resistant subjects without the t=20 min bolus.
- These gaps motivated later extensions: Cobelli's full glucose-insulin minimal model → **UVA/Padova T1D simulator** (Dalla Man et al., 2014), which is FDA-accepted.

### GlucoLoop implementation vs canonical model

| Canonical | GlucoLoop `physiology.py` | Notes |
|---|---|---|
| `−(p1+X)·(G−Gb)` | `−P1·(G−Gb_eff) − X·G + D − ex + dawn` | Adds gut influx `D`, exercise utilization, dawn phenomenon; `Gb_eff` stress-perturbed |
| `X' = −p2·X + p3·(I−Ib)` | `X += P3·I − P2·X` | `I` is deviation-from-basal, so the `Ib` term is folded into `I` |
| Insulin = measured input | `I += u_dev − N_INS·I` | Adds an insulin decay compartment (`N_INS`) |
| IVGTT only | Meals via gut (`K_GUT`), exercise, stress, sleep, dawn | Extended for closed-loop pump scenarios |
| Typical `p1≈0.028, p2≈0.025` | `P1=0.010, P2=0.025, P3=4.2e-4` | Same order of magnitude |

GlucoLoop keeps the Bergman core (`P1`/`P2`/`P3`, remote `X`) but extends it into a full scenario model with meals, behavior, and device faults — the same direction the field took toward UVA/Padova.

---

## Appendix C — Limitations of the simple model

### Physiological simplifications

| Limitation | Consequence |
|---|---|
| **Single glucose compartment** | No distinction between portal (liver) and peripheral insulin — misses first-pass hepatic extraction, so hepatic insulin action is wrong |
| **No hepatic glucose production (HGP)** | Liver's basal glucose output and its suppression by insulin aren't modeled explicitly — only lumped into `Gb` |
| **No endogenous insulin secretion** | Insulin `I` is an input, not a modeled pancreatic response — no beta-cell dynamics, no cephalic phase |
| **Gut is a single linear pool** | `K_GUT * gut` assumes exponential carb absorption — real meals have biphasic, fat/protein-dependent absorption |
| **Exercise/stress/dawn are additive linear terms** | No interaction effects (e.g., stress blocking insulin action, exercise increasing insulin sensitivity for hours afterward) |

### Structural limitations

- **Fixed time-invariant parameters** — real insulin sensitivity varies with time of day, illness, hormones. GlucoLoop randomizes per-patient but keeps them constant within a scenario.
- **1-minute Euler integration** — fine at these time constants, but no numerical stiffness handling.
- **No counter-regulation** — no glucagon, epinephrine, or cortisol response to hypoglycemia, so severe hypo dynamics are unrealistic (glucose just clamps at 20).

### Practical / demo limitations (already noted in README)

- Trained on simulated physiology — a "learned safe policy," not a clinical instrument.
- In-memory state only; no real device data yet.

### Path forward

The field's answer to these gaps is the **UVA/Padova T1D simulator** (Dalla Man et al., 2014) — multi-compartment, FDA-accepted, with full meal, subcutaneous insulin, and counter-regulatory models. That is the natural next step if GlucoLoop wants clinically credible validation.

---

## Appendix D — Function signatures

### Data types

```python
@dataclass
class Meal:      t: int; carbs_g: float
@dataclass
class Exercise:  t: int; duration_min: int; intensity: float      # 0..1
@dataclass
class Stress:    t: int; duration_min: int; level: int          # 1..5
@dataclass
class Sleep:     start_min: int; end_min: int; quality: float      # 0..1
@dataclass
class Fault:     kind: str; start_min: int; end_min: int; intensity: float = 1.0

@dataclass
class Scenario:
    seed: int; days: int
    faults: list[Fault]; meals: list[Meal]; exercises: list[Exercise]
    stresses: list[Stress]; sleeps: list[Sleep]
    def manifest(self) -> dict: ...
```

### Scenario generation

```python
def random_scenario(seed: int, days: int = 3, fault_prob: float = 0.85,
                    heavy_faults: bool = False) -> Scenario: ...

def run_scenario(sc: Scenario) -> list[dict]: ...

def expert_label(row: dict, fut60: list[float]) -> str: ...
```

### Patient (simulator core)

```python
class Patient:
    def __init__(self, sc: Scenario) -> None: ...
    def step(self) -> dict: ...            # advance 5 min, return sensor row
    def _step_min(self) -> None: ...       # advance 1 min (internal)
    def _fault(self, kind: str) -> Fault | None: ...
```

### Live streaming (`live_stream.py`)

```python
def post(url: str, payload: dict) -> dict: ...   # HTTP POST helper
def main() -> None: ...                           # CLI entry
```

### Dataset generation (`generate_dataset.py`)

```python
def build(n_train: int, n_eval: int, days: int, out: Path) -> None: ...
```

### `Patient.step()` return shape (sensor row)

```python
{
    "t": int, "minute_of_day": int,
    "cgm_glucose": float | None, "cgm_quality": str,   # ok | drift | dropout
    "hr": int, "activity": str,                         # none|light|moderate|intense
    "commanded_basal": float, "delivered_basal": float,
    "iob": float, "pump_status": str,                   # ok | occlusion | leakage
    "carbs_g_3h": float, "exercise_min_2h": int,
    "sleep_hours_last": float, "stress_1_5": int,
    "true_glucose": float,                              # ground truth (training only)
}
```

---

## Appendix E — Streamer & dataset generator

### `live_stream.py` — live device streamer

Simulates one patient in accelerated real time and POSTs readings to the backend.

```
python live_stream.py --backend http://127.0.0.1:8100 --patient demo-001 --accel 60
```

| Flag | Default | Meaning |
|---|---|---|
| `--backend` | `http://localhost:8100` | Ingest endpoint base URL |
| `--patient` | `demo-001` | Patient ID sent in payloads |
| `--accel` | `60` | Sim minutes per real second (60 = 1 sim-hour per real minute) |
| `--duration` | `2880` | Total sim minutes to stream (2 days) |
| `--seed` | `4242` | Scenario seed |

- Each iteration steps `Patient` 5 sim-min and POSTs to `{backend}/ingest`:
  `{"patient_id", "type": "cgm", "t", "cgm": {glucose_mgdl, cgm_quality, hr, activity}, "pump": {iob_units, commanded_basal_u_hr, delivered_basal_u_hr, pump_status}}`
- Payload shape matches what real CGM bridges (Dexcom API, HealthKit) would send — swap-in point for real devices.
- **Demo fault plan** (merged with any random `pump_leakage` faults): CGM drift t=600–720, pump occlusion t=1500–1620, CGM dropout t=2100–2160. Fault rows are annotated `<-- drift/occlusion` in stdout.
- Sleep interval = `5 / accel` real seconds between POSTs; backend unreachable → logs and continues.

### `generate_dataset.py` — training/eval dataset generator

Runs random scenarios through the simulator and writes labeled CSVs for Eng 3's ML.

```
python generate_dataset.py --n-train 24 --n-eval 6 --days 3 --out ../../data/generated
```

| Flag | Default | Meaning |
|---|---|---|
| `--n-train` | `24` | Training scenarios (seeds 1..N, normal fault injection) |
| `--n-eval` | `6` | Eval scenarios (seeds 900.., heavy fault injection) |
| `--days` | `3` | Sim days per scenario |
| `--out` | `../../data/generated` | Output directory |

- Writes `train.csv`, `eval.csv`, `manifest_train.json`, `manifest_eval.json`.
- Each row = one 5-min step from `run_scenario()`, including future targets (`f_g_t5..t60`), 24 h envelope blocks (`b0..b5_min/max`), `action_label` (5-class expert policy), and `scenario_id`.
- Prints per-split stats: row count, % in-range (70–180 mg/dL), glucose min/mean/max, action distribution.
