// POST /api/tenders/[id]/source-files/reextract
//
// Re-run extraction on a specific file or all files.
// Only ADMIN and PROPOSAL_MANAGER can reextract.

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { logAction } from "../../../../../../lib/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
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

  const body = await req.json().catch(() => ({})) as { fileId?: string } | null;

  // Find files to reextract
  const where = body?.fileId
    ? { id: body.fileId, tenderId, deletionStatus: "ACTIVE" as const }
    : { tenderId, deletionStatus: "ACTIVE" as const };

  const files = await prisma.tenderFile.findMany({
    where,
    select: { id: true, originalFileName: true, mimeType: true, size: true, fileContent: true },
  });

  if (files.length === 0) {
    return NextResponse.json({ error: "No active files found to reextract" }, { status: 404 });
  }

  // For each file, re-run extraction
  const results: Array<{ fileId: string; fileName: string; status: string; textLength: number }> = [];

  for (const file of files) {
    try {
      // The actual extraction is handled by the existing extraction pipeline.
      // This route triggers a re-extraction by clearing the stored text and
      // marking the file for re-processing. The extraction itself runs
      // asynchronously (same pattern as the existing re-extract-metadata route).
      const fileContent = file.fileContent ? Buffer.from(file.fileContent, "base64") : null;
      if (!fileContent) {
        results.push({ fileId: file.id, fileName: file.originalFileName, status: "no_content", textLength: 0 });
        continue;
      }

      // Import extraction functions
      const { detectFileType } = await import("../../../../../../lib/extraction/tender-source-ingestion");
      const { extractPdfText, extractDocxText, extractXlsxText, extractCsvText, extractTxtText } = await import("../../../../../../lib/extraction/tender-text-extractor");
      const { computeFileHash } = await import("../../../../../../lib/extraction/tender-source-ingestion");

      const fileType = detectFileType(file.mimeType, file.originalFileName);
      let extractionResult: { pages: any[]; tables: any[]; status: string; warnings: string[] };

      switch (fileType) {
        case "PDF":
          extractionResult = await extractPdfText(fileContent, file.id);
          break;
        case "DOCX":
          extractionResult = await extractDocxText(fileContent, file.id);
          break;
        case "XLSX":
          extractionResult = await extractXlsxText(fileContent, file.id);
          break;
        case "CSV":
          extractionResult = extractCsvText(fileContent.toString("utf-8"), file.id);
          break;
        case "TXT":
          extractionResult = extractTxtText(fileContent.toString("utf-8"), file.id);
          break;
        default:
          extractionResult = { pages: [], tables: [], status: "unsupported", warnings: [`Unsupported file type: ${fileType}`] };
      }

      const extractedText = extractionResult.pages.map((p) => p.text).join("\n\n");
      const sha256 = computeFileHash(fileContent);

      await prisma.tenderFile.update({
        where: { id: file.id },
        data: {
          extractedText,
          totalPages: extractionResult.pages.length,
          extractedPages: extractionResult.pages.filter((p) => p.charCount > 0).length,
          ocrPages: extractionResult.pages.filter((p) => p.extractionMethod === "ocr").length,
          failedPages: extractionResult.pages.filter((p) => p.charCount === 0).length,
          extractionMethod: extractionResult.pages.some((p) => p.extractionMethod === "ocr") ? "ocr" : "text",
          extractionScore: extractionResult.status === "extracted" ? 100 : extractionResult.status === "partial" ? 60 : 0,
          contentHash: sha256,
        },
      });

      results.push({
        fileId: file.id,
        fileName: file.originalFileName,
        status: extractionResult.status,
        textLength: extractedText.length,
      });
    } catch (err) {
      results.push({
        fileId: file.id,
        fileName: file.originalFileName,
        status: "failed",
        textLength: 0,
      });
    }
  }

  await logAction({
    userId: actor.id,
    action: "TENDER_FILE_UPLOAD",
    entityType: "Tender",
    entityId: tenderId,
    description: `Re-extracted ${results.length} file(s) for tender ${tenderId}`,
    metadata: { tenderId, fileCount: results.length, results: results.map((r) => ({ fileId: r.fileId, status: r.status })) },
  }).catch(() => {});

  return NextResponse.json({ ok: true, tenderId, results });
}
