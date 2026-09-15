import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("AI persistence transaction regression", () => {
  function getFinalizeJobTxBlock(src: string): string {
    const marker = "PRE-TRANSACTION PREPARATION";
    const markerIdx = src.indexOf(marker);
    assert.ok(markerIdx > 0, "must have PRE-TRANSACTION PREPARATION marker");
    const txStart = src.indexOf("await prisma.$transaction(async (tx) => {", markerIdx);
    assert.ok(txStart > 0, "must have $transaction after the preparation marker");
    const txEnd = src.indexOf("}, {", txStart);
    assert.ok(txEnd > txStart, "transaction block must have closing }, {");
    return src.slice(txStart, txEnd);
  }

  it("finalizeJob() does NOT call buildCanonicalAnalysisTenderUpdate inside $transaction", () => {
    const src = read("lib/ai-jobs/analysis-job-service.ts");
    const txBlock = getFinalizeJobTxBlock(src);
    assert.ok(!txBlock.includes("buildCanonicalAnalysisTenderUpdate"), "buildCanonicalAnalysisTenderUpdate must be called OUTSIDE the transaction");
  });

  it("finalizeJob() does NOT call JSON.stringify inside $transaction", () => {
    const src = read("lib/ai-jobs/analysis-job-service.ts");
    const txBlock = getFinalizeJobTxBlock(src);
    assert.ok(!txBlock.includes("JSON.stringify("), "JSON.stringify must be called OUTSIDE the transaction");
  });

  it("finalizeJob() does NOT call mapToDraft inside $transaction", () => {
    const src = read("lib/ai-jobs/analysis-job-service.ts");
    const txBlock = getFinalizeJobTxBlock(src);
    assert.ok(!txBlock.includes("mapToDraft"), "mapToDraft must be called OUTSIDE the transaction");
  });

  it("finalizeJob() re-verifies promotion eligibility inside the transaction", () => {
    const src = read("lib/ai-jobs/analysis-job-service.ts");
    const txBlock = getFinalizeJobTxBlock(src);
    assert.ok(txBlock.includes("canPromoteToCanonical"), "transaction must re-verify canPromoteToCanonical");
  });

  it("finalizeJob() has a PRE-TRANSACTION PREPARATION block", () => {
    const src = read("lib/ai-jobs/analysis-job-service.ts");
    assert.ok(src.includes("PRE-TRANSACTION PREPARATION"), "must have a pre-transaction preparation block");
  });

  it("finalizeJob() catches STALE_JOB_SUPERSEDED and returns SUPERSEDED status", () => {
    const src = read("lib/ai-jobs/analysis-job-service.ts");
    // The sentinel is now a shared exported constant rather than an inline
    // (previously misspelled) string literal, so assert on the identifier.
    assert.ok(
      src.includes("STALE_JOB_SUPERSEDED_SENTINEL"),
      "must detect stale-job supersession",
    );
    assert.ok(
      src.includes("ANALYSIS_SUPERSEDED_STATUS"),
      "must return SUPERSEDED for stale jobs",
    );
    // Stronger than the original literal check: the supersession branches must
    // not write a success status alongside a non-promoted outcome.
    assert.ok(
      !/status:\s*failed\.length\s*>\s*0\s*\?\s*"PARTIAL_SUCCESS"\s*:\s*"SUCCEEDED",[\s\S]{0,400}?[Ss]uperseded/.test(src),
      "a superseded job must never be persisted with a success status",
    );
  });

  it("finalizeJob() logs structured fields: correlationId, jobId, tenderId", () => {
    const src = read("lib/ai-jobs/analysis-job-service.ts");
    const persistIdx = src.indexOf("AI_ANALYSIS_PERSISTENCE_FAILED correlation=");
    assert.ok(persistIdx > 0, "must have a log line with AI_ANALYSIS_PERSISTENCE_FAILED correlation=");
    const before = src.lastIndexOf("`", persistIdx);
    const after = src.indexOf("`", persistIdx);
    assert.ok(before > 0 && after > persistIdx, "must find the template literal boundaries");
    const logTemplate = src.slice(before + 1, after);
    assert.ok(logTemplate.includes("correlation="), `log must include correlation= (got: ${logTemplate})`);
    assert.ok(logTemplate.includes("job="), `log must include job= (got: ${logTemplate})`);
    assert.ok(logTemplate.includes("tender="), `log must include tender= (got: ${logTemplate})`);
  });

  it("finalizeJob() does NOT merely increase the Prisma timeout as the primary fix", () => {
    const src = read("lib/ai-jobs/analysis-job-service.ts");
    const timeoutMatch = src.match(/timeout:\s*(\d+)/);
    if (timeoutMatch) {
      const timeoutMs = parseInt(timeoutMatch[1], 10);
      assert.ok(timeoutMs <= 30000, `transaction timeout must be <= 30000ms (got ${timeoutMs}ms)`);
    }
    assert.ok(src.includes("PRE-TRANSACTION PREPARATION"), "primary fix must be structural, not a timeout increase");
  });
});
