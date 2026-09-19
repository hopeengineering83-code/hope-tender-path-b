// Regression tests for the durable, server-controlled Engine contract and
// honest partial results in the polling UI.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("Engine route — production dispatch is always durable and enqueue-only", () => {
  const route = read("app/api/tenders/[id]/engine/route.ts");
  const enqueueAuthority = read("lib/engine/enqueue-engine-job.ts");
  const sourceRevision = read("lib/engine/engine-source-revision.ts");
  const handler = read("lib/ai-job-handlers.ts");
  const worker = read("app/api/ai-jobs/run-next/route.ts");

  it("has no request-bound Engine execution or async opt-in branch", () => {
    assert.doesNotMatch(route, /runTenderEngine/);
    assert.doesNotMatch(route, /searchParams\.get\("async"\)\s*===\s*"true"/);
    assert.doesNotMatch(route, /deadlineAt\s*=\s*Date\.now/);
  });

  it("rejects ordinary-client execution policy overrides", () => {
    assert.match(route, /CLIENT_POLICY_PARAMETERS/);
    for (const parameter of [
      "safe",
      "skipRematch",
      "skipAiRematch",
      "maxChars",
      "provider",
      "retryCount",
      "promotionBypass",
      "validationBypass",
      "staleStateBypass",
    ]) {
      assert.match(route, new RegExp(`"${parameter}"`));
    }
    assert.match(route, /CLIENT_POLICY_OVERRIDE_REJECTED/);
    assert.match(route, /status:\s*400/);
  });

  it("commits automatic Vault verification before invoking the canonical enqueue authority", () => {
    const preflight = route.indexOf("prepareCompanyVaultForEngine(userId)");
    const enqueue = route.indexOf("enqueueEngineJobForCurrentSources(prisma");
    assert.ok(preflight >= 0);
    assert.ok(enqueue > preflight);
    assert.match(route, /const \{ revision, idempotencyKey, job: enqueueResult \} = enqueue/);
  });

  it("uses one canonical authority for duplicate convergence and persisted job creation", () => {
    assert.match(route, /enqueueEngineJobForCurrentSources/);
    assert.doesNotMatch(route, /pg_advisory_xact_lock/);
    assert.match(enqueueAuthority, /engineIdempotencyKey/);
    assert.match(enqueueAuthority, /pg_advisory_xact_lock/);
    assert.match(enqueueAuthority, /analysisInputHash:\s*revision\.sourceRevision/);
    assert.match(enqueueAuthority, /jobType:\s*"ENGINE_RUN"/);
    assert.match(enqueueAuthority, /status:\s*"QUEUED"/);
    assert.match(enqueueAuthority, /status:\s*\{ in:\s*\["QUEUED", "RUNNING", "PARTIAL_SUCCESS"\] \}/);
    assert.match(enqueueAuthority, /reusedActiveJob:\s*true/);
  });

  it("binds revision only to immutable tender/Vault inputs while reporting derived requirement inventory", () => {
    assert.doesNotMatch(sourceRevision, /requirements:\s*sortById/);
    assert.doesNotMatch(sourceRevision, /updatedAt: iso\(tender\.updatedAt\)/);
    assert.match(sourceRevision, /companyDocument\.findMany/);
    assert.match(sourceRevision, /expert\.findMany/);
    assert.match(sourceRevision, /project\.findMany/);
    assert.match(sourceRevision, /requirementCount:\s*tender\._count\.requirements/);
  });

  it("returns the persisted job contract with HTTP 202", () => {
    assert.match(route, /jobId:\s*enqueueResult\.id/);
    assert.match(route, /status:\s*enqueueResult\.status/);
    assert.match(route, /persistedStatus:\s*enqueueResult\.status/);
    assert.match(route, /sourceRevision:\s*revision\.sourceRevision/);
    assert.match(route, /idempotencyKey/);
    assert.match(route, /statusEndpoint:\s*`\/api\/ai-jobs\/\$\{enqueueResult\.id\}`/);
    assert.match(route, /requirements:\s*revision\.requirementCount/);
    assert.match(route, /\}, \{ status: 202 \}\);/);
  });

  it("AI Analyze handler records the manual Run Engine boundary", () => {
    assert.match(handler, /jobType === "AI_ANALYZE"/);
    // The AI Analyze handler records the manual boundary — no automatic Engine continuation.
    assert.match(handler, /manual-engine-required/);
    assert.match(handler, /automaticEngineStarted: false/);
    assert.match(handler, /nextAction: "RUN_ENGINE"/);
  });

  it("revalidates source revision before execution and before promotion", () => {
    assert.match(handler, /ENGINE_SOURCE_REVISION_REQUIRED/);
    assert.match(handler, /assertCurrentEngineSourceRevision/);
    assert.match(handler, /checkpoint:\s*"before"/);
    assert.match(handler, /checkpoint:\s*"after"/);
    assert.match(handler, /ENGINE_SOURCE_REVISION_STALE/);
    assert.ok(
      handler.indexOf('checkpoint: "before"') < handler.lastIndexOf("legacyHandler(ctx)"),
      "worker must reject stale input before invoking the Engine",
    );
    assert.ok(
      handler.lastIndexOf('checkpoint: "after"') > handler.indexOf("buildAndVerifyBuildPlan"),
      "worker must revalidate immediately before returning promotable output",
    );
  });
});

// The client-side SUCCEEDED/FAILED polling branches were asserted against
// components/engine-action-panel.tsx, which was deleted: it could not render
// its own state, so none of those branches could reach a user. Terminal job
// state is the ENGINE_RUN worker's responsibility and is asserted there.
