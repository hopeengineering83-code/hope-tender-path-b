// "Is this required plan file satisfied?" has one answer.
//
// It had three, and they disagreed in both directions:
//
//   1. findMissingGeneratedDocuments (submission-plan.ts) — normalize():
//      strips the extension, collapses non-alphanumerics.
//   2. resolveSubmissionPlanCompleteness (submission-plan-completeness.ts) —
//      the same normalization PLUS isFinalExportCandidateDocument.
//   3. validateGeneratedDocsAgainstPlan (workflow-state.ts) — a raw lowercase
//      exact compare, no normalization, no export-candidate check.
//
// Rule 3 was strictly weaker. "Technical-Proposal.docx" satisfies the plan
// item "Technical Proposal.docx" under rules 1 and 2 and did NOT under rule 3,
// so the canonical workflow decision reported a required document missing when
// it already existed and parked on GENERATE_DOCUMENTS permanently. That is the
// opposite of "upload the documents and the app finishes the job".
//
// Separately, lib/canonical-tender-readiness.ts called rule 1 on UNFILTERED
// documents while the real ZIP gate (final-submission-readiness.ts:565)
// filters through filterFinalExportCandidateDocuments first. So a row the user
// marked NOT_EXPORTABLE satisfied its required plan file in readiness:
// MISSING_PLANNED_FILES never fired and readyForFinalExport went true while
// export refused the same tender.
//
// Both are fixed at the call sites, deliberately NOT by tightening rule 1
// itself: generate-missing-plan-files/route.ts and generate/route.ts build NEW
// CONTENT for every file rule 1 calls missing, so a global tightening would
// regenerate documents a user deliberately marked non-exportable and destroy
// that decision. The asserted behaviour below is the agreement, not the
// mechanism.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

import { findMissingGeneratedDocuments } from "../lib/engine/submission-plan";
import { resolveSubmissionPlanCompleteness } from "../lib/engine/submission-plan-completeness";
import { validateGeneratedDocsAgainstPlan } from "../lib/engine/workflow/workflow-state";
import { filterFinalExportCandidateDocuments } from "../lib/engine/document-output-state";

const PLAN_ITEM = {
  canonicalId: "c1",
  exactFileName: "Technical Proposal.docx",
  exactOrder: 1,
  documentType: "TECHNICAL_PROPOSAL",
  format: "DOCX",
  envelope: "TECHNICAL" as const,
  required: true,
  source: "TENDER",
};
const PLAN = { files: [PLAN_ITEM], warnings: [] };

function doc(overrides: Record<string, unknown> = {}) {
  return {
    id: "d1",
    name: "Technical Proposal",
    exactFileName: "Technical Proposal.docx",
    exactOrder: 1,
    documentType: "TECHNICAL_PROPOSAL",
    format: "DOCX",
    generationStatus: "GENERATED",
    validationStatus: "PASSED",
    reviewStatus: "READY_FOR_EXPORT",
    contentSummary: "x",
    fileContent: null,
    ...overrides,
  };
}

function satisfiedBySubmissionPlan(d: Record<string, unknown>): boolean {
  return findMissingGeneratedDocuments(PLAN as never, [d] as never).length === 0;
}
// The canonical resolver distinguishes "no file at all" (MISSING) from "a file
// exists but cannot be exported" (REPLACE_WITH_ORIGINAL / PLANNED), and only
// the former lands in totalMissing. Asking totalMissing here would therefore
// call a NOT_EXPORTABLE row satisfied. The question all three resolvers must
// answer the same way is "does this count as a current output", which is
// totalGenerated.
function satisfiedByCompleteness(d: Record<string, unknown>): boolean {
  return resolveSubmissionPlanCompleteness({
    tender: { id: "t1", title: "T", exactFileNaming: null, exactFileOrder: null, pageLimit: null, requirements: [] } as never,
    generatedDocuments: [d] as never,
    qualityFailedIds: new Set<string>(),
    confirmedPlanItems: [PLAN_ITEM] as never,
  }).totalGenerated > 0;
}
function satisfiedByWorkflowState(d: Record<string, unknown>): boolean {
  return validateGeneratedDocsAgainstPlan(PLAN, [d]).ok;
}

describe("filename spelling does not change whether a plan file is satisfied", () => {
  // Every one of these is the same document to normalize(); the deleted local
  // rule in workflow-state saw four different files.
  for (const fileName of [
    "Technical Proposal.docx",
    "Technical-Proposal.docx",
    "Technical_Proposal.docx",
    "Technical  Proposal.docx",
    "technical proposal.docx",
  ]) {
    it(`all three resolvers agree on "${fileName}"`, () => {
      const d = doc({ exactFileName: fileName, name: fileName });
      const answers = [satisfiedBySubmissionPlan(d), satisfiedByCompleteness(d), satisfiedByWorkflowState(d)];
      assert.deepEqual(answers, [true, true, true],
        `resolvers disagreed on "${fileName}": ${JSON.stringify(answers)}`);
    });
  }

  it("still reports a genuinely different file as missing", () => {
    const d = doc({ exactFileName: "Financial Proposal.docx", name: "Financial Proposal.docx" });
    assert.equal(satisfiedBySubmissionPlan(d), false);
    assert.equal(satisfiedByWorkflowState(d), false);
    assert.equal(validateGeneratedDocsAgainstPlan(PLAN, [d]).missing[0], "Technical Proposal.docx");
  });
});

describe("a non-exportable row never satisfies a required plan file", () => {
  // Each of these is excluded by isFinalExportCandidateDocument, so the final
  // ZIP gate treats the plan file as missing. Readiness and the workflow
  // decision must say the same thing.
  const nonExportable: Array<[string, Record<string, unknown>]> = [
    ["reviewStatus NOT_EXPORTABLE", { reviewStatus: "NOT_EXPORTABLE" }],
    ["reviewStatus REPLACE_WITH_ORIGINAL", { reviewStatus: "REPLACE_WITH_ORIGINAL" }],
    ["format CONTROL", { format: "CONTROL" }],
    ["documentType SUBMISSION_CONTROL", { documentType: "SUBMISSION_CONTROL" }],
    ["validationStatus SUPERSEDED", { validationStatus: "SUPERSEDED" }],
  ];

  for (const [label, override] of nonExportable) {
    it(`${label} is not a current output`, () => {
      const d = doc(override);
      assert.equal(satisfiedByCompleteness(d), false, "the canonical resolver already knew this");
      assert.equal(satisfiedByWorkflowState(d), false, "the workflow decision must agree with the export gate");
      // The export gate's own view, reproduced: filter first, then ask.
      assert.equal(
        findMissingGeneratedDocuments(PLAN as never, filterFinalExportCandidateDocuments([d] as never)).length,
        1,
      );
    });
  }

  it("an ordinary approved document is still satisfied everywhere", () => {
    const d = doc();
    assert.deepEqual(
      [satisfiedBySubmissionPlan(d), satisfiedByCompleteness(d), satisfiedByWorkflowState(d)],
      [true, true, true],
    );
  });
});

describe("both call sites filter, and the shared helper is left alone", () => {
  it("canonical readiness filters before asking what is missing", () => {
    const source = readFileSync("lib/canonical-tender-readiness.ts", "utf8");
    // The filter is now hoisted into one `currentDocuments` binding that every
    // count in the file reads, instead of being applied inline for `missing`
    // alone — three sibling counts were still reading the raw query result.
    // Assert the property: the set handed to findMissingGeneratedDocuments is
    // the canonically-filtered one.
    assert.match(source, /const currentDocuments = filterFinalExportCandidateDocuments\(/);
    assert.match(source, /findMissingGeneratedDocuments\(plan, currentDocuments/);
  });

  it("the workflow decision uses the shared rule instead of its own compare", () => {
    const source = readFileSync("lib/engine/workflow/workflow-state.ts", "utf8");
    assert.match(source, /findMissingGeneratedDocuments\(plan, exportable/);
    assert.match(source, /findExtraGeneratedDocuments\(plan, exportable/);
    // The deleted local compare, in any form.
    assert.doesNotMatch(source, /generatedNames\s*=\s*new Set/);
    assert.doesNotMatch(source, /plannedNames\.has\(/);
  });

  it("leaves the generation routes counting unfiltered, on purpose", () => {
    // These build new content for every "missing" file. Filtering here would
    // regenerate a document the user deliberately marked non-exportable.
    for (const path of [
      "app/api/tenders/[id]/generate-missing-plan-files/route.ts",
      "app/api/tenders/[id]/generate/route.ts",
    ]) {
      const source = readFileSync(path, "utf8");
      assert.doesNotMatch(source, /findMissingGeneratedDocuments\([^)]*filterFinalExportCandidateDocuments/,
        `${path} must keep counting unfiltered so it never overwrites a non-exportable decision`);
    }
  });
});
