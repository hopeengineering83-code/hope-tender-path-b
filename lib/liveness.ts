import { NextResponse } from "next/server";
import { prisma, prismaReady } from "./prisma";

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

  return NextResponse.json(
    {
      ok: allCriticalTablesExist,
      status: allCriticalTablesExist ? "healthy" : "degraded",
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
      release: process.env.VERCEL_GIT_COMMIT_SHA || "unknown",
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID || "unknown",
      deploymentUrl: process.env.VERCEL_URL || "unknown",
      tables,
      timestamp: new Date().toISOString(),
    },
    { status: allCriticalTablesExist ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
