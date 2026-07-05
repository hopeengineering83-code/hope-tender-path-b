import { logger } from "../../../../../lib/observability";
import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { assessExtractionQuality } from "../../../../../lib/extraction-quality";
import { summarizeExtractionCoverage, isExtractionAcceptableForGeneration } from "../../../../../lib/engine/extraction-quality-gate";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";

type ExtractedTextSampleRow = {
  id: string;
  extractedCharacterCount: number;
  extractedTextSample: string;
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    await prismaReady;
    const tender = await prisma.tender.findFirst({
      where: { id, userId },
      select: {
        id: true,
        files: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true, fileName: true, originalFileName: true, mimeType: true,
            totalPages: true, extractedPages: true, ocrPages: true, failedPages: true,
            extractionScore: true, extractionMethod: true,
          },
        },
      },
    });
    if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

    // PostgreSQL SELECT returns [] naturally when no TenderFile rows exist —
    // no .catch() needed here. A genuine DB error must propagate to the
    // outer catch so the panel returns a structured 500 rather than silently
    // treating every file as having zero extracted characters.
    const textSamples = await prisma.$queryRaw<ExtractedTextSampleRow[]>`
      SELECT
        id,
        COALESCE(char_length("extractedText"), 0)::int AS "extractedCharacterCount",
        LEFT(COALESCE("extractedText", ''), 6000) AS "extractedTextSample"
      FROM "TenderFile"
      WHERE "tenderId" = ${id}
    `;
    const textSampleById = new Map(textSamples.map((row) => [row.id, row]));

    const files = tender.files.map((file) => {
      const fileName = file.originalFileName || file.fileName;
      const textSample = textSampleById.get(file.id);
      const qualityFromSample = assessExtractionQuality(textSample?.extractedTextSample ?? "", fileName);
      const extractedCharacterCount = textSample?.extractedCharacterCount ?? qualityFromSample.characterCount;
      const quality = {
        ...qualityFromSample,
        characterCount: extractedCharacterCount,
        averageCharsPerPage: file.totalPages && file.totalPages > 0
          ? Math.round(extractedCharacterCount / file.totalPages)
          : qualityFromSample.averageCharsPerPage,
      };
      return {
        id: file.id,
        fileName,
        mimeType: file.mimeType,
        totalPages: file.totalPages,
        extractedPages: file.extractedPages,
        ocrPages: file.ocrPages,
        failedPages: file.failedPages,
        extractionScore: Math.min(file.extractionScore ?? quality.score, quality.score),
        extractionMethod: file.extractionMethod,
        extractedCharacterCount,
        ocrUsed: (file.ocrPages ?? 0) > 0 || quality.hasOcrPlaceholder,
        quality,
      };
    });
    const coverage = summarizeExtractionCoverage(files.map((file) => ({
      id: file.id,
      fileName: file.fileName,
      totalPages: file.totalPages,
      extractedPages: file.extractedPages,
      ocrPages: file.ocrPages,
      failedPages: file.failedPages,
      extractionScore: file.extractionScore,
      extractionMethod: file.extractionMethod,
      characterCount: file.extractedCharacterCount,
    })));

    const blockers = files.filter((file) => file.quality.severity === "FAILED" || file.quality.severity === "POOR");
    const warnings = files.filter((file) => file.quality.severity === "WARNING");

    return NextResponse.json({
      tenderId: id,
      readyForAnalysis: blockers.length === 0 && coverage.totalPagesKnown,
      readyForGeneration: isExtractionAcceptableForGeneration(files),
      summary: coverage,
      blockers: blockers.map((file) => ({ fileName: file.fileName, quality: file.quality })),
      warnings: warnings.map((file) => ({ fileName: file.fileName, quality: file.quality })),
      files,
    });
  } catch (error) {
    const diagnosticId = randomUUID();
    logger.error("[extraction-quality]", {
      route: "/api/tenders/[id]/extraction-quality",
      tenderId: id,
      diagnosticId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({
      error: "Extraction quality panel failed to load.",
      panel: "extraction-quality",
      endpoint: "/api/tenders/[id]/extraction-quality",
      diagnosticId,
      code: "EXTRACTION_QUALITY_RUNTIME_ERROR",
      retryable: true,
      staleDataPossible: false,
    }, { status: 500 });
  }
}
