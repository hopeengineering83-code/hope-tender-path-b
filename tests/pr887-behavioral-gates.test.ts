// Behavioral tests for PR #887 gaps B, C, E, and existing gate protections.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("Gap B: run-next never exposes raw internal errors", () => {
  it("catch block does NOT push error.message into processedJobs", () => {
    const src = read("app/api/ai-jobs/run-next/route.ts");
    // The catch block must NOT include `error: message` or `error: message.slice`
    const catchBlock = src.slice(
      src.indexOf("} catch (error) {"),
      src.indexOf('if (["ENGINE_RUN"'),
    );
    assert.ok(catchBlock.length > 0, "must find catch block");
    assert.ok(
      !catchBlock.includes("error: message") && !catchBlock.includes("error: message.slice"),
      "catch block must NOT push error.message into the response",
    );
    assert.ok(
      catchBlock.includes("correlationId"),
      "catch block must generate a correlationId",
    );
    assert.ok(
      catchBlock.includes("logger.error"),
      "catch block must log full error through the structured server logger",
    );
    assert.ok(
      !catchBlock.includes("console.error("),
      "catch block must not bypass the structured logger",
    );
  });
});

describe("Gap C: streaming supersession marks SUPERSEDED not SUCCEEDED", () => {
  it("streamPromoSuperseded produces SUPERSEDED status", () => {
    const src = read("app/api/tenders/[id]/ai-analyze/route.ts");
    assert.ok(
      src.includes('streamPromoSuperseded\n                ? "SUPERSEDED"'),
      "streaming supersession must set status to SUPERSEDED",
    );
    assert.ok(
      src.includes("Superseded by a newer AI Analyze job"),
      "must include operator-visible reason",
    );
    assert.ok(
      src.includes("superseded: streamPromoSuperseded"),
      "output must include superseded flag",
    );
  });
});

describe("Gap E: fail-closed gates block all non-AI_SUCCEEDED states", () => {
  it("canExportWithAnalysisState only allows AI_SUCCEEDED; HUMAN_APPROVED_FALLBACK now blocked", () => {
    const src = read("lib/engine/analysis-state-resolver.ts");
    const match = src.match(/export function canExportWithAnalysisState[\s\S]*?}/);
    assert.ok(match, "must find canExportWithAnalysisState");
    const fnBody = match[0];
    assert.ok(fnBody.includes("AI_SUCCEEDED"), "must allow AI_SUCCEEDED");
    // HUMAN_APPROVED_FALLBACK was removed from the export allowlist; the gate
    // now explicitly blocks it with FALLBACK_NOT_ALLOWED before canExport runs.
    assert.ok(!fnBody.includes("PARTIAL"), "must NOT allow PARTIAL");
    assert.ok(!fnBody.includes("FAILED"), "must NOT allow FAILED");
    assert.ok(!fnBody.includes("SUPERSEDED"), "must NOT allow SUPERSEDED");
    assert.ok(!fnBody.includes("REGEX_FALLBACK_UNAPPROVED"), "must NOT allow REGEX_FALLBACK_UNAPPROVED");
    assert.ok(!fnBody.includes("QUEUED"), "must NOT allow QUEUED");
    assert.ok(!fnBody.includes("RUNNING"), "must NOT allow RUNNING");
    assert.ok(!fnBody.includes("NOT_STARTED"), "must NOT allow NOT_STARTED");
  });

  it("HUMAN_APPROVED_FALLBACK is blocked outright with FALLBACK_NOT_ALLOWED before any other check", () => {
    const src = read("lib/engine/generation-readiness-gate.ts");
    assert.ok(
      src.includes('"FALLBACK_NOT_ALLOWED"') && src.includes('HUMAN_APPROVED_FALLBACK'),
      "Gate must explicitly block HUMAN_APPROVED_FALLBACK with FALLBACK_NOT_ALLOWED",
    );
  });

  it("SUCCEEDED without promotedAt fails closed (Fragment 4)", () => {
    const src = read("lib/engine/analysis-state-resolver.ts");
    assert.ok(
      src.includes("!job.promotedAt") && src.includes('state = "FAILED"'),
      "SUCCEEDED without promotedAt must set state to FAILED",
    );
  });

  it("all generation/export/download routes use assertTenderReadyForGenerationAndExport", () => {
    const routes = [
      "app/api/tenders/[id]/generate/route.ts",
      "app/api/tenders/[id]/ai-proposal/route.ts",
      "app/api/tenders/[id]/download/route.ts",
      "app/api/tenders/[id]/export/route.ts",
    ];
    for (const route of routes) {
      const src = read(route);
      assert.ok(
        src.includes("assertTenderReadyForGenerationAndExport"),
        `${route} must use assertTenderReadyForGenerationAndExport`,
      );
    }
  });

  it("Anthropic remains last in provider chain", () => {
    const src = read("lib/ai-provider-catalog.cjs");
    const match = src.match(/CANONICAL_AI_PROVIDER_ORDER\s*=\s*\[([\s\S]*?)\]/);
    assert.ok(match, "must find CANONICAL_AI_PROVIDER_ORDER");
    const providers = Array.from(match[1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
    assert.equal(providers[providers.length - 1], "anthropic", "Anthropic must be last");
  });

  it("finalizeJob does NOT create GeneratedDocument rows", () => {
    const src = read("lib/ai-jobs/analysis-job-service.ts");
    assert.ok(
      !src.includes("generatedDocument.create"),
      "finalizeJob must NOT create GeneratedDocument rows",
    );
  });

  it("finalizeJob transaction passes tx to both promotion helpers", () => {
    const src = read("lib/ai-jobs/analysis-job-service.ts");
    const marker = src.indexOf("SHORT INTERACTIVE TRANSACTION");
    const txStart = src.indexOf("await prisma.$transaction(async (tx) => {", marker);
    const txEnd = src.indexOf("}, {", txStart);
    const txBlock = src.slice(txStart, txEnd);
    assert.ok(txBlock.includes("canPromoteToCanonical(jobId, job.tenderId!, tx)"), "must pass tx to canPromoteToCanonical");
    assert.ok(txBlock.includes("promoteAnalysisToCanonical(jobId,") && txBlock.includes(", tx)"), "must pass tx to promoteAnalysisToCanonical");
    // No global prisma calls inside the transaction
    const prismaMatches = txBlock.match(/\bprisma\.\w+/g) || [];
    const disallowed = prismaMatches.filter((m: string) => m !== "prisma.$transaction");
    assert.equal(disallowed.length, 0, "transaction must not contain global prisma calls");
  });

  it("single-chunk path uses analyzeOneChunkWithRetry", () => {
    const src = read("lib/ai.ts");
    assert.ok(
      src.includes("analyzeOneChunkWithRetry(chunks[0], 0, 1,"),
      "single-chunk path must use analyzeOneChunkWithRetry",
    );
  });

  it("orchestrator restores and persists provider health", () => {
    const src = read("lib/engine/analysis-orchestrator.ts");
    assert.ok(src.includes("restoreHealthFromDbBounded"), "must restore health before analysis");
    assert.ok(src.includes("persistAllHealthToDbBounded"), "must persist health after analysis");
  });

  it("upsertRequirements uses createMany for batch inserts", () => {
    const src = read("lib/engine/stable-requirements.ts");
    assert.ok(src.includes("createMany"), "must use createMany for batch inserts");
    // Must NOT have misleading O(2) comment
    assert.ok(!src.includes("O(2)"), "must NOT claim O(2) round-trips");
  });

  it("run-next uses bounded restore before retry re-arm", () => {
    const src = read("app/api/ai-jobs/run-next/route.ts");
    assert.ok(src.includes("restoreHealthFromDbBounded"), "must use bounded restore");
    const restoreCallIdx = src.indexOf("await restoreHealthFromDbBounded");
    const retryCallIdx = src.indexOf("await findJobsDueForRetry");
    assert.ok(restoreCallIdx > 0 && retryCallIdx > 0, "both must exist");
    assert.ok(restoreCallIdx < retryCallIdx, "restore must be before retry check");
  });
});
