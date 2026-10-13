/**
 * The strongest evidence must outrank the rest, or depth is impossible.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * A proposal reaches evaluator-grade depth by citing the RIGHT evidence: the
 * two hospital projects, not the eco-park and the museum. Every downstream
 * quality dimension — evidence specificity, comparable-project relevance,
 * expert-to-role mapping, the competitive thesis — is capped by what the
 * ranking layer surfaces. A writer handed irrelevant evidence cannot recover,
 * however good the prompt is.
 *
 * Measured against a real 114-project portfolio and a real healthcare tender,
 * capabilityScore put the four healthcare projects at ranks 1-4 of 114, with
 * the two hospitals first and second. This file keeps that property from
 * regressing, using synthetic records so it pins the BEHAVIOUR rather than one
 * client's portfolio.
 *
 * The scores are deliberately not asserted at fixed values — that would pin an
 * implementation's arithmetic and break on any legitimate re-tuning. What is
 * asserted is the ordering property that actually matters: sector-matched
 * evidence ranks above unrelated evidence, and unrelated evidence does not
 * reach the auto-selection band on lexical coincidence alone.
 *
 * NOTE ON SCOPE: this covers relevance only. Whether a record may be USED is a
 * separate, stricter question owned by the provenance gate
 * (matching-eligibility.ts → canUseVaultRecord): a record that is not durably
 * reviewed or source-verified scores zero in buildMatches regardless of how
 * relevant it is. That fail-closed rule is deliberate and is not weakened here.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { capabilityScore, detectDominantFamily } from "../lib/engine/matching";

const HEALTHCARE_TENDER = [
  "Architectural Consultancy Services for a Specialty Medical Center",
  "Relevant healthcare project experience. Proven experience in designing healthcare facilities.",
  "Conceptual and detailed architectural design aligned with healthcare standards,",
  "functional space planning, patient flow, infection prevention and control.",
  "Coordinate mechanical, electrical, plumbing, medical gas, IT and telehealth systems.",
].join(" ");

const HEALTHCARE_RECORDS = [
  "G+6 General Hospital design and construction supervision, inpatient wards, operating theatres, laboratory and imaging departments.",
  "Specialized Referral Hospital upgrade — outpatient department, emergency unit, medical gas reticulation and infection control zoning.",
];

const UNRELATED_RECORDS = [
  "Eco-Park master planning and feasibility study, landscape design and visitor circulation over 1,300 hectares.",
  "Museum renovation works, exhibition hall refurbishment and heritage facade conservation.",
  "Five-star hotel construction, guest rooms, banquet halls and back-of-house services.",
];

describe("a healthcare tender ranks healthcare evidence above unrelated evidence", () => {
  it("recognises the tender's dominant capability family", () => {
    assert.equal(detectDominantFamily(HEALTHCARE_TENDER), "HEALTHCARE_FACILITIES");
  });

  it("scores every healthcare record above every unrelated record", () => {
    const health = HEALTHCARE_RECORDS.map((t) => capabilityScore(HEALTHCARE_TENDER, t, "project"));
    const other = UNRELATED_RECORDS.map((t) => capabilityScore(HEALTHCARE_TENDER, t, "project"));
    const worstHealth = Math.min(...health);
    const bestOther = Math.max(...other);
    assert.ok(
      worstHealth > bestOther,
      `weakest healthcare record (${worstHealth.toFixed(4)}) must outrank the strongest unrelated one (${bestOther.toFixed(4)})`,
    );
  });

  it("gives healthcare records a substantive score, not a marginal one", () => {
    // Ranking first is not enough: the score has to be high enough to clear
    // selection, or the package ships with no comparable experience at all.
    for (const text of HEALTHCARE_RECORDS) {
      const score = capabilityScore(HEALTHCARE_TENDER, text, "project");
      assert.ok(score >= 0.5, `healthcare evidence scored only ${score.toFixed(4)}`);
    }
  });

  it("does not let unrelated evidence reach the auto-selection band on lexical coincidence", () => {
    // 0.75 is SELECTION_THRESHOLD in matching.ts. An eco-park must never be
    // auto-selected as comparable experience for a hospital.
    for (const text of UNRELATED_RECORDS) {
      const score = capabilityScore(HEALTHCARE_TENDER, text, "project");
      assert.ok(score < 0.75, `unrelated evidence scored ${score.toFixed(4)} and would auto-select`);
    }
  });

  it("ranks a matching specialist above an unrelated one for the same tender", () => {
    const architect = capabilityScore(
      HEALTHCARE_TENDER,
      "Senior Architect and Urban Planner. Healthcare facility design, hospital space planning, building permits.",
      "expert",
    );
    const unrelated = capabilityScore(
      HEALTHCARE_TENDER,
      "Senior Hydrologist. Borehole siting, aquifer testing and rural water supply schemes.",
      "expert",
    );
    assert.ok(architect > unrelated, `architect ${architect.toFixed(4)} must outrank hydrologist ${unrelated.toFixed(4)}`);
  });
});
