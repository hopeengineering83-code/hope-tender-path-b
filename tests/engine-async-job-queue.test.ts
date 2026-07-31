// Regression tests for the durable, server-controlled Engine contract and
// honest partial results in the polling UI.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("Engine route — production dispatch is always durable and enqueue-only", () => {
  const route = read("app/api/tenders/[id]/engine/route.ts");
  const handler = read("lib/ai-job-handlers.ts");

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

  it("commits automatic Vault verification before making a job visible", () => {
    const preflight = route.indexOf("prepareCompanyVaultForEngine(userId)");
    const revision = route.indexOf("computeEngineSourceRevision(prisma");
    const enqueueTransaction = route.indexOf("const enqueueResult = await prisma.$transaction");
    const createJob = route.indexOf("tx.aiJob.create");
    assert.ok(preflight >= 0);
    assert.ok(revision > preflight);
    assert.ok(enqueueTransaction > revision);
    assert.ok(createJob > enqueueTransaction);
  });

  it("converges duplicate requests on a deterministic source-bound job", () => {
    assert.match(route, /engineIdempotencyKey/);
    assert.match(route, /pg_advisory_xact_lock/);
    assert.match(route, /analysisInputHash:\s*revision\.sourceRevision/);
    assert.match(route, /jobType:\s*"ENGINE_RUN"/);
    assert.match(route, /status:\s*"QUEUED"/);
    assert.match(route, /status:\s*\{ in:\s*\["QUEUED", "RUNNING", "PARTIAL_SUCCESS"\] \}/);
    assert.match(route, /reusedActiveJob:\s*true/);
  });

  it("returns the persisted job contract with HTTP 202", () => {
    assert.match(route, /jobId:\s*enqueueResult\.id/);
    assert.match(route, /status:\s*enqueueResult\.status/);
    assert.match(route, /persistedStatus:\s*enqueueResult\.status/);
    assert.match(route, /sourceRevision:\s*revision\.sourceRevision/);
    assert.match(route, /idempotencyKey/);
    assert.match(route, /statusEndpoint:\s*`\/api\/ai-jobs\/\$\{enqueueResult\.id\}`/);
    assert.match(route, /\}, \{ status: 202 \}\);/);
  });

  it("revalidates source revision before execution and before promotion", () => {
    assert.match(handler, /ENGINE_SOURCE_REVISION_REQUIRED/);
    assert.match(handler, /assertCurrentEngineSourceRevision/);
    assert.match(handler, /checkpoint:\s*"before"/);
    assert.match(handler, /checkpoint:\s*"after"/);
    assert.match(handler, /ENGINE_SOURCE_REVISION_STALE/);
    assert.ok(
      handler.indexOf('checkpoint: "before"') < handler.indexOf("legacyHandler(ctx)"),
      "worker must reject stale input before invoking the Engine",
    );
    assert.ok(
      handler.lastIndexOf('checkpoint: "after"') > handler.indexOf("buildAndVerifyBuildPlan"),
      "worker must revalidate immediately before returning promotable output",
    );
  });
});

describe("Engine action panel — SUCCEEDED polling branch surfaces partial results honestly", () => {
  const src = read("components/engine-action-panel.tsx");
  const succeededPos = src.indexOf('if (finalStatus === "SUCCEEDED")');
  const failedPos = src.indexOf('else if (finalStatus === "FAILED")');

  it("reads finalJob.output", () => {
    const succeededSlice = src.slice(succeededPos, failedPos);
    assert.match(succeededSlice, /const jobOutput = finalJob\?\.output/);
    assert.match(succeededSlice, /jobOutput\?\.result \?\? jobOutput/);
  });

  it("recognizes both partial-result shapes", () => {
    const succeededSlice = src.slice(succeededPos, failedPos);
    assert.match(succeededSlice, /engineResult\?\.partial === true \|\| engineResult\?\.code === "ENGINE_COMPLETED_WITH_BLOCKERS"/);
  });

  it("checks partial output before publishing any success result", () => {
    const isPartialPos = src.indexOf("if (isPartial)");
    const successResultPos = src.indexOf("success: true", isPartialPos);
    assert.ok(isPartialPos > succeededPos && isPartialPos < failedPos);
    assert.ok(successResultPos > isPartialPos && successResultPos < failedPos);
    const partialSlice = src.slice(isPartialPos, successResultPos);
    assert.match(partialSlice, /success: false/);
    assert.match(partialSlice, /blockers: Array\.isArray\(rawBlockers\) \? rawBlockers : undefined/);
    assert.match(partialSlice, /matching is blocked/i);
  });
});
