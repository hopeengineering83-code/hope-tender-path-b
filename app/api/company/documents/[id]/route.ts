import { logger } from "../../../../../lib/observability";
import { NextResponse } from "next/server";
import {
  forbiddenResponse,
  getSession,
  requireRole,
  unauthorizedResponse,
} from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { logAction } from "../../../../../lib/audit";
import { extractTextFromBuffer, getFileTypeLabel, isMeaningfulExtraction } from "../../../../../lib/extract-text";
import { assessExtractionQuality, assessExtractionQualityPerPage } from "../../../../../lib/extraction-quality";
import { ingestCompanyVault } from "../../../../../lib/company-vault-ingestion";
import { getStorageAdapter } from "../../../../../lib/storage";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "../../../../../lib/rate-limit";
import {
  deleteCompanyDocumentDurably,
  isCompanyDocumentPendingDeletion,
} from "../../../../../lib/company-document-durable-deletion";
import { inspectActualFileBytes } from "../../../../../lib/engine/persisted-byte-integrity";
import { limitExtractedText } from "../../../../../lib/upload-security";

async function companyForUser(userId: string) {
  return prisma.company.findUnique({ where: { userId } });
}

function safeDocumentDownloadName(id: string, originalFileName: string): string {
  const extensionMatch = originalFileName.match(/\.([a-zA-Z0-9]{1,12})$/);
  const extension = extensionMatch ? `.${extensionMatch[1].toLowerCase()}` : "";
  return `company-document-${id.slice(0, 8)}${extension}`;
}

function parseMetadata(value: string | null | undefined): Record<string, unknown> {
  try {
    return JSON.parse(value || "{}") as Record<string, unknown>;
  } catch (e) {
    // JSON parse failed — return {} so caller treats row as having no
    // parsed payload. Surface the failure so corrupted rows are observable.
    logger.warn("[company/documents] parseMetadata failed — returning {}", {
      detail: e,
    });
    return {};
  }
}

function nextExtractionRevision(metadata: Record<string, unknown>): number {
  const current = Number(metadata.extractionRevision);
  return Number.isInteger(current) && current > 0 ? current + 1 : 2;
}

export const maxDuration = 60;

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
  if (!doc || isCompanyDocumentPendingDeletion(doc.metadata)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!doc.fileContent && !doc.storagePath) {
    return NextResponse.json({ error: "File content not available" }, { status: 404 });
  }

  try {
    const buffer = await getStorageAdapter().getFile({
      storagePath: doc.storagePath,
      fileContent: doc.fileContent,
      fileName: doc.originalFileName,
    });
    const safeFileName = safeDocumentDownloadName(doc.id, doc.originalFileName);
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
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (error) {
    return error instanceof Error && error.message === "Forbidden"
      ? forbiddenResponse()
      : unauthorizedResponse();
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
  if (!doc || isCompanyDocumentPendingDeletion(doc.metadata)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
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

  const metadata = parseMetadata(doc.metadata);
  const extractionRevision = nextExtractionRevision(metadata);
  const integrity = inspectActualFileBytes({
    bytes: buffer,
    filename: doc.originalFileName,
    claimedMimeType: doc.mimeType,
  });

  if (integrity.integrityStatus !== "VERIFIED") {
    await prisma.companyDocument.update({
      where: { id },
      data: {
        ...integrity,
        extractedText: null,
        aiExtractionStatus: "FAILED",
        aiExtractedAt: null,
        aiExtractionError: "Source byte integrity verification failed.",
        metadata: JSON.stringify({
          ...metadata,
          extractionRevision,
          reExtractedAt: new Date().toISOString(),
          extracted: false,
          extractionStatus: "INTEGRITY_FAILED",
          integrityFailureCode: integrity.integrityFailureCode,
        }),
      },
    });
    return NextResponse.json({
      error: "Source byte integrity verification failed.",
      code: integrity.integrityFailureCode ?? "FILE_INTEGRITY_NOT_VERIFIED",
    }, { status: 422 });
  }

  const extracted = limitExtractedText(
    await extractTextFromBuffer(buffer, integrity.contentMimeType ?? doc.mimeType, doc.originalFileName),
  );
  const extractedText = extracted.text;
  const fileType = getFileTypeLabel(integrity.contentMimeType ?? doc.mimeType, doc.originalFileName);
  const meaningful = isMeaningfulExtraction(extractedText);
  const quality = assessExtractionQuality(extractedText, doc.originalFileName);
  const perPage = assessExtractionQualityPerPage(extractedText);

  await prisma.companyDocument.update({
    where: { id },
    data: {
      ...integrity,
      mimeType: integrity.contentMimeType ?? doc.mimeType,
      size: buffer.byteLength,
      extractedText: extractedText || null,
      aiExtractionStatus: meaningful ? "PENDING" : "FAILED",
      aiExtractedAt: null,
      aiExtractionError: meaningful ? null : "No usable text extracted from document",
      metadata: JSON.stringify({
        ...metadata,
        fileType,
        extractionRevision,
        reExtractedAt: new Date().toISOString(),
        extracted: meaningful,
        extractedChars: meaningful ? extractedText.length : 0,
        extractionStatus: meaningful ? (extracted.truncated ? "TRUNCATED" : "EXTRACTED") : extractedText ? "WARNING" : "EMPTY",
        extractionScore: quality.score,
        pageStatus: perPage.pages,
        totalPages: perPage.totalDetectedPages,
        failedPages: perPage.failedPages,
        ocrPages: perPage.ocrPages,
      }),
    },
  });

  let knowledgeImport: Awaited<ReturnType<typeof ingestCompanyVault>> | null = null;
  let knowledgeImportError: string | null = null;
  if (meaningful) {
    try {
      knowledgeImport = await ingestCompanyVault(company.id);
    } catch (error) {
      knowledgeImportError = error instanceof Error ? error.constructor.name : "UnknownError";
      logger.error("[document reextract] canonical company ingestion failed", { errorClass: knowledgeImportError });
    }
  }

  await logAction({
    userId: actor.id,
    action: "COMPANY_DOCUMENT_REEXTRACT",
    entityType: "CompanyDocument",
    entityId: id,
    description: "Re-extracted and byte-verified a company source document.",
    metadata: {
      companyId: company.id,
      fileName: doc.originalFileName,
      fileType,
      extracted: meaningful,
      extractionRevision,
      extractionScore: quality.score,
      knowledgeImport,
      knowledgeImportError,
    },
  });

  return NextResponse.json({
    success: true,
    extractedChars: meaningful ? extractedText.length : 0,
    extracted: meaningful,
    extractionRevision,
    extractionScore: quality.score,
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
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (error) {
    return error instanceof Error && error.message === "Forbidden"
      ? forbiddenResponse()
      : unauthorizedResponse();
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

  const result = await deleteCompanyDocumentDurably({
    prisma,
    storage: getStorageAdapter(),
    companyId: company.id,
    documentId: id,
  });

  if (!result.ok) {
    const error = result.code === "REVIEWED_PROVENANCE_DEPENDENCY"
      ? "Deletion blocked because reviewed experts or projects still depend on this source document."
      : result.code === "NOT_FOUND"
        ? "Not found"
        : "Document deletion is pending a safe retry.";
    return NextResponse.json({ error, ...result }, { status: result.status });
  }

  await logAction({
    userId: actor.id,
    action: "COMPANY_DOCUMENT_DELETE",
    entityType: "CompanyDocument",
    entityId: id,
    description: "Deleted a company source document and its unreviewed derived records",
    metadata: {
      companyId: company.id,
      draftExpertsRemoved: result.draftExpertsRemoved,
      draftProjectsRemoved: result.draftProjectsRemoved,
    },
  });

  return NextResponse.json({ success: true, ...result });
}
