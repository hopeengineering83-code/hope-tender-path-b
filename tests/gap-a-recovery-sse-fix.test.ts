// Gap A regression: AI Analyze dispatch must use ?mode=background, NOT SSE.
//
// components/tender-recovery-command-center.tsx (this file's original
// subject for the runDurableAnalyze checks below) was deleted as unrendered
// dead code (nothing imports or renders it). components/ai-analyze-panel.tsx
// is the live, rendered panel that owns AI Analyze dispatch today, via its
// handleBackgroundAnalyze/pollJob functions — it implements the identical
// durable-background contract, so those assertions are redirected there.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
const read = (p: string) => readFileSync(p, "utf8");

describe("Gap A — AI Analyze dispatch uses durable background, not SSE", () => {

  it("lib/recovery-command-actions.ts: ALL ai-analyze paths include ?mode=background", () => {
    const src = read("lib/recovery-command-actions.ts");
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("/ai-analyze") && lines[i].includes("path:")) {
        assert.match(
          lines[i],
          /mode=background/,
          `Line ${i + 1}: AI Analyze path must include ?mode=background: ${lines[i].trim()}`,
        );
      }
    }
  });

  it("lib/recovery-command-actions.ts: NO ai-analyze path uses bare endpoint without ?mode=background", () => {
    const src = read("lib/recovery-command-actions.ts");
    // Find all ai-analyze paths
    const matches = src.match(/path:\s*"\/api\/tenders\/\{tenderId\}\/ai-analyze[^"]*"/g) ?? [];
    for (const m of matches) {
      assert.match(m, /mode=background/, `Path without ?mode=background: ${m}`);
    }
  });

  it("components/ai-analyze-panel.tsx: does NOT use Accept: text/event-stream", () => {
    const src = read("components/ai-analyze-panel.tsx");
    assert.ok(
      !/Accept.*text\/event-stream/.test(src),
      "AI Analyze panel must NOT use Accept: text/event-stream (direct SSE)",
    );
  });

  it("components/ai-analyze-panel.tsx: does NOT call runStreamingAnalyze", () => {
    const src = read("components/ai-analyze-panel.tsx");
    assert.ok(
      !/runStreamingAnalyze/.test(src),
      "AI Analyze panel must NOT call runStreamingAnalyze (the old SSE handler)",
    );
  });

  it("components/ai-analyze-panel.tsx: calls handleBackgroundAnalyze which posts ?mode=background", () => {
    const src = read("components/ai-analyze-panel.tsx");
    assert.match(src, /function handleBackgroundAnalyze/);
    assert.match(src, /\/ai-analyze\?mode=background/);
  });

  it("components/ai-analyze-panel.tsx: handleBackgroundAnalyze enqueues via POST and expects 202 (not SSE)", () => {
    const src = read("components/ai-analyze-panel.tsx");
    const block = src.slice(src.indexOf("async function handleBackgroundAnalyze"), src.indexOf("async function pollJob"));
    // Must POST to the ?mode=background path
    assert.match(block, /method:\s*"POST"/);
    // Must expect 202
    assert.match(block, /res\.status !== 202/);
    // Must NOT use text/event-stream
    assert.ok(!/text\/event-stream/.test(block), "handleBackgroundAnalyze must NOT use SSE");
  });

  it("components/ai-analyze-panel.tsx: pollJob polls /api/ai-jobs/", () => {
    const src = read("components/ai-analyze-panel.tsx");
    const block = src.slice(src.indexOf("async function pollJob"));
    assert.match(block, /\/api\/ai-jobs\/\$\{jobId\}/);
  });

  it("components/ai-analyze-panel.tsx: surfaces worker 401/403/500 errors", () => {
    const src = read("components/ai-analyze-panel.tsx");
    const block = src.slice(src.indexOf("async function handleBackgroundAnalyze"), src.indexOf("async function pollJob"));
    assert.match(block, /workerRes\.status === 401/, "must handle worker 401");
    assert.match(block, /workerRes\.status === 403/, "must handle worker 403");
    assert.match(block, /workerRes\.status >= 500/, "must handle worker 500");
  });
});
