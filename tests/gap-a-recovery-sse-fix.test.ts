import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { getTenderAction } from "../lib/ui/action-registry";
import { getRecoveryCommandActionSpec } from "../lib/recovery-command-actions";

const read = (path: string) => readFileSync(path, "utf8");

describe("AI Analyze normal flow uses automatic durable workers, not SSE or manual dispatch", () => {
  it("the canonical registry exposes status navigation only", () => {
    const action = getTenderAction("AI_ANALYZE");
    const recovery = getRecoveryCommandActionSpec("AI_ANALYZE");
    assert.equal(action.mutation, null);
    assert.equal(action.owner, "AIAnalyzePanel");
    assert.equal(recovery?.kind, "scroll");
    assert.equal(recovery?.anchorId, "ai-analyze-section");
    assert.equal(recovery?.method, undefined);
  });

  it("the normal workflow owner never posts or streams AI analysis", () => {
    const owner = read("components/workflow-step-links.tsx");
    assert.doesNotMatch(owner, /manual-ai-analyze/);
    assert.doesNotMatch(owner, /method:\s*"POST"/);
    assert.doesNotMatch(owner, /run-next\?jobType/);
    assert.doesNotMatch(owner, /text\/event-stream|getReader\(\)/);
    assert.match(owner, /Processing automatically/);
  });

  it("the compatibility manual route remains durable but outside the normal UI", () => {
    const route = read("app/api/tenders/[id]/manual-ai-analyze/route.ts");
    const owner = read("components/workflow-step-links.tsx");
    assert.match(route, /createAnalysisJob/);
    assert.match(route, /jobId: analysis\.jobId/);
    assert.match(route, /statusEndpoint: `\/api\/ai-jobs\/\$\{analysis\.jobId\}`/);
    assert.match(route, /status:\s*202/);
    assert.doesNotMatch(owner, /manual-ai-analyze/);
  });

  it("the rendered analysis panel is status-only and does not use SSE", () => {
    const panel = read("components/ai-analyze-panel.tsx");
    assert.doesNotMatch(panel, /Accept.*text\/event-stream/);
    assert.doesNotMatch(panel, /runStreamingAnalyze|getReader\(\)/);
    assert.doesNotMatch(panel, /method:\s*"POST"/);
    assert.match(panel, /\/api\/ai-jobs\/\$\{initialContinueJobId\}/);
  });

  it("provider diagnostics are read-only and errors remain visible", () => {
    const panel = read("components/ai-analyze-panel.tsx");
    assert.match(panel, /\/api\/ai-providers\/diagnostics\?live=1/);
    assert.match(panel, /setError\(/);
    assert.match(panel, /role="alert"|AI Analyze did not complete/);
  });
});
