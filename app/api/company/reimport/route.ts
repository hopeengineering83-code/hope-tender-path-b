import { logger } from "../../../../lib/observability";
import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { importCompanyKnowledgeFromDocuments } from "../../../../lib/company-knowledge-import-safe";
import { autoVerifyCompanyKnowledge } from "../../../../lib/company-auto-verification";
import { runCompanyKnowledgeSafetyImport } from "../../../../lib/company-knowledge-safety-import";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "../../../../lib/rate-limit";
import { extractTextFromBuffer, getFileTypeLabel, isMeaningfulExtraction } from "../../../../lib/extract-text";
import { inspectOfficeContainerBytes } from "../../../../lib/office-container-integrity";
import { ensureCompanyForUser } from "../../../../lib/company-workspace";
import { getStorageAdapter } from "../../../../lib/storage";
import { cleanupSupportDocImportedRecords } from "../../../../lib/company-support-doc-cleanup";
import { extractRequestId } from "../../../../lib/request-id";
import { logAction } from "../../../../lib/audit";
import { COMPANY_DOCUMENT_PENDING_DELETE_MARKER } from "../../../../lib/company-document-durable-deletion";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

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
    const failedFiles: Array<{ name: string; error: string }> = [];
    for (const doc of docs) {
      if (!doc.fileContent && !doc.storagePath) continue;
      try {
        const buffer = doc.fileContent
          ? Buffer.from(doc.fileContent, "base64")
          : await getStorageAdapter().getFile({
              storagePath: doc.storagePath,
              fileContent: null,
              fileName: doc.originalFileName,
            });

        const inspection = inspectOfficeContainerBytes(buffer, doc.originalFileName, doc.mimeType);
        const extractedText = inspection.kind === "json"
          ? inspection.text
          : inspection.kind === "invalid"
            ? `[Extraction failed for ${doc.originalFileName}: ${inspection.reason}]`
            : await extractTextFromBuffer(buffer, doc.mimeType, doc.originalFileName);

        const fileType = inspection.kind === "json"
          ? "JSON record"
          : getFileTypeLabel(doc.mimeType, doc.originalFileName);
        const meaningful = isMeaningfulExtraction(extractedText);
        let metadata: Record<string, unknown> = {};
        try {
          metadata = JSON.parse(doc.metadata || "{}") as Record<string, unknown>;
        } catch {
          metadata = {};
        }

        await prisma.companyDocument.update({
          where: { id: doc.id },
          data: {
            extractedText: extractedText || null,
            aiExtractionStatus: meaningful ? "PENDING" : "FAILED",
            aiExtractionError: meaningful ? null : inspection.kind === "invalid" ? inspection.reason : "No text extracted from document",
            metadata: JSON.stringify({
              ...metadata,
              fileType,
              byteInspection: inspection.kind,
              reExtractedAt: new Date().toISOString(),
              extracted: meaningful,
              extractedChars: meaningful ? extractedText.length : 0,
              extractionStatus: meaningful ? "EXTRACTED" : extractedText ? "WARNING" : "EMPTY",
            }),
          },
        });
        if (meaningful) reextracted += 1;
        else failedFiles.push({ name: doc.originalFileName, error: "Processing failed" });
      } catch (error) {
        logger.error("company reimport extraction failed", {
          requestId,
          documentId: doc.id,
          errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
        });
        failedFiles.push({ name: doc.originalFileName, error: "Processing failed" });
      }
    }

    const primary = await importCompanyKnowledgeFromDocuments(company.id);
    const aiRanSuccessfully = primary.aiUsed && primary.aiFailures === 0;
    const emptyResult = {
      docsScanned: 0,
      expertsCreated: 0,
      projectsCreated: 0,
      expertNamesDetected: 0,
      projectNamesDetected: 0,
    };
    const safety = aiRanSuccessfully
      ? emptyResult
      : await runCompanyKnowledgeSafetyImport(prisma, company.id);
    const autoVerification = aiRanSuccessfully
      ? await autoVerifyCompanyKnowledge(company.id)
      : { expertsVerified: 0, projectsVerified: 0, expertsBlocked: 0, projectsBlocked: 0 };
    const supportCleanup = await cleanupSupportDocImportedRecords(company.id);

    const result = {
      success: true,
      docsReextracted: reextracted,
      docsFailed: failedFiles.length,
      failedFiles,
      docsProcessed: primary.docsProcessed,
      expertsCreated: primary.expertsCreated + safety.expertsCreated,
      projectsCreated: primary.projectsCreated + safety.projectsCreated,
      expertsAutoVerified: autoVerification.expertsVerified,
      projectsAutoVerified: autoVerification.projectsVerified,
      autoVerificationBlocked: autoVerification.expertsBlocked + autoVerification.projectsBlocked,
      supportCleanup,
      primaryImport: primary,
      safetyImport: safety,
      autoVerification,
    };

    void logAction({
      userId: actor.id,
      action: "COMPANY_KNOWLEDGE_REPAIR",
      entityType: "Company",
      entityId: company.id,
      description: `Company knowledge reimport completed automatically: ${result.expertsCreated} experts and ${result.projectsCreated} projects created; ${result.expertsAutoVerified} experts and ${result.projectsAutoVerified} projects source-verified; ${supportCleanup.expertsDeleted} support-derived experts and ${supportCleanup.projectsDeleted} support-derived projects removed.`,
      metadata: {
        docsReextracted: result.docsReextracted,
        docsFailed: result.docsFailed,
        expertsCreated: result.expertsCreated,
        projectsCreated: result.projectsCreated,
        expertsAutoVerified: result.expertsAutoVerified,
        projectsAutoVerified: result.projectsAutoVerified,
        autoVerificationBlocked: result.autoVerificationBlocked,
        supportCleanup,
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
