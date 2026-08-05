import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const pipeline = readFileSync("lib/ai-jobs/automatic-tender-pipeline.ts", "utf8");
const extraction = readFileSync("lib/ai-jobs/tender-extraction-service.ts", "utf8");
const worker = readFileSync("app/api/ai-jobs/run-next/route.ts", "utf8");
const golden = readFileSync("e2e/golden-tender-workflow.spec.ts", "utf8");

describe("automatic tender continuation contract", () => {
  it("leaves the revision-bound AI Analyze job runnable after extraction", () => {
    assert.match(pipeline, /autoContinue:\s*true/);
    assert.match(pipeline, /automaticContinuation:\s*true/);
    assert.match(pipeline, /manualRequested:\s*false/);
    assert.doesNotMatch(pipeline, /status:\s*"CANCELED"/);
    assert.doesNotMatch(pipeline, /MANUAL_ACTION_REQUIRED/);
    assert.doesNotMatch(pipeline, /manualGate:\s*"AI_ANALYZE"/);
  });

  it("preserves the durable extraction-to-analysis handoff", () => {
    assert.match(extraction, /queueAutomaticTenderPipeline/);
    assert.match(extraction, /reason:\s*"AI_ANALYZE_QUEUED"/);
    assert.match(extraction, /analysisJobId:\s*continuation\.jobId/);
  });

  it("keeps all downstream stages owned by the durable worker", () => {
    assert.match(worker, /claimed\.jobType === "AI_ANALYZE"/);
    assert.match(worker, /nextJobType = "ENGINE_RUN"/);
    assert.match(worker, /claimed\.jobType === "ENGINE_RUN"/);
    assert.match(worker, /nextJobType = "PROPOSAL_GENERATION"/);
    assert.match(worker, /claimed\.jobType === "PROPOSAL_GENERATION"/);
    assert.match(worker, /nextJobType = "AUTO_FINALIZE"/);
  });

  it("proves the normal browser flow does not call the manual Analyze route", () => {
    assert.doesNotMatch(golden, /\/api\/tenders\/\$\{tenderId\}\/ai-analyze/);
    assert.match(golden, /await page\.close\(\)/);
    assert.match(golden, /\/api\/ai-jobs\/run-next\?jobType=AI_ANALYZE/);
    assert.match(golden, /status\)\.not\.toBe\("CANCELED"\)/);
  });
});
