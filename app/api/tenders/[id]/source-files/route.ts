// GET /api/tenders/[id]/source-files
// POST /api/tenders/[id]/source-files/reclassify
// POST /api/tenders/[id]/source-files/reextract
//
// These are consolidated into one file for the source-files route.
// The reclassify and reextract sub-routes have their own route.ts files.

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { classifyTenderFile, classifyMultiFilePack } from "../../../../../lib/extraction/tender-file-classifier";
import { safeTextPreview } from "../../../../../lib/extraction/tender-source-integrity";

export const dynamic = "force-dynamic";

// GET — list source files with classification and extraction status
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
      id: true, fileName: true, originalFileName: true, mimeType: true, size: true,
      classification: true, extractedText: true, totalPages: true, extractedPages: true,
      ocrPages: true, failedPages: true, extractionScore: true, extractionMethod: true,
      contentHash: true, createdAt: true, updatedAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // Build safe file list (no full extracted text — just preview)
  const safeFiles = files.map((f) => ({
    fileId: f.id,
    fileName: f.originalFileName || f.fileName,
    mimeType: f.mimeType,
    sizeBytes: f.size,
    classification: f.classification ?? "unknown",
    pageCount: f.totalPages ?? null,
    extractedPages: f.extractedPages ?? null,
    ocrPages: f.ocrPages ?? null,
    failedPages: f.failedPages ?? null,
    extractionScore: f.extractionScore ?? null,
    extractionMethod: f.extractionMethod ?? null,
    contentHash: f.contentHash ?? null,
    extractedTextPreview: safeTextPreview(f.extractedText ?? "", 200),
    extractedTextLength: (f.extractedText ?? "").length,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  }));

  return NextResponse.json({ ok: true, tenderId, files: safeFiles });
}
