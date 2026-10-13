/**
 * A bidder declaration is the owner's to sign, and the owner is told so.
 *
 * 2026-09-30, Preview, a telecom-tower EOI (accept run 36738327401):
 * Proposal Generation succeeded and auto-finalize stopped. Two declarations
 * ("Litigation History Disclosure", "Declaration of Non-Performing
 * Contracts") had been written as internal "generated support control" stubs
 * and marked ready for the ZIP; the third waited for an original; and the
 * owner was shown "Processing automatically" while nothing was processing.
 * Export readiness also refused on NO_SELECTED_REVIEWED_PROJECTS for a SCORED
 * experience row, the fourth copy of that rule.
 *
 * Generic fixtures.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { __testing__ } from "../lib/engine/missing-plan-file-generation";
import { presentTwoActionWorkflowDecision } from "../lib/engine/two-action-workflow-presentation";
import { requiresEvidenceOfType } from "../lib/engine/mandatory-evidence-requirement";

describe("bidder declarations wait for the signed original", () => {
  for (const [fileName, type] of [
    ["Litigation History Disclosure.docx", "DECLARATION"],
    ["Declaration of Non-Performing Contracts.docx", "DECLARATION"],
    ["Declaration of Non-Debarment and Eligibility.docx", "ELIGIBILITY"],
    ["Anti-Bribery Undertaking.docx", ""],
  ]) {
    it(`${fileName} is never a generated stub`, () => {
      const documentType = __testing__.documentTypeFor(fileName, type);
      assert.equal(__testing__.needsOriginalReplacement(fileName, documentType), true);
    });
  }

  it("the proposal and methodology are still written by the app", () => {
    for (const fileName of ["Expression of Interest.docx", "Technical Proposal.docx", "Technical Approach and Methodology.docx"]) {
      assert.equal(__testing__.needsOriginalReplacement(fileName, __testing__.documentTypeFor(fileName, "")), false, fileName);
    }
  });
});

describe("the owner is told which originals to upload", () => {
  const base = {
    currentBlockingStage: "REQUIRED_DOCS_NOT_GENERATED",
    nextRequiredAction: "GENERATE_DOCUMENTS",
    nextRequiredActionLabel: "Generate proposal documents",
    nextRequiredActionReason: "3/4 required documents generated.",
    requiredDocumentsTotal: 4,
    generatedDocumentsTotal: 1,
  };

  it("names the files when only owner originals are missing", () => {
    const decision = presentTwoActionWorkflowDecision({
      ...base,
      awaitingOwnerOriginalFileNames: ["Litigation History Disclosure.docx", "Declaration of Non-Debarment.docx", "Declaration of Non-Performing Contracts.docx"],
    } as any)!;
    assert.equal(decision.nextRequiredAction, "UPLOAD_SIGNED_ORIGINALS");
    assert.match(decision.nextRequiredActionReason, /Litigation History Disclosure\.docx/);
    assert.doesNotMatch(decision.nextRequiredActionLabel, /Processing automatically/);
  });

  it("still says processing automatically when the app has work left", () => {
    const decision = presentTwoActionWorkflowDecision({ ...base, awaitingOwnerOriginalFileNames: ["Declaration.docx"] } as any)!;
    assert.equal(decision.nextRequiredAction, "AUTOMATIC_PROCESSING");
  });
});

describe("one rule for 'the tender requires this evidence'", () => {
  it("only a MANDATORY/CRITICAL row requires it", () => {
    assert.equal(requiresEvidenceOfType([{ requirementType: "PROJECT_EXPERIENCE", priority: "SCORED" }], ["PROJECT_EXPERIENCE"]), false);
    assert.equal(requiresEvidenceOfType([{ requirementType: "PROJECT_EXPERIENCE", priority: "MANDATORY" }], ["PROJECT_EXPERIENCE"]), true);
    assert.equal(requiresEvidenceOfType([{ requirementType: "EXPERT", priority: "critical" }], ["EXPERT"]), true);
  });

  it("export readiness and canonical readiness both use it", () => {
    for (const file of ["lib/engine/export-readiness.ts", "lib/canonical-tender-readiness.ts"]) {
      const source = readFileSync(file, "utf8");
      assert.match(source, /requiresEvidenceOfType\(tender\.requirements, \["PROJECT_EXPERIENCE"\]\)/, file);
      assert.doesNotMatch(source, /requirements\.some\(\(r\) => r\.requirementType === "PROJECT_EXPERIENCE"\)/, file);
    }
  });
});
