import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { assessExtractionQuality } from "../../../../../lib/extraction-quality";
import { summarizeExtractionCoverage, isExtractionAcceptableForGeneration } from "../../../../../lib/engine/extraction-quality-gate";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id } = await params;
  const tender = await prisma.tender.findFirst({
    where: { id, userId },
    select: {
      id: true,
      files: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true, fileName: true, originalFileName: true, mimeType: true, extractedText: true,
          totalPages: true, extractedPages: true, ocrPages: true, failedPages: true,
          extractionScore: true, extractionMethod: true,
        },
      },
    },
  });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const files = tender.files.map((file) => {
    const fileName = file.originalFileName || file.fileName;
    const quality = assessExtractionQuality(file.extractedText, fileName);
    return {
      id: file.id,
      fileName,
      mimeType: file.mimeType,
      totalPages: file.totalPages,
      extractedPages: file.extractedPages,
      ocrPages: file.ocrPages,
      failedPages: file.failedPages,
      extractionScore: file.extractionScore ?? quality.score,
      extractionMethod: file.extractionMethod,
      extractedCharacterCount: quality.characterCount,
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
}
