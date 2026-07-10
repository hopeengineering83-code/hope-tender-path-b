import { logger } from "../../../../lib/observability";
import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { importCompanyKnowledgeFromDocuments } from "../../../../lib/company-knowledge-import-safe";
import { runCompanyKnowledgeSafetyImport } from "../../../../lib/company-knowledge-safety-import";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../lib/rate-limit";
import { extractTextFromBuffer, getFileTypeLabel, isMeaningfulExtraction } from "../../../../lib/extract-text";
import { ensureCompanyForUser } from "../../../../lib/company-workspace";
import { getStorageAdapter } from "../../../../lib/storage";
import { cleanupSupportDocImportedRecords } from "../../../../lib/company-support-doc-cleanup";

// Vercel route timeout — full reimport runs Claude across every document.
// 60 = Hobby max; Pro applies its own plan limit when exceeded.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST() {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = rateLimit(`reimport:${userId}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });

  await prismaReady;
  const company = await ensureCompanyForUser(prisma, userId);

  const docs = await prisma.companyDocument.findMany({
    where: { companyId: company.id, OR: [{ fileContent: { not: null } }, { storagePath: { not: "" } }] },
    select: { id: true, originalFileName: true, mimeType: true, fileContent: true, storagePath: true, metadata: true },
  });

  let reextracted = 0;
  const failedFiles: Array<{ name: string; error: string }> = [];
  for (const doc of docs) {
    if (!doc.fileContent && !doc.storagePath) continue;
    try {
      let buffer: Buffer;
      if (doc.fileContent) {
        buffer = Buffer.from(doc.fileContent, "base64");
      } else {
        buffer = await getStorageAdapter().getFile({ storagePath: doc.storagePath, fileContent: null, fileName: doc.originalFileName });
      }
      const extractedText = await extractTextFromBuffer(buffer, doc.mimeType, doc.originalFileName);
      const fileType = getFileTypeLabel(doc.mimeType, doc.originalFileName);
      const meaningful = isMeaningfulExtraction(extractedText);
      let metadata: Record<string, unknown> = {};
      try { metadata = JSON.parse(doc.metadata || "{}"); } catch { metadata = {}; }

      await prisma.companyDocument.update({
        where: { id: doc.id },
        data: {
          extractedText: extractedText || null,
          aiExtractionStatus: meaningful ? "PENDING" : "FAILED",
          aiExtractionError: meaningful ? null : "No text extracted from document",
          metadata: JSON.stringify({
            ...metadata,
            fileType,
            reExtractedAt: new Date().toISOString(),
            extracted: meaningful,
            extractedChars: meaningful ? extractedText.length : 0,
            extractionStatus: meaningful ? "EXTRACTED" : extractedText ? "WARNING" : "EMPTY",
          }),
        },
      });
      reextracted += 1;
    } catch (err) {
      logger.error(`[reimport] re-extract failed for ${doc.originalFileName}:`, { detail: err });
      // Surface WHICH files failed (not the raw error text)
      failedFiles.push({ name: doc.originalFileName, error: "Processing failed" });
    }
  }

  const cleanupBefore = await cleanupSupportDocImportedRecords(company.id);
  const primary = await importCompanyKnowledgeFromDocuments(company.id);

  // Safety import is a regex fallback — only run it when the AI extraction
  // found nothing (all AI calls failed or returned zero results). Running it
  // Safety import runs only when AI was disabled or failed — not when AI ran cleanly with 0 results.
  const aiRanSuccessfully = primary.aiUsed && primary.aiFailures === 0;
  const emptyResult = { docsScanned: 0, expertsCreated: 0, projectsCreated: 0, expertNamesDetected: 0, projectNamesDetected: 0 };
  const safety = aiRanSuccessfully ? emptyResult : await runCompanyKnowledgeSafetyImport(prisma, company.id);
  const cleanupAfter = await cleanupSupportDocImportedRecords(company.id);

  return NextResponse.json({
    success: true,
    docsReextracted: reextracted,
    docsFailed: failedFiles.length,
    failedFiles, // Array<{ name, error }> — surfaces which files failed and why
    docsProcessed: primary.docsProcessed,
    expertsCreated: primary.expertsCreated + safety.expertsCreated,
    projectsCreated: primary.projectsCreated + safety.projectsCreated,
    supportCleanup: {
      supportDocuments: Math.max(cleanupBefore.supportDocuments, cleanupAfter.supportDocuments),
      expertsDeleted: cleanupBefore.expertsDeleted + cleanupAfter.expertsDeleted,
      projectsDeleted: cleanupBefore.projectsDeleted + cleanupAfter.projectsDeleted,
    },
    primaryImport: primary,
    safetyImport: safety,
  });
}
