// GET /api/tenders/[id]/extraction-diagnostics
//
// Returns extraction diagnostics: file list, classification, extraction
// status, page count, text length, table count, quality score, failed
// files, OCR-required files, next actions.
//
// Sanitized: no full file bytes or full extracted text in the response.

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { assessTenderExtractionQuality } from "../../../../../lib/extraction/tender-extraction-quality";
import { safeTextPreview } from "../../../../../lib/extraction/tender-source-integrity";
import { classifyMultiFilePack } from "../../../../../lib/extraction/tender-file-classifier";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER");
  } catch (e) {
    return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  await prismaReady;
  const { id: tenderId } = await params;

  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId: actor.id },
    select: { id: true },
  });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const files = await prisma.tenderFile.findMany({
    where: { tenderId, deletionStatus: "ACTIVE" },
    select: {
      id: true, originalFileName: true, fileName: true, mimeType: true, size: true,
      classification: true, extractedText: true, totalPages: true, extractedPages: true,
      ocrPages: true, failedPages: true, extractionScore: true, extractionMethod: true,
      contentHash: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // Classify files
  const classifications = classifyMultiFilePack(files.map((f) => ({
    fileId: f.id,
    fileName: f.originalFileName || f.fileName,
    mimeType: f.mimeType,
    extractedText: f.extractedText,
  })));

  // Build safe file diagnostics
  const fileDiagnostics = files.map((f) => ({
    fileId: f.id,
    fileName: f.originalFileName || f.fileName,
    mimeType: f.mimeType,
    sizeBytes: f.size,
    classification: f.classification ?? classifications.get(f.id)?.classification ?? "unknown",
    classificationConfidence: classifications.get(f.id)?.confidence ?? 0,
    extractionStatus: (f.extractionScore === 0 ? "failed" : f.extractionScore && f.extractionScore < 50 ? "partial" : "extracted") as string,
    pageCount: f.totalPages ?? null,
    extractedPages: f.extractedPages ?? null,
    ocrPages: f.ocrPages ?? null,
    failedPages: f.failedPages ?? null,
    extractionScore: f.extractionScore ?? null,
    extractionMethod: f.extractionMethod ?? null,
    contentHash: f.contentHash ?? null,
    extractedTextPreview: safeTextPreview(f.extractedText ?? "", 200),
    extractedTextLength: (f.extractedText ?? "").length,
  }));

  // Assess extraction quality
  const quality = assessTenderExtractionQuality({
    tenderId,
    files: files.map((f) => ({
      fileId: f.id,
      fileName: f.originalFileName || f.fileName,
      extractionStatus: (f.extractionScore === 0 ? "failed" : f.extractionScore && f.extractionScore < 50 ? "partial" : "extracted"),
      extractedText: f.extractedText ?? "",
      pageCount: f.totalPages,
      pages: [], // Would be populated from pageStatusJson in production
      tables: [],
    })),
  });

  return NextResponse.json({
    ok: true,
    tenderId,
    files: fileDiagnostics,
    quality,
    failedFiles: fileDiagnostics.filter((f) => f.extractionStatus === "failed"),
    ocrRequiredFiles: fileDiagnostics.filter((f) => f.ocrPages && f.ocrPages > 0),
  });
}
