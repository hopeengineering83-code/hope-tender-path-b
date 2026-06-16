import { NextResponse } from "next/server";
import { prisma, prismaReady } from "./prisma";

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
    return Object.fromEntries(rows.map((r) => [r.name, r.exists]));
  } catch {
    return { error: true } as unknown as Record<string, boolean>;
  }
}

export async function livenessResponse() {
  const tables = await tableStatus();
  const allCriticalTablesExist = tables["RateLimitBucket"] && tables["PasswordResetToken"] && tables["AiJob"];

  return NextResponse.json(
    {
      ok: true,
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
