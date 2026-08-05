import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

import { getTenderAction, listTenderActions } from "../lib/ui/action-registry";

const links = readFileSync("components/workflow-step-links.tsx", "utf8");
const automaticPipeline = readFileSync("lib/ai-jobs/automatic-tender-pipeline.ts", "utf8");
const engineEnqueue = readFileSync("lib/engine/enqueue-engine-job.ts", "utf8");
const handlers = readFileSync("lib/ai-job-handlers.ts", "utf8");

describe("automatic tender workflow contract", () => {
  it("AI Analyze is recovery-only with one owner", () => {
    const action = getTenderAction("AI_ANALYZE");
    assert.equal(action.availability, "RECOVERY");
    assert.equal(action.owner, "WorkflowStepLinksRecovery");
    assert.equal(action.mutation, "POST /api/tenders/:id/manual-ai-analyze");
    assert.match(links, /Diagnostics and recovery/);
    assert.match(links, /Retry AI analysis/);
  });

  it("Run Engine is recovery-only with one owner", () => {
    const action = getTenderAction("RUN_ENGINE");
    assert.equal(action.availability, "RECOVERY");
    assert.equal(action.owner, "WorkflowStepLinksRecovery");
    assert.equal(action.mutation, "POST /api/tenders/:id/engine");
    assert.match(links, /Retry Engine/);
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

  it("automatic extraction leaves analysis runnable", () => {
    assert.match(automaticPipeline, /status:\s*"QUEUED"/);
    assert.match(automaticPipeline, /manualRequested:\s*false/);
    assert.match(automaticPipeline, /autoContinue:\s*true/);
    assert.doesNotMatch(automaticPipeline, /manualGate:\s*"AI_ANALYZE"/);
    assert.doesNotMatch(automaticPipeline, /status:\s*"CANCELED"/);
  });

  it("successful automatic analysis authorizes automatic Engine continuation", () => {
    assert.match(handlers, /AUTOMATIC_POST_ANALYSIS_CONTINUATION/);
    assert.match(engineEnqueue, /manualRequested = input\.manualRequested/);
    assert.match(engineEnqueue, /AUTOMATIC_ENGINE_CONTINUATION/);
    assert.match(engineEnqueue, /autoContinue:\s*true/);
  });
});
