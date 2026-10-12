import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Regression pin for the live-tender defect:
//
//   Requirement "Submission in a Single PDF Technical File"
//   → supported by "Expert CVs.pdf.txt"
//
// A CV source file cannot demonstrate that the submission is a single PDF. The
// requirement matched no evidence-kind branch, fell through to the GENERAL
// fallback, and GENERAL is a wildcard the selector admits every candidate for,
// so the highest-scoring unrelated file won — at FULL support.
//
// The rule that the tender REQUIRES this is still proven from the tender source
// (sourceExactQuote / page / section — untouched). What changes is the proof
// that the submission SATISFIES it: that comes from the artifact and the final
// package.

import {
  inferAutomaticEvidenceKinds,
  selectAutomaticEvidenceForRequirement,
  type AutomaticEvidenceCandidate,
} from "../lib/engine/automatic-requirement-coverage";
import { isPackagingOrFormatRequirement } from "../lib/engine/packaging-requirement-rule";

function requirement(overrides: Record<string, unknown> = {}) {
  return {
    id: "req-1",
    title: "Submission in a Single PDF Technical File",
    description: "",
    requirementType: "SUBMISSION",
    priority: "MANDATORY",
    restrictions: null,
    exactFileName: null,
    requiredQuantity: 1,
    ...overrides,
  } as never;
}

function candidate(overrides: Partial<AutomaticEvidenceCandidate> = {}): AutomaticEvidenceCandidate {
  return {
    recordType: "COMPANY_DOCUMENT",
    recordId: "c1",
    label: "Expert CVs.pdf.txt",
    searchableText: "Expert CVs.pdf.txt curriculum vitae technical staff single pdf file submission",
    evidenceKinds: ["EXPERT_CV", "GENERAL"],
    evidenceKey: "company:c1",
    sourceDocumentId: "c1",
    sourceContentHash: "a".repeat(64),
    sourceByteLength: 2048,
    selected: true,
    generatedReady: false,
    exactFileName: null,
    sourceFileName: "Expert CVs.pdf.txt",
    sourceSection: null,
    sourceQuote: null,
    evidenceRevision: "a".repeat(64),
    facets: {},
    ...overrides,
  } as AutomaticEvidenceCandidate;
}

function generatedTechnicalPdf(): AutomaticEvidenceCandidate {
  return candidate({
    recordType: "GENERATED_DOCUMENT",
    recordId: "g1",
    label: "Technical Proposal.pdf",
    searchableText: "Technical Proposal.pdf TECHNICAL PDF single technical file submission",
    evidenceKinds: ["OUTPUT_ARTIFACT", "PACKAGE_FORMAT", "METHODOLOGY_NARRATIVE", "DECLARATION", "FORM_TEMPLATE"],
    evidenceKey: "generated:g1",
    generatedReady: true,
    exactFileName: "Technical Proposal.pdf",
    facets: { validationStatus: "PASSED", generationStatus: "GENERATED" },
  });
}

describe("Packaging requirements are recognised as format rules", () => {
  const packagingTitles = [
    "Submission in a Single PDF Technical File",
    "The proposal must be submitted in PDF format",
    "All volumes shall be combined into a single file",
    "File naming convention for uploaded documents",
    "Technical and financial offers in separate sealed envelopes",
    "Page limit: the technical proposal must not exceed 40 pages",
    "Font size and line spacing must comply with the instructions",
    "Submit three hard copies, spiral bound",
    "Each file must not exceed 10 MB",
    "Documents shall be submitted as a searchable PDF",
  ];
  for (const title of packagingTitles) {
    it(`treats "${title}" as a packaging/format rule`, () => {
      assert.equal(isPackagingOrFormatRequirement({ title, description: "" }), true);
    });
  }

  const evidenceTitles = [
    "Expert CVs for the proposed key personnel",
    "Three similar project references in the water sector",
    "Audited financial statements for the last three years",
    "Valid trade licence and registration certificate",
    "Signed declaration of no conflict of interest",
    "Bid bond of 2% of the bid value",
    "Detailed methodology and work plan",
    "Submit the audited financial statements in PDF format",
  ];
  for (const title of evidenceTitles) {
    it(`keeps "${title}" as a substantive evidence requirement`, () => {
      assert.equal(isPackagingOrFormatRequirement({ title, description: "" }), false);
    });
  }
});

describe("Packaging requirements resolve to artifact evidence only", () => {
  it("infers PACKAGE_FORMAT and nothing else — never GENERAL", () => {
    const kinds = inferAutomaticEvidenceKinds(requirement());
    assert.deepEqual(kinds, ["PACKAGE_FORMAT"]);
    assert.ok(!kinds.includes("GENERAL"), "GENERAL is a wildcard the selector admits every candidate for");
  });

  it("an unrelated source/company file can no longer support a packaging rule", () => {
    const selected = selectAutomaticEvidenceForRequirement(requirement(), [candidate()]);
    assert.equal(selected.length, 0, `Expert CVs.pdf.txt must not support a single-PDF rule, got: ${
      selected.map((s) => `${s.candidate.label} (${s.supportLevel})`).join(", ")}`);
  });

  it("an expert or project record can never support a packaging rule either", () => {
    const rows = [
      candidate({ recordType: "EXPERT", recordId: "e1", label: "Abebe Bekele, Team Leader", evidenceKey: "expert:e1" }),
      candidate({ recordType: "PROJECT", recordId: "p1", label: "Dessie Water Supply", evidenceKey: "project:p1" }),
    ];
    assert.equal(selectAutomaticEvidenceForRequirement(requirement(), rows).length, 0);
  });

  it("the validated generated artifact DOES support the packaging rule", () => {
    const selected = selectAutomaticEvidenceForRequirement(requirement(), [generatedTechnicalPdf()]);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].candidate.recordType, "GENERATED_DOCUMENT");
    assert.equal(selected[0].candidate.label, "Technical Proposal.pdf");
    assert.ok(["FULL", "SUBSTANTIAL"].includes(selected[0].supportLevel),
      `validated artifact evidence must be strong, got ${selected[0].supportLevel}`);
  });

  it("the artifact wins even when an unrelated file scores well on text", () => {
    const selected = selectAutomaticEvidenceForRequirement(requirement(), [candidate(), generatedTechnicalPdf()]);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].candidate.recordType, "GENERATED_DOCUMENT");
  });

  it("a packaging rule stays unsupported until the artifact exists (fail closed)", () => {
    // No artifact in the pool at all — the requirement must report nothing
    // rather than borrow the nearest source file.
    const selected = selectAutomaticEvidenceForRequirement(requirement(), [
      candidate(),
      candidate({ recordId: "c2", label: "Tender Document.pdf.txt", evidenceKey: "company:c2", evidenceKinds: ["GENERAL"] }),
    ]);
    assert.equal(selected.length, 0);
  });

  it("a confirmed plan item is only a promise until its bytes exist", () => {
    const planned = candidate({
      recordType: "BUILD_PLAN_ITEM",
      recordId: "b1",
      label: "Technical Proposal.pdf",
      searchableText: "Technical Proposal.pdf TECHNICAL PDF",
      evidenceKinds: ["OUTPUT_ARTIFACT", "PACKAGE_FORMAT", "METHODOLOGY_NARRATIVE", "DECLARATION", "FORM_TEMPLATE"],
      evidenceKey: "plan:b1",
      exactFileName: "Technical Proposal.pdf",
      facets: { confirmed: true, artifactBytesVerified: false },
    });
    const selected = selectAutomaticEvidenceForRequirement(requirement(), [planned]);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].supportLevel, "PARTIAL");
  });
});

describe("Evidence requirements keep their real evidence", () => {
  it("an expert CV requirement still links to the expert CV file", () => {
    const req = requirement({
      title: "Expert CVs for the proposed key personnel",
      description: "Provide signed CVs for the team leader and all key experts.",
      requirementType: "EXPERT",
    });
    assert.ok(inferAutomaticEvidenceKinds(req).includes("EXPERT_CV"));
    const selected = selectAutomaticEvidenceForRequirement(req, [candidate()]);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].candidate.label, "Expert CVs.pdf.txt");
  });
});
