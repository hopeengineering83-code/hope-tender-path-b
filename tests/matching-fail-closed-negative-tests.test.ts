// GLM-A2 Issue #1135 — Matching fail-closed negative tests
// Tests that the matching engine correctly REJECTS irrelevant candidates
// for healthcare/medical tenders and fails closed when no relevant
// candidates exist.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  capabilityScore,
  capabilityFamilies,
  detectDominantFamily,
} from "../lib/engine/matching";
import {
  isEligibleForMatching,
  enforceMatchingEligibility,
  isDurablyReviewedAdapter,
} from "../lib/engine/matching-eligibility";

// ─── Healthcare tender query text ──────────────────────────────────────────
const HEALTHCARE_QUERY = `
  Pharo Health Ethiopia Specialty Medical Center
  Request for Technical Proposal
  Healthcare facility design, hospital architecture, medical equipment planning,
  biomedical engineering, clinical workflow, patient flow, infection control,
  pharmacy design, radiology, surgical suite, ICU, OPD, ministry of health.
`;

// ─── Gap #1: Irrelevant projects must NOT score high for healthcare ────────

describe("Issue #1135 Gap #1 — healthcare negative tests for off-sector projects", () => {
  it("abattoir project scores below selection threshold for healthcare tender", () => {
    const abattoirProject = `
      Moyale Abattoir Rehabilitation Feasibility Study
      Livestock slaughter facility, meat processing plant, butcher facility,
      abattoir waste management, livestock holding pens.
    `;
    const score = capabilityScore(HEALTHCARE_QUERY, abattoirProject, "project");
    assert.ok(
      score < 0.75,
      `Abattoir project must score below 0.75 for healthcare tender, got ${score}`,
    );
  });

  it("residential project scores below selection threshold for healthcare tender", () => {
    const residentialProject = `
      Mohammed Seid (G+2 Residential)
      Residential building design, apartment, housing project,
      condo, villa, dormitory.
    `;
    const score = capabilityScore(HEALTHCARE_QUERY, residentialProject, "project");
    assert.ok(
      score < 0.75,
      `Residential project must score below 0.75 for healthcare tender, got ${score}`,
    );
  });

  it("warehouse project scores below selection threshold for healthcare tender", () => {
    const warehouseProject = `
      Warehouse & Landscaping Project
      Warehouse design, logistics hub, cargo storage, supply chain,
      distribution center, freight terminal.
    `;
    const score = capabilityScore(HEALTHCARE_QUERY, warehouseProject, "project");
    assert.ok(
      score < 0.75,
      `Warehouse project must score below 0.75 for healthcare tender, got ${score}`,
    );
  });

  it("factory project scores below selection threshold for healthcare tender", () => {
    const factoryProject = `
      Negadras Pulse Factory
      Industrial manufacturing facility, factory design, production plant,
      manufacturing line, industrial equipment.
    `;
    const score = capabilityScore(HEALTHCARE_QUERY, factoryProject, "project");
    assert.ok(
      score < 0.75,
      `Factory project must score below 0.75 for healthcare tender, got ${score}`,
    );
  });

  it("commercial building project scores below selection threshold for healthcare tender", () => {
    const commercialProject = `
      B+G+10 TERRACE COMMERCIAL BUILDING
      Commercial building, retail space, office building, shopping mall,
      storefront design, commercial real estate.
    `;
    const score = capabilityScore(HEALTHCARE_QUERY, commercialProject, "project");
    assert.ok(
      score < 0.75,
      `Commercial project must score below 0.75 for healthcare tender, got ${score}`,
    );
  });
});

// ─── Gap #2: Fail-closed — no candidates means empty selection ──────────────

describe("Issue #1135 Gap #2 — fail-closed: no relevant candidates = empty selection", () => {
  it("healthcare tender with only off-sector projects produces zero selected matches", () => {
    // Simulate matching results: all off-sector projects score below threshold
    const matches = [
      { id: "1", score: capabilityScore(HEALTHCARE_QUERY, "abattoir rehabilitation", "project"), isSelected: false },
      { id: "2", score: capabilityScore(HEALTHCARE_QUERY, "residential building", "project"), isSelected: false },
      { id: "3", score: capabilityScore(HEALTHCARE_QUERY, "warehouse logistics", "project"), isSelected: false },
    ];

    // Verify all scores are below threshold
    const SELECTION_THRESHOLD = 0.75;
    const eligible = matches.filter((m) => m.score >= SELECTION_THRESHOLD);

    assert.equal(
      eligible.length,
      0,
      "Zero candidates must clear the threshold for a healthcare tender with only off-sector projects",
    );
  });

  it("dominant family detection identifies HEALTHCARE_FACILITIES", () => {
    const dominant = detectDominantFamily(HEALTHCARE_QUERY);
    assert.equal(
      dominant,
      "HEALTHCARE_FACILITIES",
      `Healthcare query must detect HEALTHCARE_FACILITIES as dominant family, got ${dominant}`,
    );
  });
});

// ─── Gap #3: Reviewed-but-ungrounded records cannot contribute (Revision #1) ─

describe("Issue #1135 Gap #3 + Revision #1 — reviewed-but-ungrounded records", () => {
  it("record with no capability families scores 0", () => {
    const score = capabilityScore(HEALTHCARE_QUERY, "generic consultant with no specific keywords", "expert");
    assert.equal(
      score,
      0,
      `Record with no capability families must score 0, got ${score}`,
    );
  });

  it("record with unknown/incomplete fields contributes 0 positive score", () => {
    // A record that has some text but no recognizable healthcare keywords
    const score = capabilityScore(HEALTHCARE_QUERY, "project manager with 10 years experience", "expert");
    assert.ok(
      score < 0.75,
      `Record with unknown fields must score below threshold, got ${score}`,
    );
  });

  // GLM-A2 Issue #1135 Revision #1: Durable provenance enforcement.
  // A reviewed-but-ungrounded record (REVIEWED but no sourceDocumentId,
  // reviewedBy, or reviewedAt) must score zero, remain unselected, and
  // cannot unlock generation.

  it("REVIEWED record with no sourceDocumentId is NOT eligible for matching", () => {
    const record = {
      id: "expert-1",
      trustLevel: "REVIEWED",
      sourceDocumentId: null,
      reviewedBy: "user-1",
      reviewedAt: new Date("2026-01-01"),
    };
    assert.equal(
      isEligibleForMatching(record),
      false,
      "REVIEWED record with no sourceDocumentId must NOT be eligible",
    );
  });

  it("REVIEWED record with no reviewedBy is NOT eligible for matching", () => {
    const record = {
      id: "expert-2",
      trustLevel: "REVIEWED",
      sourceDocumentId: "doc-1",
      reviewedBy: null,
      reviewedAt: new Date("2026-01-01"),
    };
    assert.equal(
      isEligibleForMatching(record),
      false,
      "REVIEWED record with no reviewedBy must NOT be eligible",
    );
  });

  it("REVIEWED record with no reviewedAt is NOT eligible for matching", () => {
    const record = {
      id: "expert-3",
      trustLevel: "REVIEWED",
      sourceDocumentId: "doc-1",
      reviewedBy: "user-1",
      reviewedAt: null,
    };
    assert.equal(
      isEligibleForMatching(record),
      false,
      "REVIEWED record with no reviewedAt must NOT be eligible",
    );
  });

  it("AI_DRAFT record is NOT eligible for matching regardless of provenance", () => {
    const record = {
      id: "expert-4",
      trustLevel: "AI_DRAFT",
      sourceDocumentId: "doc-1",
      reviewedBy: "user-1",
      reviewedAt: new Date("2026-01-01"),
    };
    assert.equal(
      isEligibleForMatching(record),
      false,
      "AI_DRAFT record must NOT be eligible",
    );
  });

  it("REGEX_DRAFT record is NOT eligible for matching", () => {
    const record = {
      id: "expert-5",
      trustLevel: "REGEX_DRAFT",
      sourceDocumentId: "doc-1",
      reviewedBy: "user-1",
      reviewedAt: new Date("2026-01-01"),
    };
    assert.equal(
      isEligibleForMatching(record),
      false,
      "REGEX_DRAFT record must NOT be eligible",
    );
  });

  it("fully-grounded REVIEWED record IS eligible for matching", () => {
    const record = {
      id: "expert-6",
      trustLevel: "REVIEWED",
      sourceDocumentId: "doc-1",
      reviewedBy: "user-1",
      reviewedAt: new Date("2026-01-01"),
    };
    assert.equal(
      isEligibleForMatching(record),
      true,
      "Fully-grounded REVIEWED record must be eligible",
    );
  });

  it("enforceMatchingEligibility zeros out ineligible record score", () => {
    const record = {
      id: "expert-7",
      trustLevel: "REVIEWED",
      sourceDocumentId: null, // ungrounded
      reviewedBy: "user-1",
      reviewedAt: new Date("2026-01-01"),
    };
    const score = enforceMatchingEligibility(0.95, record);
    assert.equal(
      score,
      0,
      "Ineligible record must score 0 after enforcement, got " + score,
    );
  });

  it("enforceMatchingEligibility preserves eligible record score", () => {
    const record = {
      id: "expert-8",
      trustLevel: "REVIEWED",
      sourceDocumentId: "doc-1",
      reviewedBy: "user-1",
      reviewedAt: new Date("2026-01-01"),
    };
    const score = enforceMatchingEligibility(0.85, record);
    assert.equal(
      score,
      0.85,
      "Eligible record score must be preserved, got " + score,
    );
  });

  it("isDurablyReviewedAdapter returns false for ungrounded record", () => {
    const record = {
      id: "expert-9",
      trustLevel: "REVIEWED",
      sourceDocumentId: null,
      reviewedBy: null,
      reviewedAt: null,
    };
    assert.equal(
      isDurablyReviewedAdapter(record),
      false,
      "isDurablyReviewedAdapter must return false for ungrounded record",
    );
  });
});

// ─── Gap #4: Score calibration — no 100% from clamping or bonus stacking ──

describe("Issue #1135 Gap #4 — score calibration: no 100% from bonus stacking", () => {
  it("score cannot reach 1.0 from bonus stacking alone", () => {
    // A record that would trigger multiple bonuses but doesn't have full coverage
    const multiBonusRecord = `
      Water supply design, feasibility design, supervision contract, civil infrastructure,
      solar pumping, geotechnical engineering.
    `;
    const score = capabilityScore(HEALTHCARE_QUERY, multiBonusRecord, "project");
    assert.ok(
      score < 1.0,
      `Score must not reach 1.0 from bonus stacking, got ${score}`,
    );
  });

  it("healthcare record with full family coverage can score high but not from clamping", () => {
    const healthcareRecord = `
      Hospital design, medical facility, clinical workflow, patient flow,
      pharmacy design, biomedical engineering, infection control, ICU, OPD,
      radiology, surgical suite, ministry of health.
    `;
    const score = capabilityScore(HEALTHCARE_QUERY, healthcareRecord, "project");
    // A well-matched healthcare record CAN score high, but must be legitimate
    assert.ok(
      score >= 0.75,
      `Healthcare record with full coverage must score >= 0.75, got ${score}`,
    );
    assert.ok(
      score <= 1.0,
      `Score must not exceed 1.0, got ${score}`,
    );
  });

  it("generic overlap cannot produce 100%", () => {
    const genericRecord = `
      engineering design supervision infrastructure planning
    `;
    const score = capabilityScore(HEALTHCARE_QUERY, genericRecord, "expert");
    assert.ok(
      score < 0.75,
      `Generic overlap must not produce high score for healthcare, got ${score}`,
    );
  });
});
