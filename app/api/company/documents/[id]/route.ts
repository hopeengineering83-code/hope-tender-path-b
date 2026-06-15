import { NextResponse } from "next/server";
import { getSession, requirePermission } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { logAction } from "../../../../../lib/audit";
import { extractTextFromBuffer, getFileTypeLabel, isMeaningfulExtraction } from "../../../../../lib/extract-text";
import { importCompanyKnowledgeFromDocuments } from "../../../../../lib/company-knowledge-import-safe";
import { runCompanyKnowledgeSafetyImport } from "../../../../../lib/company-knowledge-safety-import";
import { getStorageAdapter } from "../../../../../lib/storage";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "../../../../../lib/rate-limit";

async function companyForUser(userId: string) {
  return prisma.company.findUnique({ where: { userId } });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id } = await params;
  const company = await companyForUser(userId);
  if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const doc = await prisma.companyDocument.findFirst({ where: { id, companyId: company.id } });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!doc.fileContent && !doc.storagePath) {
    return NextResponse.json({ error: "File content not available" }, { status: 404 });
  }

  try {
    const buffer = await getStorageAdapter().getFile({
      storagePath: doc.storagePath,
      fileContent: doc.fileContent,
      fileName: doc.originalFileName,
    });
    const safeFileName = doc.originalFileName.replace(/[^a-zA-Z0-9._\- ()]/g, "_");
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": doc.mimeType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safeFileName}"`,
        "Content-Length": buffer.length.toString(),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "File content could not be retrieved from storage" }, { status: 502 });
  }
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let actor;
  try {
    actor = await requirePermission("COMPANY_KNOWLEDGE_MGMT");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limit = await rateLimitPersistent(`doc-reimport:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!limit.allowed) {
    const retryAfter = Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000));
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }

  await prismaReady;
  const { id } = await params;
  const company = await companyForUser(actor.id);
  if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const doc = await prisma.companyDocument.findFirst({ where: { id, companyId: company.id } });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!doc.fileContent && !doc.storagePath) return NextResponse.json({ error: "File content not stored" }, { status: 400 });

  let buffer: Buffer;
  try {
    buffer = await getStorageAdapter().getFile({
      storagePath: doc.storagePath,
      fileContent: doc.fileContent,
      fileName: doc.originalFileName,
    });
  } catch {
    return NextResponse.json({ error: "File content could not be retrieved from storage" }, { status: 502 });
  }

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
    } catch (error) {
      knowledgeImportError = error instanceof Error ? error.constructor.name : "UnknownError";
      console.error("[document reextract] knowledge import failed", { errorClass: knowledgeImportError });
    }
  }

  await logAction({
    userId: actor.id,
    action: "COMPANY_DOCUMENT_REEXTRACT",
    entityType: "CompanyDocument",
    entityId: id,
    description: `Re-extracted "${doc.originalFileName}"`,
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
  let actor;
  try {
    actor = await requirePermission("COMPANY_KNOWLEDGE_MGMT");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limit = await rateLimitPersistent(`doc-delete:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!limit.allowed) {
    const retryAfter = Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000));
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }

  await prismaReady;
  const { id } = await params;
  const company = await companyForUser(actor.id);
  if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const doc = await prisma.companyDocument.findFirst({ where: { id, companyId: company.id } });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    await getStorageAdapter().deleteFile({
      storagePath: doc.storagePath,
      fileContent: doc.fileContent,
      fileName: doc.originalFileName,
    });
  } catch {
    return NextResponse.json({ error: "Stored file could not be deleted safely" }, { status: 502 });
  }

  const result = await prisma.$transaction(async (tx) => {
    const draftExpertsRemoved = await tx.expert.deleteMany({
      where: { companyId: company.id, sourceDocumentId: id, trustLevel: { in: ["AI_DRAFT", "REGEX_DRAFT"] } },
    });
    const draftProjectsRemoved = await tx.project.deleteMany({
      where: { companyId: company.id, sourceDocumentId: id, trustLevel: { in: ["AI_DRAFT", "REGEX_DRAFT"] } },
    });
    await tx.companyDocument.delete({ where: { id } });
    return { draftExpertsRemoved, draftProjectsRemoved };
  });

  await logAction({
    userId: actor.id,
    action: "COMPANY_DOCUMENT_DELETE",
    entityType: "CompanyDocument",
    entityId: id,
    description: `Deleted company document "${doc.originalFileName}" and its unreviewed derived records`,
    metadata: {
      companyId: company.id,
      draftExpertsRemoved: result.draftExpertsRemoved.count,
      draftProjectsRemoved: result.draftProjectsRemoved.count,
    },
  });

  return NextResponse.json({
    success: true,
    draftExpertsRemoved: result.draftExpertsRemoved.count,
    draftProjectsRemoved: result.draftProjectsRemoved.count,
  });
}
