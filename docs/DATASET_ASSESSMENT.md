# Real-data shortlist for glucose and contextual forecasting

Documentation assessment, 2026-11-21. The research was limited to ten minutes.
Primary dataset papers, author repositories and actual access pages were checked.
No patient records were downloaded, access applications submitted or model fits
run. Cohort sizes below describe published studies, not verified usable releases.
Our current models still use synthetic Bergman-style simulation, not NHS data.

The follow-up [physiological-context assessment](PHYSIOLOGY_DATA_ASSESSMENT.md)
extends this shortlist to menstrual cycles, menopause, measured hormones, sleep,
exercise and a proposed richer demonstration.

## Recommendation

For **reported psychological stress**, investigate T1DEXI first, conditional on
access to its dictionary and enough timestamped stress observations. For
**open, richly contextual type 1 diabetes data**, inspect Manchester T1D-UOM,
but treat its wearable stress score as a physiological proxy, not a stress diary.
For a straightforward **open real-world forecasting benchmark**, consider AZT1D.
OhioT1DM remains a useful established benchmark; its stress coverage is a major
concern. CGMacros is attractive for food composition but has no type 1 cohort.
These rankings are judgments about documented fit, not measured model results.

## Dataset comparison

| Dataset | Published population and span | Context and stress evidence | Assessment and access |
|---|---|---|---|
| OhioT1DM | 12 people with type 1 diabetes; about eight weeks; glucose every five minutes | Insulin, carbohydrate estimates, exercise, sleep, wearables and reported stress-event times. No documented 1–5 stress severity scale. | Good benchmark; weak stress-event coverage is a warning. Access by institutional research request. |
| T1DEXI | 497 adults analysed; four-week exercise study | Insulin, glucose, activity sensors and food records. Official access metadata explicitly lists self-reported stress levels. | Best candidate to investigate for reported stress; secure/requested access. Verify the released package and event counts first. |
| Manchester T1D-UOM | Paper: 17 participants, about twelve weeks; repository says 16. Multiple glucose devices. | Basal/bolus insulin, nutrients, activity, sleep and a Garmin-derived stress field | Strong open contextual candidate. Device stress is not psychological ground truth. Repository licence: Creative Commons Attribution 4.0. |
| DiaTrend | 54 adults with type 1 diabetes; 27,561 glucose-days and 8,220 pump-days | Glucose, bolus insulin and carbohydrate announcements; basal available for only 17 participants. No explicit stress/activity/sleep release fields documented. | Stronger for larger forecasting validation than stress effects. Controlled Synapse access and research conditions. |
| AZT1D | 25 adults using automated insulin delivery; description says six–eight weeks | Five-minute glucose, carbohydrates and detailed insulin records; sleep/exercise pump modes, without documented psychological stress labels | Open insulin/meal forecasting candidate, Creative Commons Attribution 4.0. Operating mode is not measured activity or sleep. |
| D1NAMO | Nine people with type 1 diabetes and 20 healthy participants | Glucose, insulin, food photographs, electrocardiogram, breathing and movement; no explicit stress labels in the documented modality list | Lower priority for this stress question. Public author archive; exact licence, duration and glucose cadence were not verified within this review. |
| CGMacros | 45 adults: 15 healthy, 16 prediabetes, 14 type 2 diabetes; ten days | Detailed meal nutrients/photos, glucose and activity; no documented psychological-stress annotations | Best food-composition example, but not a direct replacement for type 1 pump-user data. Open, noncommercial/share-alike licence. |

## Evidence and dataset-specific caveats

**OhioT1DM.** The authors' paper documents stress-event timestamps rather than
graded severity. A separate primary analysis reports only **five stress events
across its six-person 2018 cohort**. This does not establish the count for the
entire twelve-person release, but it is a concrete reason not to select Ohio
for stress solely because its schema contains a stress field. The current
access page requires an institutional request; older pages describe a data-use
agreement. Confirm the applicable route rather than assuming anonymous access.
[Dataset paper](https://webpages.charlotte.edu/rbunescu/data/ohiot1dm/bglp/OhioT1DM-dataset-paper.pdf),
[stress-coverage analysis, Appendix C](https://jmlr.org/papers/volume26/23-0660/23-0660.pdf),
[access](https://webpages.charlotte.edu/rbunescu/data/ohiot1dm/OhioT1DM-dataset.html).

**T1DEXI.** The official host explicitly lists self-reported stress and meal
timing/composition, making it more relevant than its exercise-focused title
suggests. However, the host describes data aggregated around exercise events.
Verify that the shared package contains continuous histories sufficient for
our forecast windows. Stress scale, collection frequency, missingness and use
conditions remain unverified; this is a promising candidate, not a confirmed
ready-to-train stress dataset. The exercise assignment does not constitute a
randomised stress experiment.
[Study paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC10090894/),
[official access and field description](https://search.vivli.org/doiLanding/studies/PR00008428/isLanding).

**Manchester.** The paper's stress field sits in the Garmin-derived sleep and
physiology stream. Garmin describes its stress measurement as estimated from
heart-rate variability, meaning variation in intervals between heartbeats.
It is not interchangeable with our user's reported stress scale. Paper and
repository participant counts differ, and insulin records are missing for
several participants. Glucose uses mmol/L, unlike our mg/dL. Basal records can
represent long-acting injection quantities or pump rates; these must not be
summed as though the units were identical. Uniform glucose cadence and the
latest archive version require inspection.
[Paper](https://www.nature.com/articles/s41597-025-05695-1),
[author repository](https://github.com/sharpic/ManchesterCSCoordinatedDiabetesStudy),
[licence](https://github.com/sharpic/ManchesterCSCoordinatedDiabetesStudy/blob/main/LICENSE.md),
[device stress definition](https://www8.garmin.com/manuals/webhelp/forerunner45/EN-US/GUID-20E035CE-CA52-40D0-B202-13403D6FAA51.html).

**DiaTrend.** Glucose history is much longer than aligned pump history, and
basal information is incomplete. Meal announcements are not a complete food
diary. Its size does not compensate for absent stress labels. Synapse access
involves account verification/certification and use conditions; the paper's
open licence should not be mistaken for the dataset's terms.
[Paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC10447420/),
[authors' access instructions](https://github.com/Augmented-Health-Lab/DiaTrend/blob/main/README.md),
[data host](https://www.synapse.org/Synapse:syn38187184).

**AZT1D.** Basal/mode information was extracted from device reports; hourly
basal values are repeated across five-minute rows. The description says six–eight
weeks, while duration figures in the paper are inconsistent and need a file
audit. Missing carbohydrate/bolus entries being represented as zero deserves
review: no record is not necessarily proof of no intake or delivery.
[Paper](https://arxiv.org/html/2506.14789v1),
[data and licence](https://data.mendeley.com/datasets/gk9m674wcx/1).

**D1NAMO.** The author archive documents useful physiological modalities, but
physiological sensors alone do not label psychological stress or its effect on
glucose. The archive was indexed but direct retrieval timed out during this
review; exact licence and timing claims are deliberately unresolved.
[Author archive, version 1.2](https://zenodo.org/records/5651217),
[original paper](https://doi.org/10.1016/j.imu.2018.09.003).

**CGMacros.** This is a useful answer to the food-composition question because
carbohydrate, protein, fat and fibre quantities accompany meals. Its population
does not include type 1 diabetes. One-minute output rows do not mean new glucose
measurements every minute: the original Dexcom and Libre sensors sample every
five and fifteen minutes respectively. The host specifies Creative Commons
Attribution-NonCommercial-ShareAlike 4.0, which limits suitability for unrestricted
product reuse.
[Dataset, methods and licence](https://physionet.org/content/cgmacros/1.0.0/).

## What must be established before modelling

The next step is a small, permitted data-quality audit, not immediate pooling.
Count usable stress events per person and their alignment with glucose, insulin,
meals and exercise. Separate missing reports from explicit no-stress observations.
Check whether reports were available at prediction time, rather than only being
recorded retrospectively. Device stress, psychological stress and physical
activity should remain distinct inputs.

Convert units explicitly, reconcile timestamps and gaps, and document insulin
delivery methods. Compare a common-input glucose model with an otherwise matched
model adding context, using held-out people and later periods. Only claim useful
stress information if it improves independent predictions; even that would not
prove stress caused the observed glucose change. Do not pool unlike populations
or invent missing features to satisfy our existing 25-feature interface.

None of these documented schemas establishes our five-category correct-treatment
labels or the remaining-stock/spare-inventory inputs needed for five-hour supply
planning. Real dosing records are observations, not automatically correct-action
labels. The current demonstration remains simulation-based until a suitable
source is accessed, audited, adapted and evaluated.
