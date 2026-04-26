import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { importCompanyKnowledgeFromDocuments } from "../../../../lib/company-knowledge-import-safe";
import { runCompanyKnowledgeSafetyImport } from "../../../../lib/company-knowledge-safety-import";
import { extractTextFromBuffer, getFileTypeLabel, isMeaningfulExtraction } from "../../../../lib/extract-text";
import { ensureCompanyForUser } from "../../../../lib/company-workspace";

export async function POST() {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const company = await ensureCompanyForUser(prisma, userId);

  const docs = await prisma.companyDocument.findMany({
    where: { companyId: company.id, fileContent: { not: null } },
    select: { id: true, originalFileName: true, mimeType: true, fileContent: true, metadata: true },
  });

  let reextracted = 0;
  for (const doc of docs) {
    if (!doc.fileContent) continue;
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
      console.error(`[reimport] re-extract failed for ${doc.originalFileName}:`, err);
    }
  }

  const primary = await importCompanyKnowledgeFromDocuments(company.id);
  const safety = await runCompanyKnowledgeSafetyImport(prisma, company.id);

  return NextResponse.json({
    success: true,
    docsReextracted: reextracted,
    docsProcessed: primary.docsProcessed,
    expertsCreated: primary.expertsCreated + safety.expertsCreated,
    projectsCreated: primary.projectsCreated + safety.projectsCreated,
    primaryImport: primary,
    safetyImport: safety,
  });
}
