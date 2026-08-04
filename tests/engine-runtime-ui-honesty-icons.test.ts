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

// The "durable Engine UI honesty" block asserted enqueue/poll/status strings
// inside components/engine-action-panel.tsx. That panel could not render its
// own state and was deleted; the route assertions above are the surviving
// guarantee, and tests/engine-is-not-a-user-action.test.ts proves no UI
// invokes the Engine at all.
