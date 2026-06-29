/**
 * Regression tests locking in the fixes for the 5 dashboard contradictions.
 *
 * Each contradiction showed the same field/metric in conflicting states across
 * panels. Every test here is written so it FAILS if the corresponding fix is
 * reverted — that is the whole point: green CI must mean the contradictions are
 * actually resolved, not merely that unrelated tests pass.
 *
 * These exercise only pure, exported helpers so they run in the standard
 * `npm test` flow without a live database.
 *
 *   C1. Evidence coverage 0% vs grounding 100%
 *   C2. Deadline shown as candidate but reported as missing
 *   C3. Client/tender title marked both "sourced" and "needs source"
 *   C4. Analysis score 40/100 inconsistent with high sub-scores
 *   C5. Docs 0/2 vs planned documents
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { __testing__ } from "../lib/engine/final-submission-readiness";
import { resolveCanonicalFieldState } from "../lib/engine/canonical-field-state";
import { assessTenderAnalysisQuality } from "../lib/analysis-quality";

const { mandatoryEvidenceCoverageRatio, selectPlanReconciliationDocuments } = __testing__;

// A fully-populated, valid tender. Individual tests override only what they need
// so unrelated critical fields never accidentally drive the assertion.
function baseTender(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    title: "Water Supply Rehabilitation",
    clientName: "ABC Authority",
    procuringEntityName: null,
    legalClientName: null,
    donorAgency: null,
    implementingAgency: null,
    reference: "REF-001",
    country: "Kenya",
    currency: "USD",
    deadline: new Date("2026-12-31"),
    submissionMethod: "Email",
    submissionAddress: null,
    submissionEmails: "bids@abc.example",
    submissionEmailSubject: null,
    clientContactName: null,
    clientContactEmail: null,
    clientContactTitle: null,
    clientContactPhone: null,
    clientCity: null,
    clientAddress: null,
    clientWebsite: null,
    clientRepresentative: null,
    preBidChannel: null,
    preBidMeetingDate: null,
    preBidMeetingLocation: null,
    evaluationMethodology: null,
    metadataContaminated: false,
    // Source evidence (page + quote) for the grounded fields.
    clientNameSourcePage: 1,
    clientNameSourceQuote: "ABC Authority is the procuring entity for this tender.",
    submissionMethodSourcePage: 2,
    submissionMethodSourceQuote: "Bids shall be submitted by email.",
    submissionAddressSourcePage: null,
    submissionAddressSourceQuote: null,
    submissionEmailSourcePage: 2,
    submissionEmailSourceQuote: "bids@abc.example",
    deadlineSourcePage: 3,
    deadlineSourceQuote: "Bids must be received by 31 December 2026.",
    referenceSourcePage: 1,
    referenceSourceQuote: "Reference: REF-001",
    countrySourcePage: 1,
    countrySourceQuote: "Country: Kenya",
    contactDetailsSourceJson: null,
    ...overrides,
  };
}

function fieldState(tender: Record<string, unknown>, overrides: unknown[]) {
  const result = resolveCanonicalFieldState({
    tender,
    overrides,
    hasExtractedRequirements: true,
  } as unknown as Parameters<typeof resolveCanonicalFieldState>[0]);
  return result;
}

// ─── C1 ──────────────────────────────────────────────────────────────────────
describe("C1 — evidence coverage requires BOTH confirmation and grounding", () => {
  it("source grounding WITHOUT compliance-matrix confirmation does not count", () => {
    const ratio = mandatoryEvidenceCoverageRatio([
      { priority: "MANDATORY", sourcePageNumber: 5, sourceExactQuote: "x", complianceMatrixRows: [] },
    ]);
    assert.equal(ratio, 0);
  });

  it("compliance-matrix confirmation WITHOUT grounding does not count (this is the fix)", () => {
    const ratio = mandatoryEvidenceCoverageRatio([
      { priority: "MANDATORY", complianceMatrixRows: [{ supportLevel: "FULL" }] },
    ]);
    assert.equal(ratio, 0);
  });

  it("only requirements with BOTH confirmation and grounding count", () => {
    const ratio = mandatoryEvidenceCoverageRatio([
      { priority: "MANDATORY", complianceMatrixRows: [{ supportLevel: "FULL" }], sourcePageNumber: 5 },
      { priority: "MANDATORY", complianceMatrixRows: [{ supportLevel: "SUBSTANTIAL" }], sourceExactQuote: "q" },
      { priority: "MANDATORY", complianceMatrixRows: [{ supportLevel: "FULL" }] /* no grounding */ },
    ]);
    assert.equal(ratio, 2 / 3);
  });
});

// ─── C2 ──────────────────────────────────────────────────────────────────────
describe("C2 — deadline edited to match extracted value is not a blocking candidate", () => {
  it("USER_EDITED deadline equal to the extracted value is NOT confirmation-required", () => {
    const result = fieldState(baseTender(), [
      { field: "deadline", fieldState: "USER_EDITED", overrideValue: "2026-12-31", reason: null, overriddenBy: null, createdAt: null },
    ]);
    const deadline = result.fields.find((f) => f.fieldKey === "deadline");
    assert.ok(deadline, "deadline field should be present");
    assert.notEqual(
      deadline?.status,
      "MANUAL_OVERRIDE_CONFIRMATION_REQUIRED",
      "deadline matching its extracted value must not be flagged as an unconfirmed candidate",
    );
    assert.equal(deadline?.blockerReason ?? null, null, "a matching deadline must not produce a generation blocker");
  });

  it("USER_EDITED deadline that DIFFERS from the extracted value still requires confirmation", () => {
    const result = fieldState(baseTender(), [
      { field: "deadline", fieldState: "USER_EDITED", overrideValue: "2027-01-15", reason: null, overriddenBy: null, createdAt: null },
    ]);
    const deadline = result.fields.find((f) => f.fieldKey === "deadline");
    assert.equal(
      deadline?.status,
      "MANUAL_OVERRIDE_CONFIRMATION_REQUIRED",
      "a deadline edited away from the source must still be treated as an unconfirmed candidate",
    );
  });
});

// ─── C3 ──────────────────────────────────────────────────────────────────────
describe("C3 — confirmed value matching a grounded source is EXTRACTED_AND_GROUNDED", () => {
  it("USER_CONFIRMED client name matching the grounded extracted value is not 'needs source'", () => {
    const result = fieldState(baseTender(), [
      { field: "clientName", fieldState: "USER_CONFIRMED", overrideValue: "ABC Authority", reason: null, overriddenBy: null, createdAt: null },
    ]);
    const client = result.fields.find((f) => f.fieldKey === "clientName");
    assert.equal(
      client?.status,
      "EXTRACTED_AND_GROUNDED",
      "a confirmed value that matches a grounded source must be EXTRACTED_AND_GROUNDED, not MANUAL_CONFIRMED",
    );
    assert.equal(client?.blockerReason ?? null, null, "a grounded confirmed value must not carry a 'needs source' blocker");
  });

  it("USER_CONFIRMED client name WITHOUT source grounding remains MANUAL_CONFIRMED", () => {
    const result = fieldState(
      baseTender({ clientNameSourcePage: null, clientNameSourceQuote: null }),
      [{ field: "clientName", fieldState: "USER_CONFIRMED", overrideValue: "ABC Authority", reason: null, overriddenBy: null, createdAt: null }],
    );
    const client = result.fields.find((f) => f.fieldKey === "clientName");
    assert.equal(
      client?.status,
      "MANUAL_CONFIRMED",
      "without page+quote evidence a confirmed value cannot claim to be grounded",
    );
  });
});

// ─── C4 ──────────────────────────────────────────────────────────────────────
describe("C4 — when analysis is hard-capped UNSAFE, no sub-score exceeds the overall", () => {
  it("multi-page tender missing its deadline: every sub-score <= capped overall score", () => {
    const report = assessTenderAnalysisQuality({
      requirements: [
        { title: "Req 1", priority: "MANDATORY", sourcePageNumber: 2 },
        { title: "Req 2", priority: "MANDATORY", sourcePageNumber: 3 },
        { title: "Req 3", priority: "MANDATORY", sourcePageNumber: 4 },
      ],
      clientName: "ABC Authority",
      extractedTextLength: 12000,
      totalPageCount: 10,
      deadline: null, // missing critical metadata on a multi-page tender → hard cap
      submissionMethod: "Email",
    });

    assert.equal(report.severity, "UNSAFE", "missing deadline on a multi-page tender must be UNSAFE");
    assert.ok(report.score <= 40, `overall score should be hard-capped (got ${report.score})`);
    for (const [axis, value] of Object.entries(report.subScores)) {
      assert.ok(
        value <= report.score,
        `sub-score ${axis}=${value} must not exceed the capped overall ${report.score}`,
      );
    }
  });

  it("zero source grounding forces the grounding sub-score to 0", () => {
    const report = assessTenderAnalysisQuality({
      requirements: [{ title: "Req 1", priority: "MANDATORY" }], // no page/quote anywhere
      clientName: "ABC Authority",
      extractedTextLength: 8000,
      deadline: new Date("2026-12-31"),
      submissionMethod: "Email",
    });
    assert.equal(report.subScores.sourceGrounding, 0);
  });
});

// ─── C5 ──────────────────────────────────────────────────────────────────────
describe("C5 — PLANNED documents count as present, not missing, for plan reconciliation", () => {
  const docs = [
    { name: "Technical Proposal", exactFileName: "technical.docx", generationStatus: "PLANNED", reviewStatus: null, validationStatus: null, format: "DOCX", documentType: "TECHNICAL" },
    { name: "Financial Proposal", exactFileName: "financial.docx", generationStatus: "GENERATED", reviewStatus: "APPROVED", validationStatus: "VALIDATED", format: "DOCX", documentType: "FINANCIAL" },
    { name: "Old draft", exactFileName: "old.docx", generationStatus: "SUPERSEDED", reviewStatus: null, validationStatus: null, format: "DOCX", documentType: "TECHNICAL" },
  ];

  it("includes PLANNED docs (the fix) and excludes SUPERSEDED docs", () => {
    const selected = selectPlanReconciliationDocuments(docs as never);
    const names = selected.map((d) => d.exactFileName).sort();
    assert.deepEqual(names, ["financial.docx", "technical.docx"]);
  });

  it("a purely PLANNED document is still counted as present", () => {
    const selected = selectPlanReconciliationDocuments([
      { name: "Planned only", exactFileName: "planned.docx", generationStatus: "PLANNED", reviewStatus: null, validationStatus: null, format: "DOCX", documentType: "TECHNICAL" },
    ] as never);
    assert.equal(selected.length, 1, "a PLANNED document must not be dropped from the reconciliation set");
  });

  it("SUPERSEDED documents are never counted", () => {
    const selected = selectPlanReconciliationDocuments([
      { name: "Gone", exactFileName: "gone.docx", generationStatus: "SUPERSEDED", reviewStatus: null, validationStatus: null, format: "DOCX", documentType: "TECHNICAL" },
    ] as never);
    assert.equal(selected.length, 0);
  });
});
