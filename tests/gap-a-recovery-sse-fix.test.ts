// Gap A regression: RecoveryCommandCenter must use ?mode=background, NOT SSE.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
const read = (p: string) => readFileSync(p, "utf8");

describe("Gap A — RecoveryCommandCenter uses durable background, not SSE", () => {

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

  it("components/tender-recovery-command-center.tsx: does NOT use Accept: text/event-stream", () => {
    const src = read("components/tender-recovery-command-center.tsx");
    assert.ok(
      !/Accept.*text\/event-stream/.test(src),
      "RecoveryCommandCenter must NOT use Accept: text/event-stream (direct SSE)",
    );
  });

  it("components/tender-recovery-command-center.tsx: does NOT call runStreamingAnalyze", () => {
    const src = read("components/tender-recovery-command-center.tsx");
    assert.ok(
      !/runStreamingAnalyze/.test(src),
      "RecoveryCommandCenter must NOT call runStreamingAnalyze (the old SSE handler)",
    );
  });

  it("components/tender-recovery-command-center.tsx: calls runDurableAnalyze for ai-analyze actions", () => {
    const src = read("components/tender-recovery-command-center.tsx");
    assert.match(src, /runDurableAnalyze/);
    assert.match(src, /spec\.path\.includes\("\/ai-analyze"\)/);
  });

  it("components/tender-recovery-command-center.tsx: runDurableAnalyze enqueues via POST (not SSE)", () => {
    const src = read("components/tender-recovery-command-center.tsx");
    const block = src.slice(src.indexOf("async function runDurableAnalyze"), src.indexOf("async function executeAction"));
    // Must POST to the path (which includes ?mode=background)
    assert.match(block, /fetch\(path,\s*\{\s*method:\s*"POST"\s*\}\)/);
    // Must expect 202
    assert.match(block, /enqueueRes\.status !== 202/);
    // Must poll /api/ai-jobs/
    assert.match(block, /\/api\/ai-jobs\/\$\{jobId\}/);
    // Must NOT use text/event-stream
    assert.ok(!/text\/event-stream/.test(block), "runDurableAnalyze must NOT use SSE");
  });

  it("components/tender-recovery-command-center.tsx: surfaces worker 401/403/500 errors", () => {
    const src = read("components/tender-recovery-command-center.tsx");
    const block = src.slice(src.indexOf("async function runDurableAnalyze"), src.indexOf("async function executeAction"));
    assert.match(block, /workerRes\.status === 401/, "must handle worker 401");
    assert.match(block, /workerRes\.status === 403/, "must handle worker 403");
    assert.match(block, /workerRes\.status >= 500/, "must handle worker 500");
  });
});
