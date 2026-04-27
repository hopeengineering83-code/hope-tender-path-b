import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { importCompanyKnowledgeFromDocuments } from "../../../../lib/company-knowledge-import-safe";
import { runCompanyKnowledgeSafetyImport } from "../../../../lib/company-knowledge-safety-import";
import { extractTextFromBuffer, getFileTypeLabel, isMeaningfulExtraction } from "../../../../lib/extract-text";
import { ensureCompanyForUser } from "../../../../lib/company-workspace";

const SUPPORT_ONLY_CATEGORIES = new Set([
  "COMPANY_PROFILE",
  "LEGAL_REGISTRATION",
  "FINANCIAL_STATEMENT",
  "MANUAL",
  "COMPLIANCE_RECORD",
  "CERTIFICATION",
  "OTHER",
]);

async function cleanupSupportDocImportedRecords(companyId: string) {
  const supportDocs = await prisma.companyDocument.findMany({
    where: { companyId, category: { in: [...SUPPORT_ONLY_CATEGORIES] } },
    select: { id: true, originalFileName: true, category: true },
  });
  const supportDocIds = supportDocs.map((d) => d.id);
  const supportFileNames = supportDocs.map((d) => d.originalFileName).filter(Boolean);

  const [directExperts, directProjects] = await Promise.all([
    supportDocIds.length ? prisma.expert.deleteMany({ where: { companyId, sourceDocumentId: { in: supportDocIds } } }) : Promise.resolve({ count: 0 }),
    supportDocIds.length ? prisma.project.deleteMany({ where: { companyId, sourceDocumentId: { in: supportDocIds } } }) : Promise.resolve({ count: 0 }),
  ]);

  let textExperts = 0;
  let textProjects = 0;
  for (const fileName of supportFileNames) {
    const expertIds = await prisma.expert.findMany({ where: { companyId, profile: { contains: fileName, mode: "insensitive" } }, select: { id: true } });
    const projectIds = await prisma.project.findMany({ where: { companyId, summary: { contains: fileName, mode: "insensitive" } }, select: { id: true } });
    if (expertIds.length) textExperts += (await prisma.expert.deleteMany({ where: { id: { in: expertIds.map((e) => e.id) } } })).count;
    if (projectIds.length) textProjects += (await prisma.project.deleteMany({ where: { id: { in: projectIds.map((p) => p.id) } } })).count;
  }

  return {
    supportDocuments: supportDocs.length,
    expertsDeleted: directExperts.count + textExperts,
    projectsDeleted: directProjects.count + textProjects,
  };
}

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

  const cleanupBefore = await cleanupSupportDocImportedRecords(company.id);
  const primary = await importCompanyKnowledgeFromDocuments(company.id);

  // Safety import is a regex fallback — only run it when the AI extraction
  // found nothing (all AI calls failed or returned zero results). Running it
  // unconditionally adds false-positive names on top of correct AI results.
  const aiSucceeded = primary.aiUsed && primary.aiFailures === 0 &&
    (primary.expertsCreated > 0 || primary.projectsCreated > 0);
  const emptyResult = { docsScanned: 0, expertsCreated: 0, projectsCreated: 0, expertNamesDetected: 0, projectNamesDetected: 0 };
  const safety = aiSucceeded ? emptyResult : await runCompanyKnowledgeSafetyImport(prisma, company.id);
  const cleanupAfter = await cleanupSupportDocImportedRecords(company.id);

  return NextResponse.json({
    success: true,
    docsReextracted: reextracted,
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
