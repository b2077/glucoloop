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
