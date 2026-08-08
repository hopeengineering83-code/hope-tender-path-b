import { NextResponse } from "next/server";
import { prisma, prismaReady } from "./prisma";
import { checkAiProviderHealth } from "./ai-provider-health-check";
import { getStorageReadiness } from "./storage";
import { MAX_PROVIDER_ATTEMPTS_PER_REQUEST } from "./ai";
import { MAX_CANDIDATES_PER_MATCHER_BATCH, adaptiveBatchSize } from "./engine/ai-multi-perspective-matcher";
import { PRE_FILTER_LIMIT } from "./engine/main-engine-ai-rematch";

const CRITICAL_TABLES = [
  "RateLimitBucket",
  "PasswordResetToken",
  "SubmissionPlanState",
  "AiAnalyzeChunk",
  "AiJob",
] as const;

async function tableStatus(): Promise<Record<string, boolean>> {
  try {
    await prismaReady;
    const rows = await prisma.$queryRaw<Array<{ name: string; exists: boolean }>>`
      SELECT name, to_regclass('"' || name || '"') IS NOT NULL AS exists
      FROM (VALUES
        ('RateLimitBucket'),
        ('PasswordResetToken'),
        ('SubmissionPlanState'),
        ('AiAnalyzeChunk'),
        ('AiJob')
      ) AS t(name)
    `;
    return Object.fromEntries(rows.map((row) => [row.name, row.exists]));
  } catch {
    return Object.fromEntries(CRITICAL_TABLES.map((name) => [name, false]));
  }
}

/**
 * Everything the health check knows. Split out from `livenessResponse()` so the
 * PUBLIC endpoint and the ADMIN diagnostics view derive `ok`/`status`/HTTP code
 * from one implementation while exposing different amounts of detail.
 */
async function computeLivenessSnapshot() {
  const tables = await tableStatus();
  const allCriticalTablesExist = CRITICAL_TABLES.every((name) => tables[name] === true);
  const aiHealth = checkAiProviderHealth();
  // getStorageReadiness() (lib/storage.ts) is the single canonical storage
  // policy resolver — provider, ready/durable/boundedFallback flags, and a
  // secret-free human-readable detail string. Previously this endpoint had
  // no storage awareness at all: Brand Assets and tender upload failures
  // (e.g. no Blob token configured and ALLOW_DB_FILE_STORAGE=false, so no
  // storage provider works) were invisible here even though /api/health is
  // what an external uptime monitor checks.
  const storageHealth = getStorageReadiness();

  // Healthy requires DB tables, at least one AI provider, AND ready file
  // storage. Any of the latter two missing makes the app "degraded" — it
  // can still serve pages but can't do AI analysis/generation, or can't
  // durably store uploads, respectively.
  const ok = allCriticalTablesExist && aiHealth.healthy && storageHealth.ready;
  const status = ok ? "healthy" : allCriticalTablesExist ? "degraded" : "unhealthy";

  // HTTP 200 when the DB is reachable (even if AI providers or durable
  // storage are not configured — the app is "degraded" but still serving
  // pages). HTTP 503 only when critical DB tables are missing (the app
  // cannot function). Previously, a deployment with valid DB tables but no
  // AI keys returned 503, causing external monitors and
  // `verify-production-health.mjs` to fail even though pages rendered fine.
  // The same reasoning now applies to storage: a broken Blob/DB-fallback
  // configuration degrades uploads, not the whole app.
  const httpStatus = allCriticalTablesExist ? 200 : 503;

  return { tables, allCriticalTablesExist, aiHealth, storageHealth, ok, status, httpStatus };
}

/**
 * PUBLIC, UNAUTHENTICATED liveness/readiness.
 *
 * Carries only what real monitoring actually consumes, verified against every
 * caller in this repository:
 *   • `ok`                      — e2e/anonymous, e2e/tablet, production-smoke
 *   • `status`                  — verify-deployment, verify-production-health
 *   • `release`                 — verify-deployment, verify-production-health,
 *                                 verify-production-artifacts, production-smoke
 *   • `tables[...]`             — verify-deployment, verify-production-health,
 *                                 production-smoke (critical-table readiness)
 *   • `deploymentId`            — verify-production-health (reporting)
 *   • HTTP 200 / 503            — every monitor
 *
 * Deliberately NOT public any more: the AI provider names and canonical order,
 * storage provider internals, engine tuning constants (attempt budget, matcher
 * batch size, pre-filter limit, soft deadline) and the internal deployment URL.
 * No caller in this repository read any of them, and together they described
 * the system's internal topology to anonymous callers. They are still available
 * to authenticated ADMINs via `detailedLivenessPayload()`.
 */
export async function livenessResponse() {
  const snapshot = await computeLivenessSnapshot();

  return NextResponse.json(
    {
      ok: snapshot.ok,
      status: snapshot.status,
      release: process.env.VERCEL_GIT_COMMIT_SHA || "unknown",
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID || "unknown",
      tables: snapshot.tables,
      timestamp: new Date().toISOString(),
    },
    { status: snapshot.httpStatus, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Full diagnostic payload for AUTHENTICATED ADMIN callers only.
 *
 * Never return this from an unauthenticated route. It still contains no keys or
 * secrets — only effective non-secret configuration — but it does describe
 * internal topology (provider order, storage provider, tuning limits) that
 * anonymous callers have no need for.
 */
export async function detailedLivenessPayload() {
  const snapshot = await computeLivenessSnapshot();
  const { aiHealth, storageHealth } = snapshot;

  return {
    ok: snapshot.ok,
    status: snapshot.status,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
    release: process.env.VERCEL_GIT_COMMIT_SHA || "unknown",
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID || "unknown",
    deploymentUrl: process.env.VERCEL_URL || "unknown",
    tables: snapshot.tables,
    aiProviders: aiHealth,
    storage: storageHealth,
    // Effective non-secret runtime configuration, so source, tests and the
    // deployed effective settings can be reconciled by an admin.
    effectiveConfig: {
      providerAttemptBudget: MAX_PROVIDER_ATTEMPTS_PER_REQUEST,
      matcherBatchSize: MAX_CANDIDATES_PER_MATCHER_BATCH,
      adaptiveBatchSizeAvailable: true,
      preFilterLimit: PRE_FILTER_LIMIT,
      engineInvocationSoftDeadlineMs: 40_000,
      providerOrder: aiHealth.configuredProviders ?? [],
    },
    timestamp: new Date().toISOString(),
  };
}
