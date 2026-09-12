// The tender could not reach full coverage no matter what the owner uploaded,
// because one mandatory requirement was waiting on a file the app refused to
// create.
//
// "Technical Proposal Submission" is answered by a document this app generates,
// so its only automatic evidence is the confirmed Build Plan row for that exact
// file. A plan row is correctly never FULL or SUBSTANTIAL — the bytes do not
// exist — so the requirement stayed uncovered, and
// MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE refused to let generation start. The
// app declined to generate a file until the file already existed. Observed live
// at 3/4 coverage, with the plan row reading "planned output pending generated
// bytes" beside a panel advising "Generate the required file
// (Technical Proposal.pdf)".
//
// The exemption applies at the generation gate and nowhere else. These tests
// pin both halves, and the second half is the one that keeps the release
// honest.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { buildCanonicalWorkflowDecision } from "../lib/engine/canonical-workflow-decision";

// A tender that has cleared everything up to matching: files, trusted analysis,
// confirmed plan, compliance rows present, three of four mandatory requirements
// genuinely covered.
function atMatchingStage(overrides: Record<string, unknown> = {}) {
  return {
    hasFiles: true,
    extractionUnsafe: false,
    extractionCorrupted: false,
    ocrRequired: false,
    aiAnalysisExists: true,
    aiAnalysisTrusted: true,
    aiAnalysisPartial: false,
    aiAnalysisStale: false,
    requirementsExist: true,
    requirementsTrusted: true,
    criticalTenderDetailsValid: true,
    confirmedBuildPlanExists: true,
    mandatoryRequirementCount: 4,
    mandatoryTracedCount: 4,
    mandatoryComplianceRowsCount: 4,
    mandatoryFullOrSubstantialCoverageCount: 3,
    ...overrides,
  } as Parameters<typeof buildCanonicalWorkflowDecision>[0];
}

describe("a requirement waiting on generation does not block generation", () => {
  it("still blocks when the fourth requirement is genuinely unsupported", () => {
    // Nothing is waiting on an output here: the requirement simply has no
    // evidence. This must stay blocked, and it is the reason the exemption is
    // counted rather than assumed.
    const decision = buildCanonicalWorkflowDecision(
      atMatchingStage({ mandatoryAwaitingPlannedOutputCount: 0 }),
    );

    assert.ok(
      decision.blockerCodes.includes("MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE"),
      "a requirement with no evidence at all must still stop the workflow",
    );
  });

  it("stops blocking when the only shortfall is a file this workflow will generate", () => {
    const decision = buildCanonicalWorkflowDecision(
      atMatchingStage({ mandatoryAwaitingPlannedOutputCount: 1 }),
    );

    assert.ok(
      !decision.blockerCodes.includes("MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE"),
      "the app must not refuse to generate a document because that document does not exist yet",
    );
  });

  it("defaults to the stricter behaviour when the count is absent", () => {
    // The field is optional so existing callers keep compiling. An absent count
    // must mean "nothing is exempt", never "exempt everything".
    const decision = buildCanonicalWorkflowDecision(atMatchingStage());

    assert.ok(
      decision.blockerCodes.includes("MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE"),
      "an unsupplied exemption count must fail closed",
    );
  });

  it("does not let the exemption reach past the generation gate", () => {
    // The bytes still do not exist, so everything downstream must still object.
    // If this ever passes with an empty blocker list, the exemption has leaked
    // into export and a package could be released without its documents.
    const decision = buildCanonicalWorkflowDecision(
      atMatchingStage({
        mandatoryAwaitingPlannedOutputCount: 1,
        requiredDocumentsTotal: 1,
        generatedDocumentsTotal: 0,
        exportReadyDocumentsTotal: 0,
      }),
    );

    assert.ok(
      decision.blockerCodes.length > 0,
      "a tender with no generated documents must still be blocked, just no longer for the wrong reason",
    );
    assert.ok(
      decision.blockerCodes.includes("REQUIRED_DOCS_NOT_GENERATED"),
      `clearing the coverage blocker must reveal the honest one — the documents genuinely are not generated `
        + `yet — rather than opening the way to export. Got: ${decision.blockerCodes.join(", ")}`,
    );
    assert.ok(
      !decision.blockerCodes.includes("MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE"),
      "and it must no longer be blocked for lacking source evidence it was never going to have",
    );
  });
});
