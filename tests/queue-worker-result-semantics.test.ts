import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("Queue worker result semantics", () => {
  it("run-next returns terminalStatus at top level", () => {
    const src = read("app/api/ai-jobs/run-next/route.ts");
    assert.ok(src.includes("terminalStatus: worst.terminalStatus"), "response must include top-level terminalStatus");
  });

  it("run-next response includes resultCode at top level", () => {
    const src = read("app/api/ai-jobs/run-next/route.ts");
    assert.ok(src.includes("resultCode: worst.resultCode"), "response must include top-level resultCode");
  });

  it("run-next response includes retryable at top level", () => {
    const src = read("app/api/ai-jobs/run-next/route.ts");
    assert.ok(src.includes("retryable: Boolean(worst.retryable)"), "response must include top-level retryable");
  });

  it("run-next response includes workerNotice", () => {
    const src = read("app/api/ai-jobs/run-next/route.ts");
    assert.ok(src.includes("workerNotice") && src.includes("HTTP 200 indicates the worker ran, NOT that the job succeeded"), "must include workerNotice");
  });

  it("run-next empty queue response includes resultCode QUEUE_EMPTY", () => {
    const src = read("app/api/ai-jobs/run-next/route.ts");
    assert.ok(src.includes('resultCode: "QUEUE_EMPTY"'), "empty-queue response must include resultCode QUEUE_EMPTY");
    assert.ok(src.includes("processed: false"), "empty-queue response must include processed: false");
  });

  it("run-next uses status-priority reduce", () => {
    const src = read("app/api/ai-jobs/run-next/route.ts");
    assert.ok(src.includes("statusPriority") && src.includes("FAILED") && src.includes("SUCCEEDED"), "must use status-priority map");
  });

  it("drain workflow parses terminalStatus", () => {
    const src = read(".github/workflows/drain-ai-job-queue.yml");
    assert.ok(src.includes("terminal_status=") && src.includes("terminalStatus"), "drain workflow must parse terminalStatus");
  });

  it("drain workflow fails on terminal non-retryable failures", () => {
    const src = read(".github/workflows/drain-ai-job-queue.yml");
    assert.ok(src.includes('"FAILED"') && src.includes("retryable") && src.includes("::error::"), "must fail on terminal non-retryable FAILED jobs");
  });

  it("drain workflow alerts on AI_ANALYSIS_PERSISTENCE_FAILED", () => {
    const src = read(".github/workflows/drain-ai-job-queue.yml");
    assert.ok(src.includes("AI_ANALYSIS_PERSISTENCE_FAILED") && src.includes("::error::"), "must alert on AI_ANALYSIS_PERSISTENCE_FAILED");
  });

  it("drain workflow treats empty queue as non-failure", () => {
    const src = read(".github/workflows/drain-ai-job-queue.yml");
    assert.ok(src.includes('"$ran" = "0"') && src.includes("Queue empty"), "must treat empty queue as non-failure");
  });

  it("drain workflow treats 5xx as transient", () => {
    const src = read(".github/workflows/drain-ai-job-queue.yml");
    assert.ok(src.includes('"500"') && src.includes('"502"') && src.includes("transient"), "must treat 5xx as transient");
  });
});
