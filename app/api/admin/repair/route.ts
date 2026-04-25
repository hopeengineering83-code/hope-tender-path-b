import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { extractTextFromBuffer, getFileTypeLabel, isMeaningfulExtraction } from "../../../../lib/extract-text";
import { importCompanyKnowledgeFromDocuments } from "../../../../lib/company-knowledge-import-safe";

/**
 * POST /api/admin/repair
 * Full repair workflow:
 *  1. Re-extract text from ALL stored documents (not just failed ones)
 *  2. Run AI extraction + knowledge import
 *  3. Return diagnostic summary
 *
 * Query params:
 *   ?step=extract     — only re-extract text (skip import)
 *   ?step=import      — only run import (skip re-extraction)
 *   ?step=all (default) — both
 */
export async function POST(req: Request) {
  let actor;
  try {
    actor = await requireRole("ADMIN");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return msg === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  await prismaReady;

  const { searchParams } = new URL(req.url);
  const step = searchParams.get("step") ?? "all";

  const company = await prisma.company.findUnique({ where: { userId: actor.id } });
  if (!company) return NextResponse.json({ error: "Company not found. Create your company profile first." }, { status: 404 });

  const results = {
    step,
    reextraction: null as null | { total: number; success: number; failed: number; skipped: number; details: Array<{ name: string; chars: number; status: string; error?: string }> },
    import: null as null | { docsProcessed: number; expertsCreated: number; projectsCreated: number; aiUsed: boolean; aiFailures: number },
    timestamp: new Date().toISOString(),
  };

  // ── Step 1: Re-extract text from all documents ────────────────────────────
  if (step === "extract" || step === "all") {
    const docs = await prisma.companyDocument.findMany({
      where: { companyId: company.id, fileContent: { not: null } },
      select: { id: true, originalFileName: true, mimeType: true, fileContent: true, metadata: true },
    });

    let success = 0, failed = 0, skipped = 0;
    const details: Array<{ name: string; chars: number; status: string; error?: string }> = [];

    for (const doc of docs) {
      if (!doc.fileContent) { skipped++; continue; }
      try {
        const buffer = Buffer.from(doc.fileContent, "base64");
        const extractedText = await extractTextFromBuffer(buffer, doc.mimeType, doc.originalFileName);
        const fileType = getFileTypeLabel(doc.mimeType, doc.originalFileName);
        const meaningful = isMeaningfulExtraction(extractedText);
        let metadata: Record<string, unknown> = {};
        try { metadata = JSON.parse(doc.metadata || "{}"); } catch { metadata = {}; }

        await prisma.companyDocument.update({
          where: { id: doc.id },
          data: {
            extractedText: extractedText || null,
            // Reset AI extraction status so it gets re-processed
            aiExtractionStatus: meaningful ? "PENDING" : "FAILED",
            aiExtractionError: meaningful ? null : "No text extracted from document",
            metadata: JSON.stringify({ ...metadata, fileType, reExtractedAt: new Date().toISOString(), extracted: meaningful, extractedChars: meaningful ? extractedText.length : 0 }),
            updatedAt: new Date(),
          },
        });

        details.push({ name: doc.originalFileName, chars: meaningful ? extractedText.length : 0, status: meaningful ? "extracted" : "no-text" });
        if (meaningful) success++; else skipped++;
      } catch (err) {
        failed++;
        const errMsg = err instanceof Error ? err.message : String(err);
        details.push({ name: doc.originalFileName, chars: 0, status: "error", error: errMsg.slice(0, 200) });
        await prisma.companyDocument.update({
          where: { id: doc.id },
          data: { aiExtractionStatus: "FAILED", aiExtractionError: errMsg.slice(0, 500), updatedAt: new Date() },
        });
      }
    }

    results.reextraction = { total: docs.length, success, failed, skipped, details };
  }

  // ── Step 2: AI extraction + knowledge import ──────────────────────────────
  if (step === "import" || step === "all") {
    const importResult = await importCompanyKnowledgeFromDocuments(company.id);
    results.import = importResult;
  }

  return NextResponse.json(results);
}
