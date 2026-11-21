# Review notes: forecast integration and intended product scope

## Source of training data and the Bergman comparison

The teammate's `feat/ella-agents-api` document `docs/eng1_data_flow.md` describes
the existing pipeline: the Bergman-style simulator produces labelled records,
and the ML forecaster learns from those records. These are complementary stages,
not two independently implemented forecasters. The executable simulator code on
that branch matches this branch; its `physiology.py` difference is documentation.
No merging or averaging of separate predictions is currently needed.

This branch restores five independently trained forecast horizons, twelve
envelope models spanning six four-hour blocks, and the existing action
classifier. All train on locally simulated data, not NHS patient records.

A future comparison with a directly deployed Bergman forecaster would require
estimating patient state and parameters from the available observations, then
using explicit assumptions about future meals and exercise. Both forecasters
must receive the same information. Giving the simulator its exact hidden
glucose, insulin and gut states or pre-generated future event schedule would
give it an unfair advantage. Separate patient/scenario evaluation, forecast
errors at each horizon, envelope coverage and runtime should be measured before
choosing or combining predictors. Current simulation-only validation cannot
establish performance on real patients.

## Important clarification: spare insulin planning is the intended feature

The user clarified that the desired action is to plan whether to carry a spare
insulin vial or pen before leaving home for roughly five hours. This concerns
available supplies. It does not require recommending a change in insulin
delivery. In particular, `suspend`, `reduce_basal` and `correction_bolus` belong
to a treatment-action policy and do not answer the spare-supply question.

The current classifier is inherited prototype functionality. It has training
examples for only three of its intended five classes and cannot recommend
suspension or correction boluses. It predicts categories, not dose quantities or
durations. Current code still exposes these action categories in the forecast,
chat and mobile interface; this PR does not implement their replacement.

A supply-planning feature needs the usable insulin remaining in the current
container, expected time away, estimated consumption and uncertainty, and
whether a usable spare is available. Current payloads contain delivery rates
and insulin already delivered and still acting, but no remaining stock or
spare inventory. The latter information cannot be inferred from glucose alone.
Any starting amount for a spare must be recorded explicitly, not assumed.

The proposed next step is a separate, agreed change to replace user-facing
treatment recommendations with supply-planning information. Its estimates
should use actual usage records or the existing prescribed delivery schedule,
not calculate a new treatment dose. Exact inputs, uncertainty handling and alert
wording remain to be designed. No claim of completed supply forecasting is made.

## Why suspension is separate, and what the research supports

Suspension means temporarily interrupting insulin delivery. It is a treatment
control, not a prediction that supplies are running low. For example, Medtronic
documents a pump feature that suspends delivery in response to a low-glucose
threshold. This illustrates a legitimate device-specific clinical function; it
does not validate our project's simulator thresholds or learned classifier.
[Manufacturer explanation](https://origin.medtronicdiabetes.com/customer-support/minimed-630G-system-faqs).

Our recommendation is therefore about product scope: suspension is not needed
to implement spare-vial/pen planning. It is not a recommendation to disable a
real pump's existing safety features. Reducing background delivery and giving a
correction bolus also change treatment, so removing only the `suspend` class
would leave the same mismatch with the user's intended supply-planning task.
The current prototype does not establish appropriate dose amounts, suspension
durations or when delivery should resume, and approval in the demo does not
operate a physical pump.

Backup supplies address more than expected reservoir depletion: equipment can
fail unexpectedly. Cambridge University Hospitals NHS guidance includes carrying
emergency insulin for pump failure. Consequently, a five-hour consumption
estimate must not imply that someone can safely leave their usual backup
supplies behind. That conclusion is a product-design implication of the
guidance, not a validated output of this prototype.
[NHS pump handbook](https://www.cuh.nhs.uk/patient-information/tandem-tslim-x2-insulin-pump-handbook/).

For the proposed feature, a shortage or uncertain stock reading should prompt
checking supplies and following the person's established backup plan. The
absence of an alert must not mean that backup insulin is unnecessary. The app
needs explicit, current stock records and a way to distinguish unknown quantity
from sufficient quantity. Alert wording and clinical boundaries require review
before any externally relied-upon use. These are proposed requirements; the
inventory inputs and supply forecast are not implemented in this PR.

Research checked on 2026-11-21. The sources above explain real pump functions
and backup preparation; they are not sources of this project's training data.

## Integration validation boundary

The integration check starts isolated ML and backend services, streams actual
simulator messages for more than three simulated hours, verifies all forecast
horizons and six envelope blocks, and exercises a conversational check-in with
mock chat. It also checks device-quality propagation and rejection of a window
with no usable glucose readings. Results are recorded in `INTEGRATION.json`.

This establishes that the tested server-side components exchange compatible
messages and invoke the saved models. It does not test the mobile interface,
the live Mistral API, real pumps or clinical correctness. The mock chat's use of
the current action field is an integration observation, not endorsement of the
action recommendation. Model and simulator limitations remain in
`../DEFERRED_WORK.md` and `VALIDATION.md`.
