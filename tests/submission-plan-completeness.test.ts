// Submission plan completeness resolver — the module that answers
// the screenshot question "where are the missing 13 of 19 docs?"

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveSubmissionPlanCompleteness,
  __testing__,
  type GeneratedDocSnapshot,
} from "../lib/engine/submission-plan-completeness";

function planTender(exactFileNaming: string[]): Parameters<typeof resolveSubmissionPlanCompleteness>[0]["tender"] {
  return {
    id: "t",
    title: "Tender",
    exactFileNaming: JSON.stringify(exactFileNaming),
    exactFileOrder: JSON.stringify(exactFileNaming),
    pageLimit: null,
    requirements: [],
  };
}

function doc(overrides: Partial<GeneratedDocSnapshot>): GeneratedDocSnapshot {
  return {
    id: "doc-" + Math.random().toString(36).slice(2, 8),
    name: "Some Doc",
    exactFileName: "some-doc.docx",
    exactOrder: null,
    documentType: "TECHNICAL_PROPOSAL",
    format: "DOCX",
    generationStatus: "GENERATED",
    validationStatus: "VALIDATED",
    reviewStatus: "READY_FOR_EXPORT",
    fileContent: "PK",
    storagePath: null,
    ...overrides,
  };
}

describe("submission-plan completeness — 6 of 19 case", () => {
  // Build a plan of 19 files; 6 are present as ready GeneratedDocuments
  // and 13 are missing entirely. The resolver must emit 19 plan rows
  // with the right status mix.
  const required = Array.from({ length: 19 }, (_, i) => `Doc-${i + 1}.docx`);
  const present = required.slice(0, 6).map((name) => doc({ exactFileName: name, name }));

  const report = resolveSubmissionPlanCompleteness({ tender: planTender(required), generatedDocuments: present });

  it("emits 19 plan rows", () => {
    const planRows = report.rows.filter((r) => r.key.startsWith("plan:"));
    assert.equal(planRows.length, 19);
  });
  it("counts 6 generated", () => {
    assert.equal(report.totalGenerated, 6);
  });
  it("counts 13 missing", () => {
    assert.equal(report.totalMissing, 13);
  });
  it("has explicit scope", () => {
    assert.equal(report.hasExplicitScope, true);
  });
  it("surfaces a clear warning about 13 missing", () => {
    assert.ok(report.warnings.some((w) => /13.+missing/.test(w)));
  });
});

describe("submission-plan completeness — official originals", () => {
  it("marks Bid Bond / Tax Clearance / Bid Form rows as MISSING_TENDER_SOURCE_FORM", () => {
    const required = ["Technical-Proposal.docx", "Bid-Bond.pdf", "Tax-Clearance.pdf", "Bid-Form.docx"];
    const report = resolveSubmissionPlanCompleteness({ tender: planTender(required), generatedDocuments: [] });
    const labels = new Set(report.rows.filter((r) => r.officialOriginal).map((r) => r.status));
    assert.ok(labels.has("MISSING_TENDER_SOURCE_FORM"));
  });
});

describe("submission-plan completeness — outside-plan rows", () => {
  it("emits an OUTSIDE_PLAN row for a doc whose name does not match any plan file", () => {
    const required = ["Technical-Proposal.docx"];
    const off = doc({ exactFileName: "Some-Internal-Working-Doc.docx", name: "Some Internal Working Doc" });
    const report = resolveSubmissionPlanCompleteness({ tender: planTender(required), generatedDocuments: [off] });
    assert.equal(report.totalOutsidePlan, 1);
    assert.ok(report.rows.some((r) => r.status === "OUTSIDE_PLAN"));
  });
});

describe("submission-plan completeness — quality failed propagates", () => {
  it("flips a row to GENERATED_QUALITY_FAILED when the doc id is in qualityFailedIds", () => {
    const required = ["Technical-Proposal.docx"];
    const present = doc({ exactFileName: "Technical-Proposal.docx", name: "Technical Proposal" });
    const report = resolveSubmissionPlanCompleteness({
      tender: planTender(required),
      generatedDocuments: [present],
      qualityFailedIds: new Set([present.id]),
    });
    assert.equal(report.totalQualityFailed, 1);
    assert.ok(report.rows[0].status === "GENERATED_QUALITY_FAILED");
  });

  it("preserves stored quality-failed statuses without needing inline fileContent", () => {
    const required = ["Technical-Proposal.docx"];
    const present = doc({
      exactFileName: "Technical-Proposal.docx",
      name: "Technical Proposal",
      fileContent: null,
      storagePath: "generated/technical-proposal.docx",
      validationStatus: "QUALITY_FAILED",
    });
    const report = resolveSubmissionPlanCompleteness({ tender: planTender(required), generatedDocuments: [present] });
    assert.equal(report.totalQualityFailed, 1);
    assert.equal(report.rows[0].status, "GENERATED_QUALITY_FAILED");
  });
});

describe("submission-plan completeness — historical (SUPERSEDED) rows excluded from package counts", () => {
  it("counts SUPERSEDED rows separately so 152 historical docs do not inflate the package count", () => {
    const required = ["Technical-Proposal.docx"];
    const supers = Array.from({ length: 5 }, (_, i) => doc({ id: `old-${i}`, exactFileName: `historical-${i}.docx`, name: `Historical ${i}`, generationStatus: "SUPERSEDED" }));
    const report = resolveSubmissionPlanCompleteness({ tender: planTender(required), generatedDocuments: supers });
    assert.equal(report.totalSuperseded, 5);
    // Envelope breakdown excludes SUPERSEDED rows.
    const total = (report.envelopeBreakdown.TECHNICAL ?? 0) + (report.envelopeBreakdown.FINANCIAL ?? 0) + (report.envelopeBreakdown.ADMIN ?? 0);
    assert.equal(total, 1); // only the missing-plan row counts
  });
});

describe("submission-plan completeness — plan provenance", () => {
  it("reports REQUIREMENTS_FOUND_PLAN_NOT_BUILT when requirements exist but no file plan rows can be derived", () => {
    const tender = {
      id: "t-plan-missing",
      title: "Tender",
      exactFileNaming: "[]",
      exactFileOrder: "[]",
      pageLimit: null,
      requirements: [{
        id: "req-control",
        title: "Submission rule",
        description: "Submit one original and two copies at the address stated in the tender.",
        requirementType: "SUBMISSION_RULE",
        priority: "MANDATORY",
        exactFileName: null,
        exactOrder: null,
        requiredQuantity: null,
        pageLimit: null,
        restrictions: null,
        sectionReference: null,
      }],
    };
    const report = resolveSubmissionPlanCompleteness({ tender, generatedDocuments: [] });
    assert.equal(report.totalRequired, 0);
    assert.equal(report.requirementCount, 1);
    assert.equal(report.hasExplicitScope, false);
    // PLAN_NOT_BUILT was renamed to REQUIREMENTS_FOUND_PLAN_NOT_BUILT to distinguish
    // "requirements exist but no plan built" from legacy PLAN_NOT_BUILT (backward compat kept in type).
    assert.equal(report.planState, "REQUIREMENTS_FOUND_PLAN_NOT_BUILT");
    // The warning used to read "Build Submission Plan before Generate Docs".
    // There is no Generate Docs action and no separate manual plan build: Run
    // Engine uses the verified source and current analysis to create and verify
    // the Build Plan. The warning must name
    // that action, and must not name either removed one.
    assert.ok(report.warnings.some((w) => /Run Engine uses the verified source and current AI analysis to create and verify the Build Plan/i.test(w)));
    assert.ok(!report.warnings.some((w) => /Generate Docs/i.test(w)));
  });

  it("marks requirement-derived file rows as an unconfirmed draft plan", () => {
    const tender = {
      id: "t-derived",
      title: "Tender",
      exactFileNaming: "[]",
      exactFileOrder: "[]",
      pageLimit: null,
      requirements: [{
        id: "req-technical",
        title: "Technical proposal",
        description: "Prepare a technical methodology for the services.",
        requirementType: "TECHNICAL",
        priority: "MANDATORY",
        exactFileName: null,
        exactOrder: null,
        requiredQuantity: null,
        pageLimit: null,
        restrictions: null,
        sectionReference: null,
      }],
    };
    const report = resolveSubmissionPlanCompleteness({ tender, generatedDocuments: [] });
    assert.equal(report.totalRequired, 1);
    assert.equal(report.hasExplicitScope, false);
    assert.equal(report.planState, "DERIVED_DRAFT_UNCONFIRMED");
    assert.equal(report.requiresUserConfirmation, true);
    assert.ok(report.warnings.some((w) => /derived draft/i.test(w)));
  });
});


describe("submission-plan completeness — helpers", () => {
  it("looksLikeOfficialOriginal detects the standard official-original labels", () => {
    const { looksLikeOfficialOriginal } = __testing__;
    assert.equal(looksLikeOfficialOriginal("Bid Form"), true);
    assert.equal(looksLikeOfficialOriginal("Tax Clearance Certificate"), true);
    assert.equal(looksLikeOfficialOriginal("Audited Financial Statement"), true);
    assert.equal(looksLikeOfficialOriginal("Technical Proposal"), false);
  });
});
