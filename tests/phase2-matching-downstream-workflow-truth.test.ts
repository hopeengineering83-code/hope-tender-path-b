import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  describeMatchingEngineState,
  selectCurrentDownstreamActivity,
  type CanonicalDownstreamPresentationState,
  type CurrentEnginePresentationState,
} from "../lib/engine/workflow-panel-presentation";

const ENGINE_COMPLETE: CurrentEnginePresentationState = {
  analysisCurrent: true,
  engineRunning: false,
  engineComplete: true,
  engineFailed: false,
  canRunEngine: false,
  activeJob: null,
};

function downstream(
  overrides: Partial<CanonicalDownstreamPresentationState> = {},
): CanonicalDownstreamPresentationState {
  return {
    nextRequiredAction: "FIX_EXPORT_BLOCKERS",
    nextRequiredActionLabel: "Resolve workflow blocker",
    nextRequiredActionReason: "The canonical workflow is paused.",
    currentBlockingStage: "EXPORT_BLOCKED",
    downstreamSuppressedBy: "EXPORT_BLOCKED",
    finalExportAllowed: false,
    activeJob: null,
    ...overrides,
  };
}

describe("Phase 2 matching presentation combines Engine and canonical downstream truth", () => {
  it("pauses on the canonical source-evidence blocker", () => {
    const message = describeMatchingEngineState(ENGINE_COMPLETE, true, downstream({
      nextRequiredAction: "LINK_VAULT_EVIDENCE",
      nextRequiredActionLabel: "Source evidence required",
      nextRequiredActionReason: "Automatic matching found FULL/SUBSTANTIAL coverage for 2/4 mandatory requirements.",
      currentBlockingStage: "MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE",
      downstreamSuppressedBy: "MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE",
    }));
    assert.match(message, /Engine complete/);
    assert.match(message, /paused — source evidence required/);
    assert.match(message, /2\/4 mandatory requirements/);
    assert.doesNotMatch(message, /continu(?:es|ing) automatically/);
  });

  it("reports a genuinely queued downstream job", () => {
    const message = describeMatchingEngineState(ENGINE_COMPLETE, true, downstream({
      nextRequiredAction: "AUTOMATIC_PROCESSING",
      activeJob: { jobType: "PROPOSAL_GENERATION", status: "QUEUED" },
    }));
    assert.match(message, /queued/);
    assert.doesNotMatch(message, /is running/);
  });

  it("reports a genuinely running downstream job", () => {
    const message = describeMatchingEngineState(ENGINE_COMPLETE, true, downstream({
      nextRequiredAction: "AUTOMATIC_PROCESSING",
      activeJob: { jobType: "AUTO_FINALIZE", status: "RUNNING" },
    }));
    assert.match(message, /continuing automatically/);
    assert.doesNotMatch(message, /queued/);
  });

  it("uses the canonical legal-authority action and reason", () => {
    const message = describeMatchingEngineState(ENGINE_COMPLETE, true, downstream({
      nextRequiredAction: "FIX_EXPORT_BLOCKERS",
      nextRequiredActionLabel: "Authorized signature required",
      nextRequiredActionReason: "An authorized signatory must approve the declaration.",
      currentBlockingStage: "AUTHORITY_OR_QUALITY_BLOCKERS",
    }));
    assert.match(message, /paused — authorized signature required/);
    assert.match(message, /authorized signatory must approve the declaration/);
  });

  it("uses the canonical quality, integrity, or security blocker", () => {
    const message = describeMatchingEngineState(ENGINE_COMPLETE, true, downstream({
      nextRequiredActionLabel: "Resolve source integrity failure",
      nextRequiredActionReason: "The canonical source hash no longer matches the persisted bytes.",
      currentBlockingStage: "EXTRACTION_UNSAFE",
    }));
    assert.match(message, /resolve source integrity failure/);
    assert.match(message, /source hash no longer matches/);
  });

  it("reports export-ready completion without claiming active processing", () => {
    const message = describeMatchingEngineState(ENGINE_COMPLETE, true, downstream({
      nextRequiredAction: "EXPORT_READY",
      nextRequiredActionLabel: "Export ready",
      nextRequiredActionReason: "All gates pass.",
      currentBlockingStage: "EXPORT_ZIP_READY",
      downstreamSuppressedBy: null,
      finalExportAllowed: true,
    }));
    assert.match(message, /complete and export ready/);
    assert.doesNotMatch(message, /processing/);
  });

  it("reports a fully completed workflow with no active work", () => {
    const message = describeMatchingEngineState(ENGINE_COMPLETE, true, downstream({
      nextRequiredAction: "WORKFLOW_COMPLETE",
      nextRequiredActionLabel: "Workflow complete",
      nextRequiredActionReason: "No further work is required.",
      currentBlockingStage: "EXPORT_ZIP_READY",
      downstreamSuppressedBy: null,
      finalExportAllowed: true,
    }));
    assert.equal(message, "Engine complete. Workflow is fully complete.");
  });

  it("keeps Engine QUEUED distinct from RUNNING", () => {
    const message = describeMatchingEngineState({
      ...ENGINE_COMPLETE,
      engineComplete: false,
      engineRunning: true,
      activeJob: { status: "QUEUED", createdAt: new Date().toISOString() },
    }, false, null);
    assert.match(message, /queued/);
    assert.doesNotMatch(message, /is running/);
  });

  it("reports Engine RUNNING", () => {
    const message = describeMatchingEngineState({
      ...ENGINE_COMPLETE,
      engineComplete: false,
      engineRunning: true,
      activeJob: { status: "RUNNING", createdAt: new Date().toISOString() },
    }, false, null);
    assert.match(message, /Engine is running/);
  });

  it("reports current-revision Engine failure", () => {
    const message = describeMatchingEngineState({
      ...ENGINE_COMPLETE,
      engineComplete: false,
      engineFailed: true,
      blocker: "The current Engine job failed its integrity precondition.",
    }, true, null);
    assert.equal(message, "The current Engine job failed its integrity precondition.");
  });

  it("does not treat an older-revision Engine success as current", () => {
    const message = describeMatchingEngineState({
      ...ENGINE_COMPLETE,
      engineComplete: false,
      canRunEngine: true,
    }, true, downstream({ nextRequiredAction: "AUTOMATIC_PROCESSING" }));
    assert.match(message, /Run Engine/);
    assert.doesNotMatch(message, /Engine complete/);
  });

  it("fails closed when the canonical workflow decision is unavailable", () => {
    const message = describeMatchingEngineState(ENGINE_COMPLETE, true, null);
    assert.equal(message, "Engine is complete. Checking the current downstream workflow state.");
    assert.doesNotMatch(message, /continu(?:es|ing) automatically/);
  });

  it("honors canonical automatic-processing truth even between active jobs", () => {
    const message = describeMatchingEngineState(ENGINE_COMPLETE, true, downstream({
      nextRequiredAction: "AUTOMATIC_PROCESSING",
      nextRequiredActionLabel: "Processing automatically",
      nextRequiredActionReason: "The durable worker owns this stage.",
    }));
    assert.match(message, /continuing automatically/);
    assert.match(message, /durable worker owns this stage/);
  });

  it("observes only queued/running successors bound to the current source revision", () => {
    const selected = selectCurrentDownstreamActivity("current-revision", [
      {
        jobType: "PROPOSAL_GENERATION",
        status: "RUNNING",
        analysisInputHash: "old-revision",
        input: "{}",
      },
      {
        jobType: "AUTO_FINALIZE",
        status: "QUEUED",
        analysisInputHash: null,
        input: JSON.stringify({ analysisRevision: "current-revision" }),
      },
    ]);
    assert.deepEqual(selected, { jobType: "AUTO_FINALIZE", status: "QUEUED" });
  });

  it("does not surface an old-revision or terminal downstream job", () => {
    assert.equal(selectCurrentDownstreamActivity("current-revision", [
      {
        jobType: "PROPOSAL_GENERATION",
        status: "RUNNING",
        analysisInputHash: "old-revision",
        input: "{}",
      },
      {
        jobType: "AUTO_FINALIZE",
        status: "SUCCEEDED",
        analysisInputHash: null,
        input: JSON.stringify({ analysisRevision: "current-revision" }),
      },
    ]), null);
  });
});
