import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
const read = (path: string) => readFileSync(path, "utf8");

describe("AI Analyze dispatch uses the explicit durable route, not SSE", () => {
  it("the canonical registry points to manual-ai-analyze", () => {
    const registry = read("lib/ui/action-registry.ts");
    assert.match(registry, /POST \/api\/tenders\/:id\/manual-ai-analyze/);
    assert.doesNotMatch(registry, /AI_ANALYZE:[\s\S]*?ai-analyze\?mode=background/);
  });

  it("the normal UI owner posts the durable route", () => {
    const owner = read("components/workflow-step-links.tsx");
    assert.match(owner, /\/api\/tenders\/\$\{tenderId\}\/manual-ai-analyze/);
    assert.match(owner, /method:\s*"POST"/);
    assert.match(owner, /run-next\?jobType=\$\{jobType\}/);
  });

  it("the manual route returns a durable job reference", () => {
    const route = read("app/api/tenders/[id]/manual-ai-analyze/route.ts");
    assert.match(route, /createAnalysisJob/);
    assert.match(route, /jobId: analysis\.jobId/);
    assert.match(route, /statusEndpoint: `\/api\/ai-jobs\/\$\{analysis\.jobId\}`/);
    assert.match(route, /status:\s*202/);
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
