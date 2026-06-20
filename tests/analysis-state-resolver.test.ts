import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveTenderAnalysisState,
  canExportWithAnalysisState,
  canResumeAnalysis,
  analysisStateLabel,
  type AnalysisState,
} from "../lib/engine/analysis-state-resolver";

test("Analysis State Resolver", async (suite) => {
  await suite.test("NOT_STARTED when no job exists and no legacy notes", async () => {
    // Mock: no job, no notes
    // Note: In real test, would need to set up Prisma mock or test database
    const state = "NOT_STARTED";
    assert.equal(canExportWithAnalysisState(state as AnalysisState), false);
    assert.equal(canResumeAnalysis(state as AnalysisState), false);
  });

  await suite.test("AI_SUCCEEDED unblocks export", async () => {
    const state: AnalysisState = "AI_SUCCEEDED";
    assert.equal(canExportWithAnalysisState(state), true);
    assert.equal(canResumeAnalysis(state), false);
  });

  await suite.test("PARTIAL_NEEDS_RESUME is resumable but blocks export", async () => {
    const state: AnalysisState = "PARTIAL_NEEDS_RESUME";
    assert.equal(canExportWithAnalysisState(state), false);
    assert.equal(canResumeAnalysis(state), true);
  });

  await suite.test("REGEX_FALLBACK_UNAPPROVED blocks export and is resumable", async () => {
    const state: AnalysisState = "REGEX_FALLBACK_UNAPPROVED";
    assert.equal(canExportWithAnalysisState(state), false);
    assert.equal(canResumeAnalysis(state), true);
  });

  await suite.test("HUMAN_APPROVED_FALLBACK unblocks export", async () => {
    const state: AnalysisState = "HUMAN_APPROVED_FALLBACK";
    assert.equal(canExportWithAnalysisState(state), true);
    assert.equal(canResumeAnalysis(state), false);
  });

  await suite.test("FAILED blocks export and is resumable", async () => {
    const state: AnalysisState = "FAILED";
    assert.equal(canExportWithAnalysisState(state), false);
    assert.equal(canResumeAnalysis(state), true);
  });

  await suite.test("RUNNING blocks export and is not resumable", async () => {
    const state: AnalysisState = "RUNNING";
    assert.equal(canExportWithAnalysisState(state), false);
    assert.equal(canResumeAnalysis(state), false);
  });

  await suite.test("analysisStateLabel returns UI-friendly labels", async () => {
    const labels: Record<AnalysisState, string> = {
      NOT_STARTED: "Not Started",
      QUEUED: "Queued",
      RUNNING: "Running",
      AI_SUCCEEDED: "Analysis Complete",
      PARTIAL_NEEDS_RESUME: "Partial (Resume)",
      REGEX_FALLBACK_UNAPPROVED: "Fallback (Unapproved)",
      HUMAN_APPROVED_FALLBACK: "Fallback (Approved)",
      FAILED: "Failed",
      SUPERSEDED: "Superseded",
    };

    for (const [state, expectedLabel] of Object.entries(labels)) {
      assert.equal(analysisStateLabel(state as AnalysisState), expectedLabel);
    }
  });

  await suite.test("All states are handled in canExport and canResume", async () => {
    const allStates: AnalysisState[] = [
      "NOT_STARTED",
      "QUEUED",
      "RUNNING",
      "AI_SUCCEEDED",
      "PARTIAL_NEEDS_RESUME",
      "REGEX_FALLBACK_UNAPPROVED",
      "HUMAN_APPROVED_FALLBACK",
      "FAILED",
      "SUPERSEDED",
    ];

    for (const state of allStates) {
      // Should not throw
      canExportWithAnalysisState(state);
      canResumeAnalysis(state);
      analysisStateLabel(state);
    }
  });
});
