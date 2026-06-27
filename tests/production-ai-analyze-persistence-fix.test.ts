import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

function txBlock(): string {
  const src = read("lib/ai-jobs/analysis-job-service.ts");
  const marker = src.indexOf("SHORT INTERACTIVE TRANSACTION");
  assert.ok(marker > 0, "must find finalizeJob short transaction marker");
  const start = src.indexOf("await prisma.$transaction(async (tx) => {", marker);
  assert.ok(start > 0, "finalizeJob must use an interactive transaction");
  const end = src.indexOf("}, {", start);
  assert.ok(end > start, "must find end of transaction callback");
  return src.slice(start, end);
}

describe("production AI Analyze persistence blocker fix", () => {
  it("finalizeJob passes the active tx into both final promotion helpers", () => {
    const tx = txBlock();
    assert.match(tx, /canPromoteToCanonical\(jobId, job\.tenderId!, tx\)/);
    assert.match(tx, /promoteAnalysisToCanonical\(jobId,[\s\S]*?, tx\)/);
    assert.doesNotMatch(tx, /canPromoteToCanonical\(jobId, job\.tenderId!\);/);
    assert.doesNotMatch(tx, /promoteAnalysisToCanonical\(jobId,\s*\(job as any\)\.runId \|\| require\("crypto"\)\.randomUUID\(\)\);/);
  });

  it("final transaction has no global prisma reads or writes inside the callback", () => {
    const tx = txBlock();
    assert.doesNotMatch(tx, /\bprisma\.(?!\$transaction)/, "transaction callback must use tx/helper-injected tx only");
  });

  it("canonical writes and terminal job promotion remain in one rollback boundary", () => {
    const tx = txBlock();
    const requirementsAt = tx.indexOf("await upsertRequirements(tx");
    const tenderAt = tx.indexOf("await tx.tender.update");
    const terminalAt = tx.indexOf("status: failed.length > 0 ? \"PARTIAL_SUCCESS\" : \"SUCCEEDED\"");
    const promotedAt = tx.indexOf("await promoteAnalysisToCanonical");
    assert.ok(requirementsAt > 0, "requirements must be inside tx");
    assert.ok(tenderAt > requirementsAt, "tender metadata must be inside same tx after requirements");
    assert.ok(terminalAt > tenderAt, "terminal status must be inside same tx after canonical writes");
    assert.ok(promotedAt > terminalAt, "promotedAt/promotedBy/runId helper must be inside same tx");
  });

  it("persistence failure returns only safe fields to the handler", () => {
    const src = read("lib/ai-jobs/analysis-job-service.ts");
    assert.match(src, /code: "AI_ANALYSIS_PERSISTENCE_FAILED"/);
    assert.match(src, /retryable: true/);
    assert.match(src, /correlationId/);
    assert.doesNotMatch(src, /return \{[^}]*errMsg[^}]*\}/s, "API result must not expose raw persistence error text");
  });

  it("AI_ANALYZE handler preserves safe finalizer fields for run-next", () => {
    const handler = read("lib/ai-job-handlers.ts");
    assert.match(handler, /finalizeRetryable/);
    assert.match(handler, /finalizeCorrelationId/);
    assert.match(handler, /\.\.\.\(finalizeCode \? \{ code: finalizeCode \} : \{\}\)/);
    assert.match(handler, /\.\.\.\(finalizeCorrelationId \? \{ correlationId: finalizeCorrelationId \} : \{\}\)/);

    const route = read("app/api/ai-jobs/run-next/route.ts");
    assert.match(route, /correlationId\?: string/);
    assert.match(route, /correlationId: result\.correlationId/);
    assert.match(route, /correlationId: worst\.correlationId \?\? null/);
  });

  it("one-chunk analysis uses the retry/failover wrapper", () => {
    const src = read("lib/ai.ts");
    const oneChunk = src.slice(src.indexOf("if (chunks.length === 1)"), src.indexOf("logger.info", src.indexOf("if (chunks.length === 1)")));
    assert.match(oneChunk, /analyzeOneChunkWithRetry\(/);
    assert.doesNotMatch(oneChunk, /await analyzeOneChunk\(/);
  });

  it("durable AI Analyze bounds health restore before the analysis deadline", () => {
    const src = read("lib/engine/analysis-orchestrator.ts");
    const restoreAt = src.indexOf("restoreHealthFromDbBounded(2_000)");
    const deadlineAt = src.indexOf("const deadlineAt = Date.now() + deadlineMs");
    assert.ok(restoreAt > 0, "durable AI Analyze must use bounded provider-health restore");
    assert.ok(deadlineAt > restoreAt, "provider-health restore must run before the AI deadline starts");
  });

  it("durable AI Analyze persists provider health only after job output/status persistence", () => {
    const src = read("lib/engine/analysis-orchestrator.ts");
    const jobUpdateAt = src.indexOf("await prisma.aiJob.update({");
    const persistAt = src.indexOf("persistAllHealthToDbBounded(1_500)");
    assert.ok(jobUpdateAt > 0, "job output/status update must exist");
    assert.ok(persistAt > jobUpdateAt, "provider-health persistence must happen after job output/status persistence");
    assert.match(src, /provider-health\s+\/\/ persistence must never delay or change the AI Analyze terminal outcome/i);
  });

  it("run-next restores provider cooldowns before automated retry re-arm", () => {
    const route = read("app/api/ai-jobs/run-next/route.ts");
    const restoreAt = route.indexOf("restoreHealthFromDbBounded(2_000)");
    const dueAt = route.indexOf("findJobsDueForRetry(10)");
    assert.ok(restoreAt > 0, "run-next must restore provider health before retry lookup");
    assert.ok(dueAt > restoreAt, "retry due-job lookup must happen after health restore");
  });
});
