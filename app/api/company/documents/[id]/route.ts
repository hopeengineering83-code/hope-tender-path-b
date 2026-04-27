import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { logAction } from "../../../../../lib/audit";
import { extractTextFromBuffer, getFileTypeLabel, isMeaningfulExtraction } from "../../../../../lib/extract-text";
import { importCompanyKnowledgeFromDocuments } from "../../../../../lib/company-knowledge-import-safe";
import { runCompanyKnowledgeSafetyImport } from "../../../../../lib/company-knowledge-safety-import";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id } = await params;

  const company = await prisma.company.findUnique({ where: { userId } });
  if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const doc = await prisma.companyDocument.findFirst({
    where: { id, companyId: company.id },
  });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!doc.fileContent) {
    return NextResponse.json({ error: "File content not available" }, { status: 404 });
  }

  const buffer = Buffer.from(doc.fileContent, "base64");
  const safeFileName = doc.originalFileName.replace(/[^a-zA-Z0-9._\- ()]/g, "_");

  return new Response(buffer, {
    headers: {
      "Content-Type": doc.mimeType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeFileName}"`,
      "Content-Length": buffer.length.toString(),
    },
  });
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id } = await params;

  const company = await prisma.company.findUnique({ where: { userId } });
  if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const doc = await prisma.companyDocument.findFirst({ where: { id, companyId: company.id } });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!doc.fileContent) return NextResponse.json({ error: "File content not stored" }, { status: 400 });

  const buffer = Buffer.from(doc.fileContent, "base64");
  const extractedText = await extractTextFromBuffer(buffer, doc.mimeType, doc.originalFileName);
  const fileType = getFileTypeLabel(doc.mimeType, doc.originalFileName);
  const meaningful = isMeaningfulExtraction(extractedText);
  let metadata: Record<string, unknown> = {};
  try { metadata = JSON.parse(doc.metadata || "{}"); } catch { metadata = {}; }

  await prisma.companyDocument.update({
    where: { id },
    data: {
      extractedText: extractedText || null,
      aiExtractionStatus: meaningful ? "PENDING" : "FAILED",
      aiExtractedAt: null,
      aiExtractionError: meaningful ? null : "No usable text extracted from document",
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

  let knowledgeImport: (Awaited<ReturnType<typeof importCompanyKnowledgeFromDocuments>> & { safetyImport?: Awaited<ReturnType<typeof runCompanyKnowledgeSafetyImport>> }) | null = null;
  let knowledgeImportError: string | null = null;
  if (meaningful) {
    try {
      const primary = await importCompanyKnowledgeFromDocuments(company.id);
      const aiSucceeded = primary.aiUsed && primary.aiFailures === 0 &&
        (primary.expertsCreated > 0 || primary.projectsCreated > 0);
      const emptyResult = { docsScanned: 0, expertsCreated: 0, projectsCreated: 0, expertNamesDetected: 0, projectNamesDetected: 0 };
      const safetyImport = aiSucceeded ? emptyResult : await runCompanyKnowledgeSafetyImport(prisma, company.id);
      knowledgeImport = { ...primary, safetyImport };
    } catch (err) {
      knowledgeImportError = err instanceof Error ? err.message : String(err);
      console.error("[document reextract] knowledge import failed:", err);
    }
  }

  await logAction({
    userId,
    action: "COMPANY_DOCUMENT_REEXTRACT",
    entityType: "CompanyDocument",
    entityId: id,
    description: `Re-extracted "${doc.originalFileName}" — ${meaningful ? `${extractedText.length.toLocaleString()} chars` : "no text extracted"}`,
    metadata: { companyId: company.id, fileName: doc.originalFileName, fileType, extracted: meaningful, knowledgeImport, knowledgeImportError },
  });

  return NextResponse.json({
    success: true,
    extractedChars: meaningful ? extractedText.length : 0,
    extracted: meaningful,
    knowledgeImport,
    knowledgeImportError,
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id } = await params;

  const company = await prisma.company.findUnique({ where: { userId } });
  if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const doc = await prisma.companyDocument.findFirst({
    where: { id, companyId: company.id },
  });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [draftExpertsRemoved, draftProjectsRemoved] = await Promise.all([
    prisma.expert.deleteMany({
      where: {
        companyId: company.id,
        sourceDocumentId: id,
        trustLevel: { in: ["AI_DRAFT", "REGEX_DRAFT"] },
      },
    }),
    prisma.project.deleteMany({
      where: {
        companyId: company.id,
        sourceDocumentId: id,
        trustLevel: { in: ["AI_DRAFT", "REGEX_DRAFT"] },
      },
    }),
  ]);

  await prisma.companyDocument.delete({ where: { id } });

  await logAction({
    userId,
    action: "COMPANY_DOCUMENT_DELETE",
    entityType: "CompanyDocument",
    entityId: id,
    description: `Deleted company document "${doc.originalFileName}" (${doc.category}) and removed ${draftExpertsRemoved.count} draft expert(s), ${draftProjectsRemoved.count} draft project(s) sourced from it`,
    metadata: { companyId: company.id, draftExpertsRemoved: draftExpertsRemoved.count, draftProjectsRemoved: draftProjectsRemoved.count },
  });

  return NextResponse.json({ success: true, draftExpertsRemoved: draftExpertsRemoved.count, draftProjectsRemoved: draftProjectsRemoved.count });
}
