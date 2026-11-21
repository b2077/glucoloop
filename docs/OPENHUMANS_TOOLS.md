# Open Humans tools: reuse assessment

Inspected 2026-11-21: upstream `danamlewis/OpenHumansDataTools`, commit
`07b9352`. Reference clone: `/tmp/glucoloop-openhumans-tools-20261121`.
The clone is temporary and is not a project dependency or patient dataset.

Source: https://github.com/danamlewis/OpenHumansDataTools

## What we can use

`bin/outcomes.sh` contains a small calculator for low, in-range and high glucose
reading proportions, their counts, and average glucose. Its thresholds are
below 70, 70–180 inclusive, and above 180 mg/dL. It returns fractions, although
its output headers describe percentages. The root MIT licence permits reuse
with its copyright and permission notice retained.

The arithmetic expression was executed separately on five synthetic readings
at five-minute intervals: 60, 70, 100, 180 and 200 mg/dL. It returned
`0.2,1,0.6,3,0.2,1,122`: 20% low, 60% in range, 20% high and mean 122 mg/dL.
This verifies the arithmetic and threshold boundaries on that example. No
patient records were downloaded or analysed, and no upstream installation
commands or complete conversion scripts were executed.

These are reading proportions. They approximate time in each range when
observations are equally spaced and coverage is adequate. Missing stretches
must not be counted as observed healthy time. An irregular series needs a
separately specified duration calculation and a maximum gap to carry forward
a reading. Results must state units, thresholds, observation coverage and
whether percentages use readings or elapsed time. Our existing backend uses
72–180 mg/dL, so its summaries are not directly comparable without explaining
the threshold difference.

## Problems to correct before integration

- `bin/outcomes.sh` creates a filtered `entries-looping.csv`, but its final
  calculator reads the unfiltered entries file instead. It therefore does not
  enforce the stated restriction to periods with looping data.
- It assumes a particular participant directory layout and whitespace-separated
  timestamp/glucose representation. It is not a general CSV reader and does
  not explicitly reject empty, missing or nonnumeric inputs.
- The GV-demographics notebook uses bins ending at 350 mg/dL, while preceding
  preprocessing allows readings up to 400. It can omit very high readings from
  the denominator, and its bin boundaries classify 70 as low. It also requires
  additional demographics files and dependencies. Its separate folder licence
  must be retained if any of that code is reused.

For this project, reuse the documented metric definitions and a small corrected
calculator rather than adopting the full historical workflow. Before wiring
it into reports, agree the thresholds and missing-gap rule, then test empty
input, invalid units, duplicate timestamps and irregular sampling. That adapter
has not yet been implemented or connected to the application.

## Data access and interpretation

The tools are public software. They do not include access to the full OpenAPS
Data Commons. That collection requires an approved research request under the
provider's criteria: https://openaps.org/outcomes/data-commons/

The reported 46,070 days and more than ten million glucose readings refer to
a published historical snapshot, not a download completed for this project.
Entries, treatments and device-status files can support glucose and treatment
analysis, but exercise, stress, sleep and hormonal measurements must be checked
in the actual approved records. Their presence cannot be inferred from size.

These summaries describe observed glucose outcomes. They neither estimate the
causal effect of exercise or stress nor validate an insulin adjustment. Pump
responses and meals already affect the observed trajectory. Forecast evaluation
must split people or time periods before learning personal coefficients, and
must not use future device predictions, treatments or event information that
would have been unavailable when making a forecast.

## Mayo Clinic reference and the paper supplied in screenshots

Checked 2026-11-21. The supplied
[Mayo diagnosis and treatment page](https://www.mayoclinic.org/diseases-conditions/diabetes/diagnosis-treatment/drc-20371451)
is clinical guidance, not a downloadable training dataset. Its two-hour
140/199/200 mg/dL discussion concerns a fasting glucose-tolerance test followed
by a sugary drink. The screenshot generalises this to an ordinary meal, which
is not the test described. Do not turn those diagnostic thresholds into labels
for routine sensor readings or targets for people already using insulin.
The page identifies relevant influences but supplies no universal response
coefficient or time course for a forecast.

The related
[Mayo lifestyle guidance](https://www.mayoclinic.org/diseases-conditions/diabetes/in-depth/diabetes-management/art-20047963)
supports the following qualitative context. These are candidate inputs, not
estimated numerical effects:

| Context | Supported interpretation | What our project still needs |
| --- | --- | --- |
| Food | Carbohydrates can raise glucose; composition and quantity matter. | Meal timing, quantity and insulin context. |
| Prolonged stress | Hormonal responses may raise glucose. | A defined stress measure and repeated observations. |
| Periods | Hormonal changes can produce glucose swings. | Dated personal observations across cycles. |
| Menopause | Changes warrant attention to glucose patterns. | Relevant cohort data; no fixed menopause multiplier. |
| Alcohol | Delayed glucose lowering is possible. | Timing, amount, food and medication context. |

For exercise, the
[American Diabetes Association](https://diabetes.org/health-wellness/fitness/exercise-and-type-1)
explains that responses depend on starting glucose, intensity, duration and
insulin. Glucose can fall, but intense activity can also raise it. A demo must
therefore not encode every workout as a fixed percentage decrease. Sleep
remains a candidate input from our broader dataset review, not a calibrated
coefficient established by these pages.

For sensor summaries, the
[CDC's continuous-monitor guidance](https://www.cdc.gov/diabetes/treatment/continuous-glucose-monitors.html)
describes 70–180 mg/dL as a common target range. This is a different use from
diagnosing diabetes. Individual targets can differ; these references do not
justify silently changing the application's existing thresholds.

The screenshot's
[Shahid and Lewis 2022 paper](https://www.mdpi.com/2072-6643/14/9/1906)
analyses the same OpenAPS Data Commons, not a second independent dataset. Its
122-person snapshot contains glucose, treatment and algorithm records. Its
data-availability section links the public GV-demographics scripts we inspected,
not an unrestricted patient-data download. Its methods cover duplicate times,
missing values and device error codes, and report glucose range percentages,
mean and variability. The paper caps some readings at 400 mg/dL; that is a
study-specific cleaning decision, not a rule to copy across devices.

For the demonstration, use these sources to explain selected factors and
measurement definitions. Keep any numerical response curve explicitly labelled
as a simulation assumption until measured records support its size and timing.
Later, evaluate personal adaptation on observations held out from learning.
Neither a plausible chart nor improved historical glucose summaries establish
an appropriate insulin response. This update changes documentation only;
no thresholds, forecasts, dosing behaviour or data access have changed.
