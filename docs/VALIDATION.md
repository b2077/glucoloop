# Eighteen-model validation — 2026-11-21

All five forecast horizons, twelve envelope models and the action classifier
were trained and loaded by the prediction service. The current input files
contain twelve training and four evaluation scenarios, each two days long.
Scenario identifiers do not overlap, and the 25 input features exclude future
glucose labels and action labels.

## Training speed

The final run used 6,709 training rows and 2,213 evaluation rows. It excluded
59 training and 43 evaluation windows with no usable glucose reading, after the
initial history warmup, matching the live service's rejection of those windows.
Training and evaluation took about 1.4 seconds. Every regression model finished
its configured 80 point-forecast or 60 envelope iterations; the classifier
finished 80 iterations. The thread logs confirmed two threads per numerical
library in each of four worker processes.

Before the causal-feature correction, an independent `/usr/bin/time -p` repeat
measured 2.43 seconds including interpreter startup and 1.4 seconds inside the
training function. Inspection of the eighteen saved models found 1,360 actual
trees and 82,922 nodes. These are small histogram-based tree ensembles on a
small tabular dataset. Their node count is not comparable to neural-network
parameter counts as a measure of training cost. The original multi-minute
runs were contending over excessive threads, rather than completing additional
training iterations.

## Prediction latency

`python benchmark.py` from `services/ml` starts a separate standard-library HTTP
service and loads all saved models. With five warmup requests followed by 100
sequential requests, the measured median was 7.70 ms, the 95th percentile was
10.94 ms, and the maximum was 17.15 ms. There were zero failed requests. Cold
startup, including model loading, took 901 ms. See `LATENCY.json` for the machine,
Python version, workload and configurable local target.

These measurements cover local HTTP serialization and prediction. They exclude
simultaneous clients, backend chat tools, the mobile device and network transit.
The benchmark checks complete horizons, six envelope windows and finite output.
It does not check the medical validity of a prediction.

## Tests and limitations

Nine Python regression tests cover independent model selection, the final
24-hour block, missing model files, shared-scenario rejection, worker thread
limits, causal history, scenario isolation and matching feature construction.
The existing 33 backend tests passed using mock services and isolated memory.
Neither suite calls paid APIs. The offline coverage gate has a 40.52% initial
baseline across all owned ML Python modules; feature-building coverage is
92.86%. The real-worker test runs separately because the coverage gate blocks
subprocess creation. The separately executed training and HTTP benchmark are
also outside that coverage measurement. This remains limited automated coverage,
especially for server error paths and orchestration.

Action accuracy is 90.2%, but the training labels contain only three classes.
The model cannot predict suspension or correction boluses. Envelope absolute
error does not establish quantile calibration. Simulator target windows also
start at the current sample, offset five minutes from strictly future intervals.
The simulator is not clinical validation. Open work is recorded in
`../DEFERRED_WORK.md`; these limitations should accompany any demonstration.
