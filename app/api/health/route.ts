import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const CACHE_MS = 30_000;

type PublicHealthSnapshot = {
  ok: boolean;
  status: "ok" | "degraded";
  databaseReachable: boolean;
  schemaCompatible: boolean;
  criticalModelsReadable: boolean;
  timestamp: string;
};

const g = globalThis as unknown as {
  publicHealthSnapshot?: { at: number; value: PublicHealthSnapshot };
};

function snapshot(value: Omit<PublicHealthSnapshot, "timestamp">): PublicHealthSnapshot {
  return { ...value, timestamp: new Date().toISOString() };
}

export async function GET() {
  const cached = g.publicHealthSnapshot;
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return NextResponse.json(cached.value, {
      status: cached.value.ok ? 200 : 503,
      headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=30" },
    });
  }

  let databaseReachable = false;
  let schemaCompatible = false;
  let criticalModelsReadable = false;

  try {
    await prismaReady;
    await prisma.$queryRawUnsafe("SELECT 1");
    databaseReachable = true;

    // Exercise fields that previously drifted between Prisma schema, runtime
    // bootstrap, and production DB. Values are never returned publicly.
    await Promise.all([
      prisma.tender.findFirst({
        select: {
          id: true,
          procuringEntityName: true,
          legalClientName: true,
          donorAgency: true,
          implementingAgency: true,
          evaluationCriteriaSourceJson: true,
          analysisExtractionStatus: true,
        },
      }),
      prisma.aiJob.findFirst({
        select: {
          id: true,
          analysisVersion: true,
          stagedMergedResult: true,
          promotedAt: true,
        },
      }),
      prisma.aiAnalyzeChunk.findFirst({ select: { id: true, status: true } }),
      prisma.generatedDocument.findFirst({
        select: { id: true, generationStatus: true, validationStatus: true, reviewStatus: true },
      }),
    ]);
    schemaCompatible = true;
    criticalModelsReadable = true;
  } catch (error) {
    console.error("[health] dependency check failed", {
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const ok = databaseReachable && schemaCompatible && criticalModelsReadable;
  const value = snapshot({
    ok,
    status: ok ? "ok" : "degraded",
    databaseReachable,
    schemaCompatible,
    criticalModelsReadable,
  });
  g.publicHealthSnapshot = { at: Date.now(), value };

  return NextResponse.json(value, {
    status: value.ok ? 200 : 503,
    headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=30" },
  });
}
