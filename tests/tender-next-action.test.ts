import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { hasResumableAiAnalyzeCheckpoint, resolveTenderNextAction } from "../lib/tender-next-action";

const base = {
  hasFiles: true,
  extraction: { averageScore: 95, pageCoveragePercent: 100 },
  resumableAnalysisAvailable: false,
  aiAnalysis: { exists: true, trusted: true, status: "FULL_EXTRACTION_AI_ANALYZED", regexFallback: false, partial: false },
  metadata: { trusted: true, missingFields: [], contaminated: false, placeholderCount: 0 },
  requirements: { rawCount: 6, trustedTracedCount: 6, mandatoryCount: 2, mandatoryTracedCount: 2 },
  submissionPlanBuilt: true,
  documents: { current: true, hasGeneratedDocuments: true, stale: false },
  exportBlockersCount: 0,
};

describe("resolveTenderNextAction", () => {
  it("weak extraction shows Fix Extraction First before AI Analyze", () => {
    const decision = resolveTenderNextAction({
      ...base,
      extraction: { averageScore: 90, pageCoveragePercent: 31, partial: true },
      resumableAnalysisAvailable: true,
      aiAnalysis: { exists: false },
    });
    assert.equal(decision.primary, "FIX_EXTRACTION");
    assert.match(decision.label, /Fix Extraction First/);
    // Same rule: the reason must name a remedy the user can actually perform.
    assert.match(decision.reason, /clearer, text-based copy/);
  });

  it("resumable analysis shows Resume AI Analyze when extraction is ready", () => {
    const decision = resolveTenderNextAction({
      ...base,
      resumableAnalysisAvailable: true,
      aiAnalysis: { exists: false },
    });
    assert.equal(decision.primary, "RESUME_AI_ANALYZE");
    assert.match(decision.label, /Resume AI Analyze/);
  });

  it("regex fallback weak extraction does not show final-approved wording", () => {
    const decision = resolveTenderNextAction({
      ...base,
      aiAnalysis: { exists: true, trusted: false, status: "REGEX_FALLBACK_FROM_WEAK_EXTRACTION", regexFallback: true },
      requirements: { rawCount: 13, trustedTracedCount: 0, mandatoryCount: 6, mandatoryTracedCount: 0 },
    });
    assert.equal(decision.primary, "REVIEW_REQUIREMENTS");
    assert.match(decision.reason, /draft-only/);
    assert.doesNotMatch(decision.reason, /approved as sufficient/i);
  });

  it("raw vs trusted requirements are displayed separately", () => {
    const decision = resolveTenderNextAction({
      ...base,
      requirements: { rawCount: 13, trustedTracedCount: 1, mandatoryCount: 6, mandatoryTracedCount: 0 },
    });
    assert.equal(decision.primary, "REVIEW_REQUIREMENTS");
    assert.deepEqual(decision.rawVsTrustedRequirements, {
      raw: 13,
      trusted: 1,
      mandatory: 6,
      mandatoryTraced: 0,
    });
  });

  it("stale or missing documents are not treated as export ready", () => {
    const decision = resolveTenderNextAction({
      ...base,
      documents: { current: false, hasGeneratedDocuments: true, stale: true },
    });
    assert.equal(decision.primary, "GENERATE_DOCUMENTS");
    assert.match(decision.label, /stale/i);
    assert.notEqual(decision.tone, "green");
  });
});

describe("hasResumableAiAnalyzeCheckpoint", () => {
  it("treats PARTIAL_SUCCESS jobs as resumable", () => {
    assert.equal(hasResumableAiAnalyzeCheckpoint({ status: "PARTIAL_SUCCESS", succeededChunkCount: 0 }), true);
  });

  it("treats FAILED jobs as resumable only when a successful chunk checkpoint exists", () => {
    assert.equal(hasResumableAiAnalyzeCheckpoint({ status: "FAILED", succeededChunkCount: 2 }), true);
    assert.equal(hasResumableAiAnalyzeCheckpoint({ status: "FAILED", succeededChunkCount: 0 }), false);
    assert.equal(hasResumableAiAnalyzeCheckpoint({ status: "FAILED", succeededChunkCount: null }), false);
  });
});

describe("visible wording contract", () => {
  it("analysis panel uses draft-only regex fallback wording", () => {
    const source = readFileSync(resolve(process.cwd(), "components/analysis-quality-panel.tsx"), "utf8");
    assert.match(source, /Approved for draft review only/);
    assert.doesNotMatch(source, /approved it as sufficient/i);
  });

  it("next action panel exposes Fix Extraction First and raw/trusted requirement split", () => {
    const source = readFileSync(resolve(process.cwd(), "components/next-action-panel.tsx"), "utf8");
    assert.match(source, /Fix Extraction First/);
    // The panel now consumes the canonical workflow decision, which exposes
    // the mandatory-traced / compliance-rows / FULL-SUBSTANTIAL-coverage counts.
    // These replace the old raw-vs-trusted split with a more accurate
    // gate-aligned grounding view (same UX intent — surface requirement trust).
    assert.match(source, /Requirement trust split/);
    assert.match(source, /mandatoryTracedCount/);
    assert.match(source, /mandatoryComplianceRowsCount/);
    assert.match(source, /mandatoryFullOrSubstantialCoverageCount/);
  });

  it("next action panel delegates partial-AI / resumable-analysis detection to the canonical decision (no local truth)", () => {
    const source = readFileSync(resolve(process.cwd(), "components/next-action-panel.tsx"), "utf8");
    // The panel MUST NOT query AiJob directly — that was the screenshot
    // contradiction bug (local truth diverged from the snapshot's analysis
    // state machine). Partial-AI / resumable detection now lives in
    // getCanonicalTenderWorkflowDecision → getTenderReleaseSnapshot →
    // resolveTenderAnalysisState (the canonical analysis state machine).
    assert.match(source, /getCanonicalTenderWorkflowDecision/);
    assert.doesNotMatch(source, /resolveCurrentAnalysisBinding/);
    assert.doesNotMatch(source, /prisma\.aiJob\.findFirst/);
    assert.doesNotMatch(source, /hasResumableAiAnalyzeCheckpoint/);
    // The canonical decision's screenshot-fixture behavior is verified in
    // tests/canonical-workflow-truth-precondition-gates.test.ts:
    //   - partial AI → nextRequiredAction = RESUME_AI_ANALYZE
    //   - stale AI → nextRequiredAction = RUN_AI_ANALYZE (re-run)
    //   - downstream stages BLOCKED_BY_PRIOR_STEP
  });

  it("untrusted sector warning is visible in the analysis quality panel", () => {
    const source = readFileSync(resolve(process.cwd(), "components/analysis-quality-panel.tsx"), "utf8");
    assert.match(source, /Sector inferred from untrusted analysis/);
  });
});
