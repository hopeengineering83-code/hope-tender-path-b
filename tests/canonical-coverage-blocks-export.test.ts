/**
 * The canonical release state is the authority on mandatory evidence coverage,
 * and until this test existed nothing on the export path consulted it.
 *
 * export-readiness.ts carries its own coverage heuristic that raises a MEDIUM
 * blocker only below 50%. The canonical rule requires FULL/SUBSTANTIAL coverage
 * on EVERY mandatory requirement, and its own message promises that "no
 * confirmation click can bypass this gate". Between those two thresholds the
 * canonical surface said BLOCKED while the export path let the archive out.
 *
 * Reproduced live before the fix, on a seeded tender at exactly 6/12 mandatory
 * coverage: GET /export-readiness returned {"ok":false,"status":"BLOCKED"} with
 * MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE, while POST /export returned 200
 * "All preflight gates passed" and offered the ZIP for download — the same
 * tender, the same moment, two opposite answers.
 *
 * The invariant: no downstream surface may authorize a release stage while a
 * required canonical upstream state reports BLOCKED.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { evaluateGenerationReadiness, type GenerationReadinessInput } from "../lib/engine/generation-readiness-gate";

function passing(overrides: Partial<GenerationReadinessInput> = {}): GenerationReadinessInput {
  return {
    purpose: "generate",
    tenderExistsAndOwned: true,
    activeFileCount: 1,
    extractionFiles: [{ fileId: "f1", corrupted: false, weak: false, hasOverride: false }],
    analysisState: "AI_SUCCEEDED",
    canonicalJobId: "job-1",
    latestJobHash: "hash-abc",
    currentContentHash: "hash-abc",
    fallbackApprovalBound: false,
    currentHashChunks: [{ status: "SUCCEEDED", totalChunks: 1 }],
    requirementCount: 3,
    requirements: [
      { priority: "MANDATORY", sourceTenderFileId: "f1", sourcePageNumber: 1, sourceExactQuote: "This is a meaningful quote exceeding minimum length", sourceFileActiveInTender: true, sourceFileExtractedText: "This tender document contains the following: This is a meaningful quote exceeding minimum length. Additional context for the tender file extraction." },
      { priority: "MANDATORY", sourceTenderFileId: "f1", sourcePageNumber: 2, sourceExactQuote: "Another meaningful source quote for grounding", sourceFileActiveInTender: true, sourceFileExtractedText: "This tender document contains the following: Another meaningful source quote for grounding. Additional context for the tender file extraction." },
      { priority: null, sourceTenderFileId: "f1", sourcePageNumber: 3, sourceExactQuote: "Third requirement source quote for testing", sourceFileActiveInTender: true, sourceFileExtractedText: "This tender document contains the following: Third requirement source quote for testing. Additional context for the tender file extraction." },
    ],
    criticalMetadataOk: true,
    exportReadyDocumentCount: 3,
    hasCurrentConfirmedBuildPlan: true,
    confirmedBuildPlanItemsValid: true,
    confirmedPlanDocumentsOk: true,
    recordedBuildPlanState: "VALID" as const,
    ...overrides,
  };
}

describe("canonical mandatory coverage blocks the release path", () => {
  it("blocks export when the canonical state reports incomplete coverage", () => {
    const r = evaluateGenerationReadiness(passing({
      purpose: "export",
      canonicalMandatoryCoverageBlocked: true,
      canonicalMandatoryCoverageDetail: "6/12 mandatory requirements have FULL/SUBSTANTIAL coverage.",
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE");
  });

  it("blocks the final ZIP — the path that actually emits bytes", () => {
    const r = evaluateGenerationReadiness(passing({
      purpose: "final-zip",
      canonicalMandatoryCoverageBlocked: true,
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE");
  });

  it("carries the canonical reason through instead of inventing its own", () => {
    const detail = "6/12 mandatory requirements have FULL/SUBSTANTIAL coverage.";
    const r = evaluateGenerationReadiness(passing({
      purpose: "export",
      canonicalMandatoryCoverageBlocked: true,
      canonicalMandatoryCoverageDetail: detail,
    }));
    assert.equal(r.blockerDetail, detail);
  });

  it("does NOT block draft work — evidence coverage is a release concern", () => {
    // The authority model: draft generation is never blocked by evidence
    // coverage. If this ever starts failing, the fix has leaked into the draft
    // path and broken the workflow it was meant to protect.
    for (const purpose of ["generate", "regenerate-section", "ai-proposal"] as const) {
      const r = evaluateGenerationReadiness(passing({ purpose, canonicalMandatoryCoverageBlocked: true }));
      assert.equal(r.ok, true, `draft purpose ${purpose} was blocked by a release-only rule`);
    }
  });

  it("stays inert when the canonical verdict is absent or clear", () => {
    assert.equal(evaluateGenerationReadiness(passing({ purpose: "export" })).ok, true);
    assert.equal(
      evaluateGenerationReadiness(passing({ purpose: "export", canonicalMandatoryCoverageBlocked: false })).ok,
      true,
    );
  });
});
