import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isExtractionAcceptableForGeneration } from "../lib/engine/quality/extraction-quality-gate";
import { hasValidSubmissionPlan } from "../lib/engine/plans/submission-plan-completeness";

const BAD_ANALYSIS_STATUS = "EXTRACTION_CORRUPTED_AI_SKIPPED";
const FALLBACK_ANALYSIS_STATUS = "REGEX_FALLBACK_FROM_WEAK_EXTRACTION";

type FileGate = {
  id: string;
  extractionScore: number | null;
  totalPages: number | null;
  extractedPages: number | null;
  ocrPages: number | null;
  failedPages: number | null;
};

function analysisBlocked(files: FileGate[], status: string | null): boolean {
  return !isExtractionAcceptableForGeneration(files) || status === BAD_ANALYSIS_STATUS || status === FALLBACK_ANALYSIS_STATUS;
}

function planBlocked(files: FileGate[], status: string | null): boolean {
  return analysisBlocked(files, status);
}

function docsBlocked(input: { extractionBlocked: boolean; planValid: boolean; status: string | null }): boolean {
  return input.extractionBlocked || !input.planValid || input.status === BAD_ANALYSIS_STATUS || input.status === FALLBACK_ANALYSIS_STATUS;
}

function finalPackageBlocked(input: { extractionBlocked: boolean; docsValid: boolean; metadataComplete: boolean; requirementsCovered: boolean }): boolean {
  return input.extractionBlocked || !input.docsValid || !input.metadataComplete || !input.requirementsCovered;
}

describe("bad extraction blocks the workflow chain", () => {
  it("blocks analysis, plan, document generation, and final package readiness together", async () => {
    const files: FileGate[] = [
      { id: "file-1", extractionScore: 10, totalPages: 12, extractedPages: 1, ocrPages: 0, failedPages: 11 },
    ];

    const extractionBlocked = !isExtractionAcceptableForGeneration(files);
    assert.equal(extractionBlocked, true);

    assert.equal(analysisBlocked(files, BAD_ANALYSIS_STATUS), true);
    assert.equal(planBlocked(files, BAD_ANALYSIS_STATUS), true);

    const mockPrisma = { generatedDocument: { count: async () => 0 } };
    const plan = await hasValidSubmissionPlan(mockPrisma, "tender-bad-extraction");
    assert.equal(plan.valid, false);

    assert.equal(docsBlocked({ extractionBlocked, planValid: plan.valid, status: BAD_ANALYSIS_STATUS }), true);
    assert.equal(finalPackageBlocked({ extractionBlocked, docsValid: false, metadataComplete: false, requirementsCovered: false }), true);
  });
});
