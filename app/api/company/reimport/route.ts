import { logger } from "../../../../lib/observability";
import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { ingestCompanyVault } from "../../../../lib/company-vault-ingestion";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "../../../../lib/rate-limit";
import { extractTextFromBuffer, getFileTypeLabel, isMeaningfulExtraction } from "../../../../lib/extract-text";
import { assessExtractionQuality, assessExtractionQualityPerPage } from "../../../../lib/extraction-quality";
import { inspectOfficeContainerBytes } from "../../../../lib/office-container-integrity";
import { inspectActualFileBytes } from "../../../../lib/engine/persisted-byte-integrity";
import { ensureCompanyForUser } from "../../../../lib/company-workspace";
import { getStorageAdapter } from "../../../../lib/storage";
import { cleanupSupportDocImportedRecords } from "../../../../lib/company-support-doc-cleanup";
import { extractRequestId } from "../../../../lib/request-id";
import { logAction } from "../../../../lib/audit";
import { COMPANY_DOCUMENT_PENDING_DELETE_MARKER } from "../../../../lib/company-document-durable-deletion";
import { limitExtractedText } from "../../../../lib/upload-security";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function parseMetadata(value: string | null | undefined): Record<string, unknown> {
  try { return JSON.parse(value || "{}") as Record<string, unknown>; }
  catch { return {}; }
}

function nextExtractionRevision(metadata: Record<string, unknown>): number {
  const current = Number(metadata.extractionRevision);
  return Number.isInteger(current) && current > 0 ? current + 1 : 2;
}

export async function POST(req: Request) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (error) {
    return error instanceof Error && error.message === "Forbidden"
      ? forbiddenResponse()
      : unauthorizedResponse();
  }

  const requestId = extractRequestId(req);
  const rl = await rateLimitPersistent(`reimport:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { error: "Too many requests", code: "RATE_LIMITED", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  try {
    await prismaReady;
    const company = await ensureCompanyForUser(prisma, actor.id);

    const docs = await prisma.companyDocument.findMany({
      where: {
        companyId: company.id,
        NOT: { metadata: { contains: COMPANY_DOCUMENT_PENDING_DELETE_MARKER } },
        OR: [{ fileContent: { not: null } }, { storagePath: { not: "" } }],
      },
      select: {
        id: true,
        originalFileName: true,
        mimeType: true,
        fileContent: true,
        storagePath: true,
        metadata: true,
      },
    });

    let reextracted = 0;
    const failedFiles: Array<{ name: string; error: string; code?: string }> = [];
    for (const doc of docs) {
      if (!doc.fileContent && !doc.storagePath) continue;
      const metadata = parseMetadata(doc.metadata);
      const extractionRevision = nextExtractionRevision(metadata);
      try {
        const buffer = doc.fileContent
          ? Buffer.from(doc.fileContent, "base64")
          : await getStorageAdapter().getFile({
              storagePath: doc.storagePath,
              fileContent: null,
              fileName: doc.originalFileName,
            });

        const integrity = inspectActualFileBytes({
          bytes: buffer,
          filename: doc.originalFileName,
          claimedMimeType: doc.mimeType,
        });
        if (integrity.integrityStatus !== "VERIFIED") {
          await prisma.companyDocument.update({
            where: { id: doc.id },
            data: {
              ...integrity,
              extractedText: null,
              aiExtractionStatus: "FAILED",
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
          failedFiles.push({
            name: doc.originalFileName,
            error: "Byte integrity verification failed",
            code: integrity.integrityFailureCode ?? "FILE_INTEGRITY_NOT_VERIFIED",
          });
          continue;
        }

        const inspection = inspectOfficeContainerBytes(buffer, doc.originalFileName, integrity.contentMimeType ?? doc.mimeType);
        const rawText = inspection.kind === "json"
          ? inspection.text
          : inspection.kind === "invalid"
            ? ""
            : await extractTextFromBuffer(buffer, integrity.contentMimeType ?? doc.mimeType, doc.originalFileName);
        const extracted = limitExtractedText(rawText);
        const extractedText = extracted.text;
        const fileType = inspection.kind === "json"
          ? "JSON record"
          : getFileTypeLabel(integrity.contentMimeType ?? doc.mimeType, doc.originalFileName);
        const meaningful = isMeaningfulExtraction(extractedText);
        const quality = assessExtractionQuality(extractedText, doc.originalFileName);
        const perPage = assessExtractionQualityPerPage(extractedText);

        await prisma.companyDocument.update({
          where: { id: doc.id },
          data: {
            ...integrity,
            mimeType: integrity.contentMimeType ?? doc.mimeType,
            size: buffer.byteLength,
            extractedText: extractedText || null,
            aiExtractionStatus: meaningful ? "PENDING" : "FAILED",
            aiExtractedAt: null,
            aiExtractionError: meaningful
              ? null
              : inspection.kind === "invalid"
                ? inspection.reason
                : "No meaningful text extracted from document",
            metadata: JSON.stringify({
              ...metadata,
              fileType,
              byteInspection: inspection.kind,
              extractionRevision,
              reExtractedAt: new Date().toISOString(),
              extracted: meaningful,
              extractedChars: meaningful ? extractedText.length : 0,
              extractionStatus: meaningful ? (extracted.truncated ? "TRUNCATED" : "EXTRACTED") : "EMPTY",
              extractionScore: quality.score,
              pageStatus: perPage.pages,
              totalPages: perPage.totalDetectedPages,
              failedPages: perPage.failedPages,
              ocrPages: perPage.ocrPages,
            }),
          },
        });
        if (meaningful) reextracted += 1;
        else failedFiles.push({ name: doc.originalFileName, error: "No meaningful text extracted" });
      } catch (error) {
        logger.error("company reimport extraction failed", {
          requestId,
          documentId: doc.id,
          errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
        });
        failedFiles.push({ name: doc.originalFileName, error: "Processing failed" });
      }
    }

    const ingestion = await ingestCompanyVault(company.id);
    const supportAudit = await cleanupSupportDocImportedRecords(company.id);
    const sourceVerification = ingestion.sourceVerification;

    const result = {
      success: true,
      docsReextracted: reextracted,
      docsFailed: failedFiles.length,
      failedFiles,
      docsProcessed: ingestion.docsProcessed,
      expertsCreated: ingestion.expertsCreated,
      projectsCreated: ingestion.projectsCreated,
      expertsUpdated: ingestion.expertsUpdated,
      projectsUpdated: ingestion.projectsUpdated,
      expertsSourceVerified: sourceVerification.expertsVerified,
      projectsSourceVerified: sourceVerification.projectsVerified,
      sourceVerificationBlocked: sourceVerification.expertsBlocked + sourceVerification.projectsBlocked,
      supportAudit,
      ingestion,
    };

    void logAction({
      userId: actor.id,
      action: "COMPANY_KNOWLEDGE_REPAIR",
      entityType: "Company",
      entityId: company.id,
      description: `Company Vault reimport completed: ${result.expertsCreated} experts and ${result.projectsCreated} projects created; ${result.expertsSourceVerified} experts and ${result.projectsSourceVerified} projects machine source-verified; uncertain mixed-document records were preserved for review.`,
      metadata: {
        docsReextracted: result.docsReextracted,
        docsFailed: result.docsFailed,
        expertsCreated: result.expertsCreated,
        projectsCreated: result.projectsCreated,
        expertsUpdated: result.expertsUpdated,
        projectsUpdated: result.projectsUpdated,
        expertsSourceVerified: result.expertsSourceVerified,
        projectsSourceVerified: result.projectsSourceVerified,
        sourceVerificationBlocked: result.sourceVerificationBlocked,
        supportAudit,
      },
      requestId,
    }).catch((error) => {
      logger.warn("company reimport audit persistence failed", {
        requestId,
        errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      });
    });

    return NextResponse.json(result);
  } catch (error) {
    logger.error("company reimport failed", {
      requestId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return NextResponse.json(
      {
        error: "Company knowledge reimport failed. Retry or contact support with the request ID.",
        code: "COMPANY_REIMPORT_FAILED",
        requestId,
      },
      { status: 500 },
    );
  }
}
