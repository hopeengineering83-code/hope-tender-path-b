import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { importCompanyKnowledgeFromDocuments } from "../../../../lib/company-knowledge-import-safe";
import { extractTextFromBuffer, getFileTypeLabel, isMeaningfulExtraction } from "../../../../lib/extract-text";

export async function POST() {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const company = await prisma.company.findUnique({ where: { userId } });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  // Step 1: force re-extract ALL documents (not just those under 1000 chars)
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
          // Reset AI status so the import step re-runs AI extraction on this doc
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

  // Step 2: run knowledge import on all fresh text
  const result = await importCompanyKnowledgeFromDocuments(company.id);

  return NextResponse.json({
    success: true,
    docsReextracted: reextracted,
    docsProcessed: result.docsProcessed,
    expertsCreated: result.expertsCreated,
    projectsCreated: result.projectsCreated,
  });
}
