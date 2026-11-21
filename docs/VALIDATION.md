# Eighteen-model validation — 2026-11-21

All five forecast horizons, twelve envelope models and the action classifier
were trained and loaded by the prediction service. The current input files
contain 24 training and six evaluation scenarios, each three days long.
Scenario identifiers do not overlap, and the 25 input features exclude future
glucose labels and action labels.

## Training speed

The final run used 20,318 training rows and 5,041 evaluation rows. It excluded
130 training and 71 evaluation windows with no usable glucose reading, after the
initial history warmup, matching the live service's rejection of those windows.
Training and evaluation took 1.816 seconds. Every regression model finished
its configured 80 point-forecast or 60 envelope iterations; the classifier
stopped after 26 of its maximum 80 iterations through early stopping. The thread
logs confirmed two threads per numerical
library in each of four worker processes.

These are small histogram-based tree ensembles on a modest tabular dataset.
The original multi-minute runs were contending over excessive threads, rather
than completing additional training iterations. Measurements from the earlier,
smaller local dataset do not describe this final run on main's committed data.

## Prediction latency

`python benchmark.py` from `services/ml` starts a separate standard-library HTTP
service and loads all saved models. With five warmup requests followed by 100
sequential requests, the measured median was 6.22 ms, the 95th percentile was
8.32 ms, and the maximum was 11.13 ms. There were zero failed requests. Cold
startup, including model loading, took 919.59 ms. See `LATENCY.json` for the machine,
Python version, workload and configurable local target.

These measurements cover local HTTP serialization and prediction. They exclude
simultaneous clients, backend chat tools, the mobile device and network transit.
The benchmark checks complete horizons, six envelope windows and finite output.
It does not check the medical validity of a prediction.

## Tests and limitations

After merging main, the cross-service integration check passed on 2026-11-21. It ingested all
37 readings over 185 simulated minutes, loaded real saved models through the
backend forecast route, updated a check-in through mock chat, propagated sensor
drift, rejected a fully missing window and returned an error after ML stopped.
The first run exposed truncated Unicode JSON chat replies; a focused test
reproduced the failure and the backend response writer was corrected. The
backend suite now has 72 passing tests. The simulator's standalone runners
passed all 31 tests (21 physiology, six dataset generation and four streaming).
The isolated backend uses test mode to skip environment-file loading and turns
off the periodic recommendation timer; it does not validate that timer's dosing
logic. See `INTEGRATION.json` for results and
`PR_REVIEW_NOTES.md` for the product-scope and teammate-pipeline explanation.

Nine Python regression tests cover independent model selection, the final
24-hour block, missing model files, shared-scenario rejection, worker thread
limits, causal history, scenario isolation and matching feature construction.
The backend tests use mock services and isolated memory.
Neither suite calls paid APIs. The offline coverage gate has a 40.52% initial
baseline across all owned ML Python modules; feature-building coverage is
92.86%. The real-worker test runs separately because the coverage gate blocks
subprocess creation. The separately executed training and HTTP benchmark are
also outside that coverage measurement. This remains limited automated coverage,
especially for server error paths and orchestration.

The one-hour forecast's mean absolute error is 3.9 mg/dL. Action accuracy is
95.4%, and all five action classes occur in training. However, evaluation has no
true suspension or correction-bolus cases, so it cannot establish recall for
those classes: how often the model detects them when they really occur. The
earlier three-class training result came from a smaller local dataset and is
not the current result. Envelope absolute error does not establish quantile
calibration. Simulator target windows also
start at the current sample, offset five minutes from strictly future intervals.
The simulator is not clinical validation. Open work is recorded in
`../DEFERRED_WORK.md`; these limitations should accompany any demonstration.

Main now tracks the generated datasets and eighteen model artifacts. This PR
preserves main's incoming datasets and binaries exactly; locally retrained
replacement binaries used for these checks are not committed. Run training
before serving so the models match the causal feature path. No real OpenAPS
records have been acquired, and a new personalization demonstration has not
been implemented.

## Separate simulation personalisation page — 2026-11-21

The backend suite now passes 77 tests, including four pure demo calculation
checks and one HTTP check of the page, module, configuration and dashboard link.
The synthetic 60/70/100/180/200 mg/dL fixture gives 20/60/20 reading percentages
and mean 122. Boundary readings and readings above 350 are retained.

A real headless Chrome check loaded `/demo`, added four completed exercise
observations, verified adaptation from -20 to -25 mg/dL, switched to an empty
stress history, returned to exercise and reset it. Desktop and mobile screenshots
were inspected. These checks use only locally generated examples and no paid
APIs or patient histories. They prove the demonstration executes and controls
work; they do not validate physiological amplitudes, causal effects or dosing.
The page is independent of the eighteen trained models. See `DEMO_SCRIPT.md`.
