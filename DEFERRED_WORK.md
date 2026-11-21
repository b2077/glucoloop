# Open work

- 2026-11-21: Source: requested pull request on `feat/parallel-fast-training`.
  Publish the prepared changes to `b2077/glucoloop` and open the pull request.
  Status: blocked by the central GitHub owner policy rejecting `b2077`; the
  connected GitHub app returned 404 and GitHub CLI has no active login.
- 2026-11-21: Source: training restart and held-out evaluation. Investigate
  missing suspension and correction-bolus classes in the saved classifier
  despite 91.9% overall accuracy. Status: open; inspect training-label
  coverage and per-class performance
  before relying on the simulated action policy.
- 2026-11-21: Source: leakage review of simulator labels. Envelope blocks use
  the current sample through 235 minutes rather than strictly future 5–240
  minute windows; action labels similarly end at 55 minutes and shorten near
  scenario end. Status: open; define exact label boundaries and regenerate
  datasets before making strict future-horizon claims.
- 2026-11-21: Source: evaluation review. Envelope absolute error does not verify
  quantile calibration. Status: open; measure per-block tail coverage before
  presenting the envelopes as calibrated risk estimates.
- 2026-11-21: Source: simulator review. Heart-rate noise uses an unseeded random
  generator, so a scenario seed does not fully reproduce generated rows.
  Status: open; seed this noise when revisiting dataset generation.
