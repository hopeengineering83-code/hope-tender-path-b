import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("real Preview Engine worker budget", () => {
  it("leaves enough bounded runtime for Build Plan and downstream persistence", () => {
    const route = readFileSync("app/api/ai-jobs/run-next/route.ts", "utf8");
    assert.match(route, /export const maxDuration = 300/);
    assert.match(route, /const maxRunMs = 240_000/);
    assert.match(route, /absoluteDeadline = startTime \+ maxRunMs/);
    assert.doesNotMatch(route, /export const maxDuration = 60/);
  });

  it("propagates the request deadline into the expensive Engine implementation", () => {
    const handler = readFileSync("lib/ai-job-handlers-legacy.ts", "utf8");
    assert.match(handler, /ctx\.input\?\.absoluteDeadline/);
    assert.match(handler, /\{ safe: safeMode, skipAiRematch, maxChars, deadlineAt \}/);
  });
});

describe("generation readiness follows canonical workflow truth", () => {
  it("suppresses legacy readiness diagnoses whenever canonical workflow is blocked", () => {
    const route = readFileSync("app/api/tenders/[id]/generation-readiness/route.ts", "utf8");
    assert.match(route, /getCanonicalTenderWorkflowDecision/);
    assert.match(route, /canonicalBlocksGeneration/);
    assert.match(route, /fullProposalBlockers = canonicalBlocksGeneration/);
    assert.match(route, /currentBlockingStage: workflowDecision\?\.currentBlockingStage/);
  });
});
