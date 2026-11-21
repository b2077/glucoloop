# Open work

- 2026-11-21: Source: user clarification of the intended action feature.
  Design a five-hour spare-vial/pen planning feature using remaining insulin,
  consumption estimates and available spares. Replace user-facing treatment
  recommendations in chat, contracts and mobile UI after agreeing the design.
  Status: proposed, not implemented; no inventory fields currently exist.
  Evaluation contains no true suspension or correction-bolus cases, so the
  inherited classifier is not a validated treatment policy. See
  `docs/PR_REVIEW_NOTES.md`.
- 2026-11-21: Source: chosen OpenAPS Data Commons and Open Humans tools.
  Obtain approved research access, then add a small glucose-summary adapter
  with explicit units, thresholds and missing-gap handling. Status: public
  tools cloned and synthetic arithmetic checked. The separate simulation demo
  now calculates reading percentages, but no patient data has been obtained
  and no real-record parsing or gap handling is integrated. See
  `docs/OPENHUMANS_TOOLS.md`.
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
