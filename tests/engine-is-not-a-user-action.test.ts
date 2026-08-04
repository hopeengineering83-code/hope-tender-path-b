import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

import { getTenderAction, listTenderActions } from "../lib/ui/action-registry";

const links = readFileSync("components/workflow-step-links.tsx", "utf8");
const automaticPipeline = readFileSync("lib/ai-jobs/automatic-tender-pipeline.ts", "utf8");
const engineEnqueue = readFileSync("lib/engine/enqueue-engine-job.ts", "utf8");

describe("two-action tender workflow contract", () => {
  it("AI Analyze is an explicit normal action with one owner", () => {
    const action = getTenderAction("AI_ANALYZE");
    assert.equal(action.availability, "NORMAL");
    assert.equal(action.owner, "WorkflowStepLinks");
    assert.equal(action.mutation, "POST /api/tenders/:id/manual-ai-analyze");
    assert.match(links, /manual-ai-analyze/);
    assert.match(links, />AI Analyze</);
  });

  it("Run Engine is the second explicit normal action with one owner", () => {
    const action = getTenderAction("RUN_ENGINE");
    assert.equal(action.availability, "NORMAL");
    assert.equal(action.owner, "WorkflowStepLinks");
    assert.equal(action.mutation, "POST /api/tenders/:id/engine");
    assert.match(links, /\/engine`/);
    assert.match(links, />Run Engine</);
  });

  it("Build Plan and generation are automatic status surfaces", () => {
    const plan = getTenderAction("BUILD_SUBMISSION_PLAN");
    const generation = getTenderAction("GENERATE_REQUIRED_DOCUMENTS");
    assert.equal(plan.availability, "NAVIGATION");
    assert.equal(plan.mutation, null);
    assert.equal(generation.availability, "NAVIGATION");
    assert.equal(generation.mutation, null);
  });

  it("only AI Analyze and Run Engine are normal POST workflow actions after upload", () => {
    const normalPostActions = listTenderActions()
      .filter(([, action]) => action.availability === "NORMAL" && action.mutation?.startsWith("POST "))
      .map(([id]) => id)
      .sort();
    assert.deepEqual(normalPostActions, ["AI_ANALYZE", "RUN_ENGINE", "UPLOAD_TENDER_FILES"]);
  });

  it("automatic extraction parks analysis until the explicit action", () => {
    assert.match(automaticPipeline, /manualGate:\s*"AI_ANALYZE"/);
    assert.match(automaticPipeline, /status:\s*"CANCELED"/);
    assert.match(automaticPipeline, /autoContinue:\s*false/);
  });

  it("explicit Run Engine authorizes automatic downstream continuation", () => {
    assert.match(engineEnqueue, /manualRequested:\s*true/);
    assert.match(engineEnqueue, /autoContinue:\s*true/);
  });
});
