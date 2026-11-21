# Physiological context: data assessment and demo scope

Assessed 2026-11-21 from published papers and provider documentation. No patient
records were downloaded, no access agreements were accepted, and no models were
trained. This is a source assessment, not a quality audit of the underlying rows.
T1D below means type 1 diabetes.

## What we can support now

The current system learns from a locally generated Bergman-style simulator,
not an NHS patient database. Its 25 features include recent glucose, insulin
information, activity, recent carbohydrates, sleep duration and reported stress.
They do not include menstrual phase, menopausal status, hormone measurements or
hormone therapy. Point forecasts stop at 60 minutes; the six four-hour envelope
blocks do not constitute a five-hour point forecast or a spare-insulin forecast.

For a serious demonstration, physiological context should be a measurable
extension, not a collection of assumed offsets. A plausible future model would
start with population relationships conditional on relevant characteristics,
then update predictions using the person's own history. The actuarial analogy
is credibility: a limited personal record initially borrows more information
from comparable people, while a longer record can justify greater personal
weight. The weights and uncertainty would need validation. They must not be
invented or presented as implemented in the existing tree models.

## Which factors are actually represented?

| Factor | Useful recorded evidence | Important gap |
|---|---|---|
| Menstrual cycle | T1DEXI has reported menstrual onset; mcPHASES has hormone-informed phase labels | Calendar phase and measured hormones are different inputs; irregular cycles make fixed assumptions unreliable |
| Menopause | ZOE PREDICT records reported stage and hormone-therapy use; a Dutch T1D survey records perceived changes | Neither is a ready-made longitudinal T1D glucose forecasting benchmark across the transition |
| Hormones | mcPHASES has daily home urine assays; DAME studies hormone therapy | Urinary metabolites are not blood hormone concentrations; therapy exposure is not interchangeable with natural variation |
| Sleep | T1DEXI has reported sleep/wake times; Manchester and mcPHASES include wearable sleep | Recorded duration, estimated stages and perceived sleep quality are different measurements |
| Exercise | T1DEXI includes activity duration/intensity; Manchester has wearable activity | Meal and insulin timing can explain part of an apparent exercise association |
| Lifestyle | Meal logs, nutrients, stress reports and contextual histories appear in several sources | Missing reports do not establish absence; broad categories or postcode are not individual exposure measurements |

## Data sources and their limits

**T1DEXI is the strongest immediate T1D context lead.** The overall study contains
497 participants monitored for about four weeks; the meal-response paper uses
a 397-person subset. It documents meals, insulin, exercise, sleep/wake times,
stress, illness and reported menstrual onset. However, no hormone assays were
available. The authors derived cycle length from onset dates and sometimes
used a 28-day assumption, so those derived phases must not be described as
measured endocrine states. A live forecaster must use only onset dates known
at that time; retrospective phase assignments that depend on the next period
cannot be copied into prediction inputs without leaking future information.
Access is controlled through Vivli and requires
confirmation of the applicable proposal and data-use conditions before work
starts. [Primary analysis and variable table](https://pmc.ncbi.nlm.nih.gov/articles/PMC11883769/).

**Manchester T1D-UOM offers longitudinal wearable context.** The publication
describes roughly three months for 17 participants, while the repository's
demographic overview lists 16. Different streams have different availability,
so the usable intersection needs auditing. Glucose, insulin, nutrients,
activity and sleep are relevant to our feature path. Its `stress_level_value`
comes from the Garmin-derived stream; it is not equivalent to a psychological
stress diary. Glucose is recorded in mmol/L, and basal entries can use either
units or units/hour, depending on treatment. Those differences require explicit
conversion and treatment-aware interpretation. The public repository declares
Creative Commons Attribution 4.0. [Paper](https://www.nature.com/articles/s41597-025-05695-1),
[author repository](https://github.com/sharpic/ManchesterCSCoordinatedDiabetesStudy).

**mcPHASES is unusually rich for hormones and symptoms, but excludes diabetes.**
Forty-two participants consented to release of an initial three-month interval;
20 returned for another interval. The first includes Dexcom glucose, Fitbit
signals and daily stress/sleep diaries. The release also contains home urinary
luteinizing hormone and metabolites associated with estrogen and progesterone,
not direct blood assays. The second interval omitted glucose
monitoring and made diaries optional. Per-assay overlap and missingness still
need checking. Recent hormonal therapy/contraception was also excluded.
Its PhysioNet page requires a registered account and restricted data-use
agreement, but currently says the files are no longer available. Access must
be resolved before planning implementation. [Dataset](https://physionet.org/content/mcphases/1.0.0/),
[descriptor](https://pmc.ncbi.nlm.nih.gov/articles/PMC13003092/).

The related [2023 glucose/cycle paper](https://doi.org/10.1038/s41746-023-00884-x)
analysed 49 participants from the underlying Toronto collection. The authors
explain that only a subset consented to mcPHASES release. These are not two
independent cohorts to pool without identifying overlap.

**ZOE PREDICT is useful for menopause hypotheses, not direct T1D validation.**
The menopause analysis includes 366 premenopausal, 55 perimenopausal and 206
postmenopausal participants. It combines reported stage and therapy information
with standardized meals and roughly 13 days of glucose monitoring. The
population is not an insulin-treated T1D cohort, and differences between groups
are not equivalent to observing an individual's menopausal transition.
Access requires a research request; availability of this exact subset must be
confirmed. [Primary paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC9669773/),
[TwinsUK access route](https://twinsuk.ac.uk/resources-for-researchers/access-our-data/).

**Other menopause/cycle studies are leads rather than ready training sets.**
The [Dutch T1D menopause survey](https://link.springer.com/article/10.1007/s00125-025-06518-z)
includes 159 respondents aged 45–65 and documents perceived changes; it does
not provide the dense paired glucose and hormone trajectories needed here.
The [DAME trial](https://diabeter.com/en/research/precision-prediction-precision-medicine/projects/dame-trial/)
investigates hormone therapy in insulin-treated peri/postmenopausal participants,
but no released training dataset was verified. The [DCB menstrual-cycle project](https://dcberne.com/en/project/menstrual-cycle-study/)
reports 77 T1D participants, 380 cycles and 10,107 days; data access and measured
hormone availability remain unverified. These studies support questions worth
asking, not numerical corrections to insert into the app.

## Recommended next step and validation boundary

A richer proposed demonstration could show a person's recent glucose and
insulin history alongside a context panel for meals, prior exercise, last
night's sleep and, where voluntarily supplied, cycle or menopausal context.
An experimentally trained population model would provide an initial forecast
and uncertainty, then adapt towards the person's observed history as evidence
accumulates. The display should identify which inputs were actually recorded
and which factors the model has not learned. This is a design proposal, not
an available capability of the current models.

For example, compare an otherwise matched recent meal with and without earlier
exercise, or compare repeated meal responses across observed cycle periods.
Only show numerical differences produced by a fitted, evaluated model. Do not
insert a fixed glucose increment for menopause or a universal cycle-phase
multiplier. Menopausal stage is a slower-changing background characteristic;
it cannot substitute for current insulin, meals and glucose observations.
For absent hormonal or menopausal evidence, display the gap rather than a
precise-looking adjustment. A plausible average curve is not a validated
population forecast until it has been checked against independent people.

Keep two proposed demo modes distinct: a clearly labelled simulation scenario
explorer, and a future real-data forecast whose accuracy has been measured.
Neither should pretend that a synthetic stress or hormone effect has been
validated in people. Prioritize access and schema assessment of T1DEXI and
Manchester for T1D context; investigate mcPHASES separately for hormonal research
once access is resolved. Do not pool nondiabetic and insulin-treated populations
as though their glucose response were exchangeable.

Before modelling, count usable paired episodes, preserve units and timestamps,
and distinguish missing data from zero exposure. Account for insulin and other
medication changes, illness, meals and activity before attributing changes to
stress or hormones. Test on held-out people and later periods, keeping entire
meal/activity episodes together. Compare a basic glucose/insulin model with
context-enriched versions and retain additions only when errors and uncertainty
improve on independent data. Such prediction tests still do not establish
causal treatment effects or justify insulin-delivery recommendations.
