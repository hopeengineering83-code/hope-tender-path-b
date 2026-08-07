import { NextResponse } from "next/server";
import { prisma, prismaReady } from "./prisma";
import { checkAiProviderHealth } from "./ai-provider-health-check";
import { getStorageReadiness } from "./storage";
import { MAX_PROVIDER_ATTEMPTS_PER_REQUEST } from "./ai";
import { MAX_CANDIDATES_PER_MATCHER_BATCH } from "./engine/ai-multi-perspective-matcher";
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

export async function livenessResponse() {
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

  return NextResponse.json(
    {
      ok,
      status,
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
      release: process.env.VERCEL_GIT_COMMIT_SHA || "unknown",
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID || "unknown",
      deploymentUrl: process.env.VERCEL_URL || "unknown",
      tables,
      aiProviders: aiHealth,
      storage: storageHealth,
      // BLOCKER 10: Expose SAFE non-secret effective runtime configuration so
      // source, tests, and deployed effective settings agree. No keys, no
      // secrets — just the effective numeric limits that drive provider
      // behavior. Authenticated admin diagnostics can use this to verify
      // MAX_PROVIDER_ATTEMPTS, batch sizes, and prefilter limits match
      // expectations.
      effectiveConfig: {
        providerAttemptBudget: MAX_PROVIDER_ATTEMPTS_PER_REQUEST,
        matcherBatchSize: MAX_CANDIDATES_PER_MATCHER_BATCH,
        preFilterLimit: PRE_FILTER_LIMIT,
        engineInvocationSoftDeadlineMs: 40_000,
        providerOrder: aiHealth.configuredProviders ?? [],
      },
      timestamp: new Date().toISOString(),
    },
    { status: httpStatus, headers: { "Cache-Control": "no-store" } },
  );
}
