// Submission plan state repair regression tests.
//
// Verifies the fix to the contradiction where the UI showed
// "Plan up to date — all 13 planned file(s) already exist" AND
// "Plan state: Plan not built" simultaneously.
//
// Root cause: resolveSubmissionPlanCompleteness() returned PLAN_NOT_BUILT when
// buildSubmissionPlan() found 0 required files (no exactFileName on requirements),
// even though 13 active GeneratedDocument rows existed.
//
// Fix: when planFiles.length === 0 but active docs exist, adopt them as the
// effective plan. Plan state is then DERIVED_DRAFT_UNCONFIRMED or
// EXPLICIT_TENDER_PLAN based on contentSummary markers.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveSubmissionPlanCompleteness } from "../lib/engine/submission-plan-completeness";
import type { GeneratedDocSnapshot } from "../lib/engine/submission-plan-completeness";

function makeTender(overrides: Partial<Parameters<typeof resolveSubmissionPlanCompleteness>[0]["tender"]> = {}): Parameters<typeof resolveSubmissionPlanCompleteness>[0]["tender"] {
  return {
    id: "tender-1",
    title: "Test Tender",
    exactFileNaming: "[]",
    exactFileOrder: "[]",
    pageLimit: null,
    requirements: [],
    ...overrides,
  };
}

function makeDoc(overrides: Partial<GeneratedDocSnapshot> = {}): GeneratedDocSnapshot {
  return {
    id: `doc-${Math.random().toString(36).slice(2)}`,
    name: "Technical Proposal",
    exactFileName: "technical-proposal.docx",
    exactOrder: 1,
    documentType: "TECHNICAL_PROPOSAL",
    format: "DOCX",
    generationStatus: "GENERATED",
    validationStatus: "PENDING",
    reviewStatus: "PENDING",
    fileContent: "content",
    storagePath: null,
    contentSummary: null,
    ...overrides,
  };
}

describe("submission-plan-state-repair", () => {
  // Test 1: planFiles=0 but 13 active docs exist → planState is NOT "PLAN_NOT_BUILT"
  it("when planFiles=0 but 13 active docs exist → planState is NOT PLAN_NOT_BUILT", () => {
    const docs = Array.from({ length: 13 }, (_, i) => makeDoc({
      id: `doc-${i}`,
      name: `Document ${i + 1}`,
      exactFileName: `document-${i + 1}.docx`,
      exactOrder: i + 1,
    }));

    const report = resolveSubmissionPlanCompleteness({
      tender: makeTender({ requirements: [] }),
      generatedDocuments: docs,
    });

    assert.notEqual(report.planState, "PLAN_NOT_BUILT");
    assert.ok(
      ["DERIVED_DRAFT_UNCONFIRMED", "EXPLICIT_TENDER_PLAN"].includes(report.planState),
      `Expected DERIVED_DRAFT_UNCONFIRMED or EXPLICIT_TENDER_PLAN, got ${report.planState}`,
    );
  });

  // Test 2: planFiles=0 (submission-rule type doesn't produce plan files), no active docs, requirements exist → REQUIREMENTS_FOUND_PLAN_NOT_BUILT
  it("when planFiles=0, no active docs, requirements exist → REQUIREMENTS_FOUND_PLAN_NOT_BUILT", () => {
    // SUBMISSION_RULE type does not produce plan file rows (not a DOCUMENT_REQUIREMENT_TYPE),
    // so planFiles.length === 0 even though requirements exist.
    const report = resolveSubmissionPlanCompleteness({
      tender: makeTender({
        requirements: [
          {
            id: "req-1",
            title: "Submit one original at procurement office",
            description: "Submit one original and two copies at the address stated in the tender.",
            requirementType: "SUBMISSION_RULE",
            priority: "MANDATORY",
            exactFileName: null,
            exactOrder: null,
            requiredQuantity: null,
            pageLimit: null,
            restrictions: null,
            sectionReference: null,
          },
        ],
      }),
      generatedDocuments: [],
    });

    assert.equal(report.planState, "REQUIREMENTS_FOUND_PLAN_NOT_BUILT");
    assert.equal(report.requirementCount, 1);
  });

  // Test 3: planFiles=0 but docs with DERIVED_DRAFT_UNCONFIRMED → DERIVED_DRAFT_UNCONFIRMED
  it("when planFiles=0 but docs with DERIVED_DRAFT_UNCONFIRMED contentSummary exist → DERIVED_DRAFT_UNCONFIRMED", () => {
    const docs = [
      makeDoc({
        contentSummary: "DERIVED_DRAFT_UNCONFIRMED plan row from requirement keywords.",
        generationStatus: "PLANNED",
        reviewStatus: "PENDING",
      }),
      makeDoc({
        id: "doc-b",
        exactFileName: "financial-proposal.docx",
        contentSummary: "DERIVED_DRAFT_UNCONFIRMED financial plan row.",
        generationStatus: "PLANNED",
        reviewStatus: "PENDING",
      }),
    ];

    const report = resolveSubmissionPlanCompleteness({
      tender: makeTender(),
      generatedDocuments: docs,
    });

    assert.equal(report.planState, "DERIVED_DRAFT_UNCONFIRMED");
  });

  // Test 4: planFiles=0 but docs WITHOUT DERIVED_DRAFT marker → EXPLICIT_TENDER_PLAN
  it("when planFiles=0 but docs WITHOUT DERIVED_DRAFT marker exist → EXPLICIT_TENDER_PLAN", () => {
    const docs = [
      makeDoc({
        contentSummary: "Planned tender-required file from explicit submission plan.",
        generationStatus: "GENERATED",
        reviewStatus: "READY_FOR_EXPORT",
      }),
      makeDoc({
        id: "doc-b",
        exactFileName: "company-profile.docx",
        contentSummary: "Company profile document.",
        generationStatus: "GENERATED",
        reviewStatus: "READY_FOR_EXPORT",
      }),
    ];

    const report = resolveSubmissionPlanCompleteness({
      tender: makeTender(),
      generatedDocuments: docs,
    });

    assert.equal(report.planState, "EXPLICIT_TENDER_PLAN");
  });

  // Test 5: totalRequired counts adopted docs (not 0)
  it("totalRequired counts adopted docs, not 0", () => {
    const docs = Array.from({ length: 5 }, (_, i) => makeDoc({
      id: `doc-${i}`,
      exactFileName: `file-${i}.docx`,
      exactOrder: i + 1,
    }));

    const report = resolveSubmissionPlanCompleteness({
      tender: makeTender(),
      generatedDocuments: docs,
    });

    assert.equal(report.totalRequired, 5);
  });

  // Test 6: Adopted docs appear with PLANNED/GENERATED status (not OUTSIDE_PLAN)
  it("adopted docs appear with correct status (not OUTSIDE_PLAN)", () => {
    const docs = [
      makeDoc({ generationStatus: "GENERATED", reviewStatus: "READY_FOR_EXPORT", fileContent: "content" }),
      makeDoc({ id: "doc-b", exactFileName: "financial.docx", generationStatus: "PLANNED", reviewStatus: "PENDING", fileContent: null }),
    ];

    const report = resolveSubmissionPlanCompleteness({
      tender: makeTender(),
      generatedDocuments: docs,
    });

    const outsidePlan = report.rows.filter((r) => r.status === "OUTSIDE_PLAN");
    assert.equal(outsidePlan.length, 0);

    const validStatuses = ["GENERATED", "GENERATED_NEEDS_REVIEW", "GENERATED_QUALITY_FAILED", "PLANNED", "MISSING_TENDER_SOURCE_FORM", "MISSING"];
    for (const row of report.rows) {
      assert.ok(validStatuses.includes(row.status), `Unexpected status ${row.status} for row ${row.name}`);
    }
  });

  // Test 7: totalRequired is 0 only when no active docs AND no plan files exist
  it("totalRequired is 0 when all docs are SUPERSEDED", () => {
    const docs = [
      makeDoc({ generationStatus: "SUPERSEDED", reviewStatus: "PENDING" }),
    ];

    const report = resolveSubmissionPlanCompleteness({
      tender: makeTender(),
      generatedDocuments: docs,
    });

    // Superseded docs are not adopted into the plan
    assert.equal(report.totalRequired, 0);
  });

  // Test 8: No requirements, no docs → NO_REQUIREMENTS
  it("no requirements and no docs → planState is NO_REQUIREMENTS", () => {
    const report = resolveSubmissionPlanCompleteness({
      tender: makeTender({ requirements: [] }),
      generatedDocuments: [],
    });

    assert.equal(report.planState, "NO_REQUIREMENTS");
    assert.equal(report.totalRequired, 0);
  });

  // Test 9: Valid plan states include PLAN_NOT_BUILT for backward compat
  it("PLAN_NOT_BUILT is in SubmissionPlanState union for backward compat", () => {
    const validStates: string[] = [
      "EXPLICIT_TENDER_PLAN",
      "DERIVED_DRAFT_UNCONFIRMED",
      "PLAN_NOT_BUILT",
      "REQUIREMENTS_FOUND_PLAN_NOT_BUILT",
      "NO_REQUIREMENTS",
    ];

    const report = resolveSubmissionPlanCompleteness({
      tender: makeTender(),
      generatedDocuments: [],
    });

    assert.ok(validStates.includes(report.planState), `Unexpected planState: ${report.planState}`);
  });
});
