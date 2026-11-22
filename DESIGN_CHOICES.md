# Design choices

## 2026-11-21: Apply thread limits inside training workers

The training processes imported scikit-learn before setting `OMP_NUM_THREADS`.
The numerical libraries retained sixteen active threads per worker, despite the
requested limit of two. Four simultaneous workers competed for sixteen CPUs.

The process-pool initializer now applies `threadpoolctl` to already loaded
numerical libraries. It checks and prints each library's effective limit before
fitting. `OMP_NUM_THREADS` remains the configurable limit, defaulting to two.
A regression test uses a real worker after scikit-learn has been imported.

## 2026-11-21: Restore eighteen independently trained models

Five models forecast 5, 15, 30, 45 and 60 minutes ahead. Twelve models estimate
the minimum and maximum for six consecutive four-hour blocks. One classifier
predicts the action. Both training and serving consume `services/ml/config.toml`.
Serving requires every model file instead of interpolating omitted horizons or
silently dropping the final block. Numerical libraries are limited after model
loading as well, using the configured prediction thread budget.

## 2026-11-21: Causal history and matching dropout treatment

Training previously backward-filled initial gaps from future time points and
forward-filled dropouts from history older than the window available to serving.
Features now use only twelve historical readings. Filling across columns ordered
newest to oldest uses earlier readings within that row's window. Padding missing
early history then uses the earliest available reading, as serving already does.
Entirely missing windows are excluded because serving rejects them too.

Regression tests compare every feature between the two paths, exercise long
dropouts and leading gaps, and verify that adding future rows cannot change
earlier features. Training explicitly rejects overlapping scenario identifiers.
These controls check chronology and scenario isolation. They do not prove that
the simulator represents independent real patients or establish clinical safety.

## 2026-11-21: Preserve Unicode in backend JSON responses

The cross-service check failed when a mock chat reply contained an em dash.
The backend used JavaScript string length for HTTP `Content-Length`, which counts
characters rather than UTF-8 bytes. Clients therefore read a truncated response
and could not parse its JSON. The response writer now uses `Buffer.byteLength`.
A focused backend test reproduces the old failure and protects Unicode replies.

## 2026-11-21: Resolve main integration without changing local generated data

The merge was prepared in an isolated checkout because main changes generated
datasets and tracks models that were untracked in the feature checkout. Main's
backend server was preserved exactly, and its API tests retain the additional
Unicode regression. Metrics and latency were rerun using the merged code and
committed simulated data; retrained binaries remain local validation outputs.
The integration fixture explicitly selects test mode to skip the environment
loader and disables the unrelated periodic recommendation timer. Forecast,
chat check-in and failure paths pass against main's newer backend.

## Verification and remaining limits

See `docs/VALIDATION.md` for measured training time, latency and test boundaries.
Evaluation lacks true examples of two action classes, and envelope calibration and
precise label boundaries remain open in `DEFERRED_WORK.md`. A hypothetical
policy can pass every structural check while recommending a poor action because
simulation labels or coverage are inadequate; human review remains necessary.

## 2026-11-21: Separate simulation personalisation from trained forecasts

`/demo` is linked from the backend dashboard. `demo-model.js` owns pure curve,
weighted-learning and reading-summary calculations; `demo.js` renders them in
the browser. `server.js` only serves fixed local assets. No demo action calls
ingestion, prediction, chat or treatment endpoints or writes patient history.

`demo-config.json` owns the numerical assumptions. JSON is used instead of TOML
because both Node and the browser read it without an additional parser. The
four event amplitudes and triangular time course are illustrative assumptions,
not literature averages or Bergman model estimates. Hormones and sleep remain
unmodelled. A browser reload clears histories; each event has a separate history.

The learning calculation combines the initial amplitude with completed noisy
synthetic peak observations, weighted by their counts. With initial exercise
change -20 mg/dL, four observations averaging -30 and prior weight four, the
estimate becomes -25. This is a demonstration of credibility weighting, not
evidence of a treatment response. The comparison curve does not enter learning.
Known baselines isolate effects only because these are generated examples.
Real observations require separate work on overlapping influences and withheld
evaluation before using them to estimate personal physiological responses.


## 2026-11-21: Portable demo handover and current main

The demonstrator uses a Mac. `npm run demo` starts a small dedicated launcher
instead of requiring shell-specific environment assignments. The launcher
reads its port from demo configuration, skips environment-file loading and
imports the backend without its normal background timers. It binds locally;
it does not deploy a public service or change the normal backend start command.

The main merge retains its proactive watch and tests. The integration fixture
also disables the new proactive-chat timer so its existing mock-chat assertions
remain isolated from unsolicited messages. This tests the forecast flow, not
the combined background alert timing. Fresh-checkout verification and the
Mac-specific setup boundary are recorded in `docs/VALIDATION.md`.
