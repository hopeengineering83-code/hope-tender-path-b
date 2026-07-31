import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("durable Engine route authority", () => {
  const route = read("app/api/tenders/[id]/engine/route.ts");

  it("has one server-controlled enqueue path", () => {
    assert.match(route, /enqueueEngineJobForCurrentSources/);
    assert.match(route, /status: 202/);
    assert.match(route, /jobId: enqueueResult\.id/);
    assert.match(route, /sourceRevision: revision\.sourceRevision/);
    assert.match(route, /idempotencyKey/);
    assert.doesNotMatch(route, /runTenderEngine\(/);
    assert.doesNotMatch(route, /searchParams\.get\("async"\)/);
  });

  it("rejects client-selected execution policy", () => {
    assert.match(route, /CLIENT_POLICY_PARAMETERS/);
    for (const parameter of ["safe", "skipRematch", "skipAiRematch", "maxChars", "provider", "retryCount"]) {
      assert.match(route, new RegExp(`"${parameter}"`));
    }
    assert.match(route, /CLIENT_POLICY_OVERRIDE_REJECTED/);
    assert.match(route, /Engine execution policy is controlled by the server/);
  });

  it("preserves extraction, analysis, tenant, and Vault gates before enqueue", () => {
    assert.match(route, /where: \{ id, userId \}/);
    for (const code of [
      "NO_TENDER_FILES",
      "EXTRACTION_CORRUPTED_ENGINE_SKIPPED",
      "EXTRACTION_QUALITY_ENGINE_BLOCKED",
      "ANALYSIS_FROM_CORRUPTED_EXTRACTION",
      "ANALYSIS_FROM_WEAK_EXTRACTION",
      "COMPANY_VAULT_AUTO_PROMOTION_FAILED",
    ]) assert.match(route, new RegExp(code));
    const vaultPos = route.indexOf("prepareCompanyVaultForEngine(userId)");
    const enqueuePos = route.indexOf("enqueueEngineJobForCurrentSources(prisma");
    assert.ok(vaultPos >= 0 && enqueuePos > vaultPos);
  });

  it("logs only a diagnostic class and returns a mapped public error", () => {
    assert.match(route, /const errorName = error instanceof Error \? error\.constructor\.name : typeof error/);
    assert.match(route, /logger\.error\("Engine enqueue failed:", \{ diagnosticId, errorName \}\)/);
    assert.match(route, /actionableEngineError\(error\)/);
    assert.doesNotMatch(route, /logger\.error\([^\n]*\{[^\n]*error[^N]/);
  });
});

describe("durable Engine UI honesty", () => {
  const panel = read("components/engine-action-panel.tsx");

  it("uses one enqueue-and-poll workflow without legacy mode controls", () => {
    assert.match(panel, /executeEngineRunAsync/);
    assert.match(panel, /fetch\(`\/api\/tenders\/\$\{tenderId\}\/engine`, \{ method: "POST" \}\)/);
    assert.match(panel, /fetch\(`\/api\/ai-jobs\/\$\{jobId\}`, \{ method: "GET" \}\)/);
    assert.match(panel, /TERMINAL_JOB_STATUSES/);
    assert.doesNotMatch(panel, /Run Safe Mode/);
    assert.doesNotMatch(panel, /Full AI/);
    assert.doesNotMatch(panel, /skipAiRematch/);
    assert.doesNotMatch(panel, /maxChars=/);
  });

  it("reports partial, failed, canceled, and background-running states honestly", () => {
    assert.match(panel, /PARTIAL_SUCCESS/);
    assert.match(panel, /ASYNC_ENGINE_FAILED/);
    assert.match(panel, /ENGINE_JOB_SUPERSEDED/);
    assert.match(panel, /ASYNC_POLL_TIMEOUT/);
    assert.match(panel, /Background Engine run completed, but matching is blocked/);
    assert.match(panel, /durable worker continues/);
    assert.match(panel, /<BoltIcon \/>/);
  });
});
