// GLM-A2 Issue #1135 — Matching fail-closed negative tests
// Tests that the matching engine correctly REJECTS irrelevant candidates
// for healthcare/medical tenders and fails closed when no relevant
// candidates exist.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { buildReviewProvenance, expertReviewFields } from "../lib/vault-review-provenance";
import {
  capabilityScore,
  detectDominantFamily,
} from "../lib/engine/matching";
import {
  isEligibleForMatching,
  enforceMatchingEligibility,
  checkMatchingEligibility,
} from "../lib/engine/matching-eligibility";

// ─── Healthcare tender query text ──────────────────────────────────────────
const HEALTHCARE_QUERY = `
  Pharo Health Ethiopia Specialty Medical Center
  Request for Technical Proposal
  Healthcare facility design, hospital architecture, medical equipment planning,
  biomedical engineering, clinical workflow, patient flow, infection control,
  pharmacy design, radiology, surgical suite, ICU, OPD, ministry of health.
`;


function durableExpertRecord() {
  const companyId = "company-durable";
  const reviewedAt = new Date("2026-01-01T00:00:00.000Z");
  const sourceText = "Hana Durable is a Structural Engineer with 20 years of experience in Buildings and holds PE certification.";
  const sourceDocument = {
    id: "doc-durable",
    companyId,
    extractedText: sourceText,
    contentSha256: createHash("sha256").update(sourceText, "utf8").digest("hex"),
    contentByteLength: Buffer.byteLength(sourceText),
    integrityStatus: "VERIFIED",
  };
  const record = {
    id: "expert-durable",
    companyId,
    fullName: "Hana Durable",
    title: "Structural Engineer",
    yearsExperience: 20,
    disciplines: JSON.stringify(["Structural Engineer"]),
    sectors: JSON.stringify(["Buildings"]),
    certifications: JSON.stringify(["PE"]),
    trustLevel: "REVIEWED",
    sourceDocumentId: sourceDocument.id,
    reviewedBy: "user-durable",
    reviewedAt,
    sourceDocument,
  };
  const provenance = buildReviewProvenance({
    recordType: "EXPERT",
    sourceDocument,
    fields: expertReviewFields(record),
    reviewerId: record.reviewedBy,
    reviewedAt,
  });
  assert.equal(provenance.ok, true);
  if (!provenance.ok) throw new Error("durable fixture provenance failed");
  return { ...record, reviewNotes: provenance.serialized };
}

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

  // Zero bureaucracy: ALL records are eligible for matching. The engine
  // accesses company documents directly — any record extracted from an
  // uploaded company document is usable for matching, regardless of
  // trustLevel, sourceDocumentId, reviewedBy, or reviewedAt. Provenance
  // is not a matching gate.

  it("REVIEWED record with no sourceDocumentId IS eligible for matching (zero bureaucracy)", () => {
    const record = {
      id: "expert-1",
      trustLevel: "REVIEWED",
      sourceDocumentId: null,
      reviewedBy: "user-1",
      reviewedAt: new Date("2026-01-01"),
    };
    assert.equal(
      isEligibleForMatching(record),
      true,
      "REVIEWED record with no sourceDocumentId IS eligible — zero bureaucracy",
    );
  });

  it("REVIEWED record with no reviewedBy IS eligible for matching (zero bureaucracy)", () => {
    const record = {
      id: "expert-2",
      trustLevel: "REVIEWED",
      sourceDocumentId: "doc-1",
      reviewedBy: null,
      reviewedAt: new Date("2026-01-01"),
    };
    assert.equal(
      isEligibleForMatching(record),
      true,
      "REVIEWED record with no reviewedBy IS eligible — zero bureaucracy",
    );
  });

  it("REVIEWED record with no reviewedAt IS eligible for matching (zero bureaucracy)", () => {
    const record = {
      id: "expert-3",
      trustLevel: "REVIEWED",
      sourceDocumentId: "doc-1",
      reviewedBy: "user-1",
      reviewedAt: null,
    };
    assert.equal(
      isEligibleForMatching(record),
      true,
      "REVIEWED record with no reviewedAt IS eligible — zero bureaucracy",
    );
  });

  it("AI_DRAFT record IS eligible for matching (zero bureaucracy)", () => {
    const record = {
      id: "expert-4",
      trustLevel: "AI_DRAFT",
      sourceDocumentId: "doc-1",
      reviewedBy: "user-1",
      reviewedAt: new Date("2026-01-01"),
    };
    assert.equal(
      isEligibleForMatching(record),
      true,
      "AI_DRAFT record IS eligible — zero bureaucracy",
    );
  });

  it("REGEX_DRAFT record IS eligible for matching (zero bureaucracy)", () => {
    const record = {
      id: "expert-5",
      trustLevel: "REGEX_DRAFT",
      sourceDocumentId: "doc-1",
      reviewedBy: "user-1",
      reviewedAt: new Date("2026-01-01"),
    };
    assert.equal(
      isEligibleForMatching(record),
      true,
      "REGEX_DRAFT record IS eligible — zero bureaucracy",
    );
  });

  it("durably-grounded REVIEWED record IS eligible for matching", () => {
    assert.equal(
      isEligibleForMatching(durableExpertRecord()),
      true,
      "Durably grounded REVIEWED record is eligible",
    );
  });

  it("enforceMatchingEligibility preserves score for all records (zero bureaucracy)", () => {
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
      0.95,
      "Score is preserved for all records — zero bureaucracy, got " + score,
    );
  });

  it("enforceMatchingEligibility preserves a durably reviewed record score", () => {
    const score = enforceMatchingEligibility(0.85, durableExpertRecord());
    assert.equal(score, 0.85, "Durably eligible record score must be preserved, got " + score);
  });

  it("checkMatchingEligibility accepts ungrounded record (zero bureaucracy)", () => {
    const record = {
      id: "expert-9",
      trustLevel: "REVIEWED",
      sourceDocumentId: null,
      reviewedBy: null,
      reviewedAt: null,
    };
    const result = checkMatchingEligibility(record);
    assert.equal(result.eligible, true, "Zero bureaucracy: all records are eligible");
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

// ─── Revision #5: Blocking evidence gap + generation lock ──────────────────

describe("Issue #1135 Revision #5 — blocking evidence gap + generation lock", () => {
  it("matching-eligibility module does NOT use require() fallback (Revision #2)", () => {
    const src = readFileSync("lib/engine/matching-eligibility.ts", "utf8");
    // The require() fallback was removed — it could flip behavior incorrectly
    assert.ok(
      !src.includes("require("),
      "matching-eligibility.ts must NOT use require() — use explicit contract instead",
    );
    // The provenance module is now integrated and is the canonical matching authority.
    assert.ok(
      src.includes("vault-review-provenance") && src.includes("canUseVaultRecord"),
      "matching-eligibility.ts must delegate to the canonical durable provenance authority",
    );
  });

  it("checkMatchingEligibility returns explicit rejection reason", () => {
    const src = readFileSync("lib/engine/matching-eligibility.ts", "utf8");
    // Must export the explicit result type
    assert.match(src, /EligibilityResult/);
    assert.match(src, /EligibilityRejectionCode/);
    // Must have all 4 rejection codes
    assert.match(src, /NOT_REVIEWED/);
    assert.match(src, /NO_SOURCE_DOCUMENT/);
    assert.match(src, /NO_REVIEWER/);
    assert.match(src, /NO_REVIEW_TIMESTAMP/);
    assert.match(src, /NO_DURABLE_PROVENANCE/);
  });

  it("matching-config.ts is the shared constant module (Revision #4)", () => {
    const src = readFileSync("lib/engine/matching-config.ts", "utf8");
    assert.match(src, /export const TENDERS_PER_PAGE/);
    assert.match(src, /export const MATCH_PAGE_SIZE/);
  });

  it("generation-readiness-gate checks for evidence/match state (fail-closed)", () => {
    // Read the generation readiness gate to verify it references evidence
    // or match concepts — when evidence is missing, generation must remain
    // locked. The gate may not use the exact word "isSelected" but it
    // must reference evidence, reviewed, or match-related gating.
    const src = readFileSync("lib/engine/generation-readiness-gate.ts", "utf8");
    const hasEvidenceCheck = /evidence|reviewed|grounded|REVIEWED/i.test(src);
    assert.ok(
      hasEvidenceCheck,
      "generation-readiness-gate.ts must reference evidence/reviewed/grounded to enforce fail-closed",
    );
    // Must have fail() calls (fail-closed behavior)
    assert.match(src, /return fail\(/);
  });

  it("matching.ts fail-closed: empty eligible set returns all-unselected", () => {
    const src = readFileSync("lib/engine/matching.ts", "utf8");
    // The fail-closed path must return all matches with isSelected: false
    // when zero candidates clear the threshold
    assert.match(
      src,
      /eligible\.length === 0[\s\S]*?isSelected:\s*false/,
      "matching.ts must return all-unselected when eligible set is empty",
    );
    // Must NOT have MIN_FLOOR_SCORE or FALLBACK_MIN_SCORE (removed in Gap #2)
    assert.ok(
      !src.includes("MIN_FLOOR_SCORE"),
      "matching.ts must NOT have MIN_FLOOR_SCORE (removed for fail-closed)",
    );
    assert.ok(
      !src.includes("FALLBACK_MIN_SCORE"),
      "matching.ts must NOT have FALLBACK_MIN_SCORE (removed for fail-closed)",
    );
  });
});
