import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { assessExtractionQuality, computeExtractionSnapshot } from "../../../../../lib/extraction-quality";
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
            extractionScore: true, extractionMethod: true, pageStatusJson: true,
            extractedText: true, updatedAt: true, contentHash: true
          },
        },
      },
    });
    if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

    const files = tender.files.map((file) => {
      const fileName = file.originalFileName || file.fileName;
      const quality = assessExtractionQuality(file.extractedText ?? "", fileName);
      const snapshot = computeExtractionSnapshot(file);

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
        extractedCharacterCount: file.extractedText?.length ?? 0,
        ocrUsed: (file.ocrPages ?? 0) > 0 || quality.hasOcrPlaceholder,
        quality,
        snapshot
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

    const blockers = files.filter((file) => file.quality.severity === "FAILED" || file.quality.severity === "POOR" || file.snapshot.consistencyStatus !== "CONSISTENT");

    return NextResponse.json({
      tenderId: id,
      readyForAnalysis: blockers.length === 0 && coverage.totalPagesKnown,
      readyForGeneration: isExtractionAcceptableForGeneration(files),
      summary: coverage,
      files,
    });
  } catch (error) {
    const diagnosticId = randomUUID();
    console.error("[extraction-quality]", error);
    return NextResponse.json({
      error: "Extraction quality panel failed to load.",
      diagnosticId,
    }, { status: 500 });
  }
}
