import { NextResponse } from "next/server";
import { prisma, prismaReady } from "./prisma";
import { checkAiProviderHealth } from "./ai-provider-health-check";

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

  // Healthy requires both DB tables AND at least one AI provider configured.
  // If no AI providers are configured, the app is "degraded" — it can still
  // serve pages but can't do AI analysis or generation.
  const ok = allCriticalTablesExist && aiHealth.healthy;
  const status = ok ? "healthy" : allCriticalTablesExist ? "degraded" : "unhealthy";

  // HTTP 200 when the DB is reachable (even if AI providers are not configured —
  // the app is "degraded" but still serving pages). HTTP 503 only when critical
  // DB tables are missing (the app cannot function). Previously, a deployment
  // with valid DB tables but no AI keys returned 503, causing external monitors
  // and `verify-production-health.mjs` to fail even though pages rendered fine.
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
      timestamp: new Date().toISOString(),
    },
    { status: httpStatus, headers: { "Cache-Control": "no-store" } },
  );
}
