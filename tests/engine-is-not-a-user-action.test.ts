import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

import { getTenderAction, listTenderActions } from "../lib/ui/action-registry";

const links = readFileSync("components/workflow-step-links.tsx", "utf8");
const automaticPipeline = readFileSync("lib/ai-jobs/automatic-tender-pipeline.ts", "utf8");
const engineContinuation = readFileSync("lib/ai-jobs/engine-continuation-service.ts", "utf8");

describe("automatic tender workflow action contract", () => {
  it("AI Analyze is recovery-only and not owned by workflow navigation", () => {
    const action = getTenderAction("AI_ANALYZE");
    assert.equal(action.availability, "RECOVERY");
    assert.equal(action.owner, "AiAnalyzeRecoveryPanel");
    assert.equal(action.mutation, null);
    assert.doesNotMatch(links, /manual-ai-analyze/);
    assert.doesNotMatch(links, /runManualAction/);
  });

  it("Run Engine is recovery-only and not a routine workflow button", () => {
    const action = getTenderAction("RUN_ENGINE");
    assert.equal(action.availability, "RECOVERY");
    assert.equal(action.owner, "RecoveryCommandCenter");
    assert.equal(action.mutation, null);
    assert.doesNotMatch(links, /\/api\/tenders\/.*\/engine/);
    assert.doesNotMatch(links, /wakeWorker/);
  });

  it("Build Plan and generation are automatic status surfaces", () => {
    const plan = getTenderAction("BUILD_SUBMISSION_PLAN");
    const generation = getTenderAction("GENERATE_REQUIRED_DOCUMENTS");
    assert.equal(plan.availability, "NAVIGATION");
    assert.equal(plan.mutation, null);
    assert.equal(generation.availability, "NAVIGATION");
    assert.equal(generation.mutation, null);
  });

  it("upload is the only normal POST workflow action", () => {
    const normalPostActions = listTenderActions()
      .filter(([, action]) => action.availability === "NORMAL" && action.mutation?.startsWith("POST "))
      .map(([id]) => id)
      .sort();
    assert.deepEqual(normalPostActions, ["UPLOAD_TENDER_FILES"]);
  });

  it("automatic extraction arms analysis without a manual gate", () => {
    assert.match(automaticPipeline, /status:\s*"QUEUED"/);
    assert.match(automaticPipeline, /autoContinue:\s*true/);
    assert.match(automaticPipeline, /manualRequested:\s*false/);
    assert.doesNotMatch(automaticPipeline, /manualGate:\s*"AI_ANALYZE"/);
    assert.doesNotMatch(automaticPipeline, /status:\s*"CANCELED"/);
  });

  it("successful analysis authorizes automatic Engine continuation", () => {
    assert.match(engineContinuation, /parseInput\(analysis\.input\)\.autoContinue !== true/);
    assert.match(engineContinuation, /jobType: "ENGINE_RUN"/);
    assert.match(engineContinuation, /status: "QUEUED"/);
    assert.match(engineContinuation, /autoContinue: true/);
    assert.match(engineContinuation, /source: "canonical-ai-analysis-success"/);
  });
});
