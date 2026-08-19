// P1 closure: the PUBLIC /api/health endpoint must not describe internal
// topology to anonymous callers.
//
// At PR #1175 head f2be6001 the unauthenticated endpoint returned the AI
// provider names and canonical order, the storage provider's internals, engine
// tuning constants (provider attempt budget, matcher batch size, pre-filter
// limit, engine soft deadline) and the internal deployment URL. No caller in
// this repository read any of them.
//
// The fields that real monitoring DOES consume were derived by reading every
// caller (scripts/verify-deployment.mjs, scripts/verify-production-health.mjs,
// scripts/verify-production-artifacts.mjs, e2e/production-smoke.spec.ts,
// e2e/anonymous/anonymous-access.spec.ts, e2e/tablet-*.spec.ts) and must keep
// working unchanged.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

/** Exactly what the repository's own monitoring reads. */
const REQUIRED_PUBLIC_FIELDS = ["ok", "status", "release", "deploymentId", "tables", "timestamp"] as const;

/** Internal topology that anonymous callers must never receive. */
const FORBIDDEN_PUBLIC_FIELDS = ["aiProviders", "storage", "effectiveConfig", "deploymentUrl", "environment"] as const;

async function readPublicHealthBody(): Promise<Record<string, unknown>> {
  const { livenessResponse } = await import("../lib/liveness");
  const response = await livenessResponse();
  return (await response.json()) as Record<string, unknown>;
}

describe("P1: public /api/health exposes only what monitoring needs", () => {
  it("keeps every field the repository's monitoring actually reads", async () => {
    const body = await readPublicHealthBody();
    for (const field of REQUIRED_PUBLIC_FIELDS) {
      assert.ok(field in body, `public health must keep '${field}' — monitoring depends on it`);
    }
  });

  it("preserves the critical-table readiness contract", async () => {
    const body = await readPublicHealthBody();
    const tables = body.tables as Record<string, boolean>;
    assert.ok(tables && typeof tables === "object", "tables must remain an object");
    // verify-deployment.mjs and production-smoke assert per-table booleans.
    for (const table of ["RateLimitBucket", "PasswordResetToken", "SubmissionPlanState", "AiAnalyzeChunk", "AiJob"]) {
      assert.equal(typeof tables[table], "boolean", `table '${table}' readiness must remain a boolean`);
    }
  });

  it("no longer leaks internal topology to anonymous callers", async () => {
    const body = await readPublicHealthBody();
    for (const field of FORBIDDEN_PUBLIC_FIELDS) {
      assert.ok(!(field in body), `public health must NOT expose '${field}' to anonymous callers`);
    }
  });

  it("does not leak the AI provider names or canonical order anywhere in the public body", async () => {
    const body = await readPublicHealthBody();
    const serialized = JSON.stringify(body).toLowerCase();
    for (const provider of ["zai", "cerebras", "mistral", "groq", "openrouter", "gemini", "openai", "together", "deepseek", "anthropic"]) {
      assert.ok(
        !serialized.includes(`"${provider}"`),
        `public health must not name the '${provider}' provider`,
      );
    }
  });

  it("does not leak engine tuning constants in the public body", async () => {
    const body = await readPublicHealthBody();
    const serialized = JSON.stringify(body);
    for (const key of ["providerAttemptBudget", "matcherBatchSize", "preFilterLimit", "engineInvocationSoftDeadlineMs"]) {
      assert.ok(!serialized.includes(key), `public health must not expose '${key}'`);
    }
  });

  it("still returns the full detail to authenticated ADMIN callers", async () => {
    const { detailedLivenessPayload } = await import("../lib/liveness");
    const payload = await detailedLivenessPayload();

    // Nothing was deleted — it moved behind authentication.
    for (const field of [...REQUIRED_PUBLIC_FIELDS, ...FORBIDDEN_PUBLIC_FIELDS]) {
      assert.ok(field in payload, `admin diagnostics must still provide '${field}'`);
    }
    assert.equal(typeof (payload.effectiveConfig as Record<string, unknown>).providerAttemptBudget, "number");
  });

  it("derives ok/status from the same computation for both views", async () => {
    const { detailedLivenessPayload } = await import("../lib/liveness");
    const publicBody = await readPublicHealthBody();
    const adminPayload = await detailedLivenessPayload();

    assert.equal(publicBody.ok, adminPayload.ok, "public and admin views must not disagree about health");
    assert.equal(publicBody.status, adminPayload.status, "public and admin views must not disagree about status");
  });

  it("the detailed payload is only reachable through an ADMIN-gated route", async () => {
    const { readFileSync } = await import("node:fs");

    // The public route must not reach for the detailed payload.
    const publicRoute = readFileSync("app/api/health/route.ts", "utf8");
    assert.ok(
      !publicRoute.includes("detailedLivenessPayload"),
      "the public health route must never return the detailed payload",
    );

    // Every module that does use it must be behind requireRole("ADMIN").
    const adminRoute = readFileSync("app/api/admin/diagnostics/route.ts", "utf8");
    assert.ok(adminRoute.includes("detailedLivenessPayload"), "admin diagnostics should surface the detail");
    assert.match(
      adminRoute,
      /requireRole\("ADMIN"\)/,
      "the route serving the detailed payload must require the ADMIN role",
    );
  });
});
