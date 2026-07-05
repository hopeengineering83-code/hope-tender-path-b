import { logger } from "../../../../../../lib/observability";
import { NextResponse } from "next/server";
import { getSession } from "../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { safeParseJsonObject } from "../../../../../../lib/safe-json";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: tenderId } = await params;

  try {
    await prismaReady;
    const job = await prisma.aiJob.findFirst({
      where: {
        tenderId,
        userId,
        jobType: "AI_ANALYZE",
        stagedMergedResult: { not: null },
        promotedAt: null,
      },
      orderBy: [{ analysisVersion: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        status: true,
        analysisVersion: true,
        stagedMergedResult: true,
        validationResult: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!job?.stagedMergedResult) {
      return NextResponse.json({ staged: null });
    }

    const parsed = safeParseJsonObject(job.stagedMergedResult);
    if (!parsed || !Array.isArray(parsed.requirements) || typeof parsed.summary !== "string") {
      return NextResponse.json({ error: "Staged analysis is invalid", code: "STAGED_ANALYSIS_INVALID" }, { status: 422 });
    }
    if (parsed.analysisSource !== "PARTIAL_AI" && parsed.analysisSource !== "FALLBACK_DRAFT") {
      return NextResponse.json({ error: "Unsupported staged analysis type", code: "STAGED_ANALYSIS_TYPE_INVALID" }, { status: 422 });
    }

    return NextResponse.json({
      staged: {
        jobId: job.id,
        status: job.status,
        analysisVersion: job.analysisVersion.toString(),
        analysisSource: parsed.analysisSource,
        summary: parsed.summary,
        requirementCount: parsed.requirements.length,
        completedChunks: typeof parsed.completedChunks === "number" ? parsed.completedChunks : null,
        totalChunks: typeof parsed.totalChunks === "number" ? parsed.totalChunks : null,
        contentHash: typeof parsed.contentHash === "string" ? parsed.contentHash : null,
        validationResult: job.validationResult ? safeParseJsonObject(job.validationResult) : null,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        finalizable: false,
        canonical: false,
      },
    });
  } catch (error) {
    logger.error("[ai-analyze/staged]", {
      tenderId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Staged analysis could not be loaded", code: "STAGED_ANALYSIS_LOAD_FAILED" }, { status: 500 });
  }
}
