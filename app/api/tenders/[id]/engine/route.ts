import { NextResponse } from "next/server";
import { logger } from "../../../../../lib/observability";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { assessExtractionQuality } from "../../../../../lib/extraction-quality";
import { actionableEngineError } from "../../../../../lib/engine/actionable-engine-error";
import { computeStoredMetadataPatch, listInvalidStoredFields } from "../../../../../lib/engine/sanitize-stored-metadata";
import { isExtractionAcceptableForGeneration } from "../../../../../lib/engine/extraction-quality-gate";
import { rateLimitPersistent, AI_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { prepareCompanyVaultForEngine } from "../../../../../lib/engine/prepare-company-vault";
import { enqueueEngineJobForCurrentSources } from "../../../../../lib/engine/enqueue-engine-job";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const CLIENT_POLICY_PARAMETERS = [
  "safe",
  "skipRematch",
  "skipAiRematch",
  "maxChars",
  "provider",
  "retryCount",
  "promotionBypass",
  "validationBypass",
  "staleStateBypass",
] as const;

function requestDiagnosticId() {
  return `eng_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const diagnosticId = requestDiagnosticId();
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (error) {
    return error instanceof Error && error.message === "Forbidden"
      ? forbiddenResponse()
      : unauthorizedResponse();
  }
  const userId = actor.id;

  const requestUrl = new URL(req.url);
  const rejectedPolicyParameters = CLIENT_POLICY_PARAMETERS.filter((parameter) =>
    requestUrl.searchParams.has(parameter),
  );
  if (rejectedPolicyParameters.length > 0) {
    return NextResponse.json({
      error: "Engine execution policy is controlled by the server.",
      code: "CLIENT_POLICY_OVERRIDE_REJECTED",
      rejectedParameters: rejectedPolicyParameters,
      diagnosticId,
    }, { status: 400 });
  }

  const rl = await rateLimitPersistent(`engine:${userId}`, AI_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.ceil((rl.resetAt - Date.now()) / 1000);
    return NextResponse.json({
      error: "Rate limit exceeded — too many engine requests. Please wait before retrying.",
      code: "RATE_LIMITED",
      retryAfter,
      diagnosticId,
    }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }

  try {
    await prismaReady;
    const { id } = await params;
    const tender = await prisma.tender.findFirst({
      where: { id, userId },
      select: {
        id: true,
        analysisExtractionStatus: true,
        title: true,
        clientName: true,
        reference: true,
        country: true,
        clientContactName: true,
        procuringEntityName: true,
        legalClientName: true,
        donorAgency: true,
        implementingAgency: true,
        files: {
          select: {
            id: true,
            originalFileName: true,
            fileName: true,
            extractedText: true,
            extractionScore: true,
            totalPages: true,
            extractedPages: true,
            ocrPages: true,
            failedPages: true,
          },
        },
      },
    });
    if (!tender) {
      return NextResponse.json({
        error: "Tender not found",
        code: "TENDER_NOT_FOUND",
        diagnosticId,
      }, { status: 404 });
    }

    if (tender.files.length === 0) {
      return NextResponse.json({
        error: "Engine run blocked: no tender file is uploaded.",
        code: "NO_TENDER_FILES",
        nextAction: "UPLOAD_TENDER_DOCUMENT",
        hint: "Upload the tender/RFP document first, then run AI Analyze or Run Engine.",
        diagnosticId,
      }, { status: 422 });
    }

    const invalidFields = listInvalidStoredFields(tender);
    if (invalidFields.length > 0) {
      await prisma.tender.update({
        where: { id: tender.id },
        data: computeStoredMetadataPatch(tender),
      });
    }

    const effectiveExtractionFiles = tender.files.map((file) => {
      const quality = assessExtractionQuality(
        file.extractedText,
        file.originalFileName || file.fileName,
      );
      return {
        ...file,
        extractionScore: Math.min(file.extractionScore ?? quality.score, quality.score),
        quality,
      };
    });
    const extractionReports = effectiveExtractionFiles.map((file) => ({
      fileName: file.originalFileName || file.fileName,
      quality: file.quality,
      totalPages: file.totalPages,
      extractedPages: file.extractedPages,
      failedPages: file.failedPages,
    }));
    const blockers = extractionReports.filter(
      (item) => item.quality.severity === "FAILED" || item.quality.severity === "POOR",
    );
    if (!isExtractionAcceptableForGeneration(effectiveExtractionFiles)) {
      const corruptedFiles = effectiveExtractionFiles
        .filter((file) => file.quality.corrupted)
        .map((file) => file.originalFileName || file.fileName || file.id);
      return NextResponse.json({
        error: "Engine run blocked: tender extraction is not reliable enough for matching or AI work.",
        code: corruptedFiles.length > 0
          ? "EXTRACTION_CORRUPTED_ENGINE_SKIPPED"
          : "EXTRACTION_QUALITY_ENGINE_BLOCKED",
        nextAction: corruptedFiles.length > 0
          ? "RUN_OCR_OR_UPLOAD_CLEARER_SCAN"
          : "OPEN_EXTRACTION_QUALITY",
        blockers,
        corruptedFiles,
        hint: "Run OCR/re-extract the tender first. Run Engine cannot be forced through corrupted, unknown-page, or incomplete extraction.",
        diagnosticId,
      }, { status: 422 });
    }

    const engineAnalysisStatus = tender.analysisExtractionStatus;
    if (engineAnalysisStatus === "OCR_REQUIRED") {
      return NextResponse.json({
        error: "Engine run blocked: AI Analyze was skipped due to corrupted extraction. Re-upload or run OCR before running the engine.",
        code: "ANALYSIS_FROM_CORRUPTED_EXTRACTION",
        nextAction: "RUN_OCR_OR_UPLOAD_CLEARER_SCAN",
        hint: "Re-extract or run OCR, then re-run AI Analyze before running the engine.",
        diagnosticId,
      }, { status: 422 });
    }
    if (
      engineAnalysisStatus === "EXTRACTION_WEAK_REVIEW_REQUIRED" ||
      engineAnalysisStatus === "REGEX_FALLBACK_FROM_WEAK_EXTRACTION"
    ) {
      return NextResponse.json({
        error: "Engine run blocked: tender analysis was produced from weak extraction. Re-extract and re-run AI Analyze before running the engine.",
        code: "ANALYSIS_FROM_WEAK_EXTRACTION",
        nextAction: "RERUN_AI_ANALYZE",
        hint: "Fix extraction quality and re-run AI Analyze before running the engine.",
        diagnosticId,
      }, { status: 422 });
    }

    let vaultPreflight: Awaited<ReturnType<typeof prepareCompanyVaultForEngine>>;
    try {
      vaultPreflight = await prepareCompanyVaultForEngine(userId);
    } catch (error) {
      logger.error("[engine route] Company Vault automatic verification failed", {
        diagnosticId,
        tenderId: id,
        errorName: error instanceof Error ? error.constructor.name : typeof error,
      });
      return NextResponse.json({
        error: "Run Engine could not refresh the Company Vault automatically.",
        code: "COMPANY_VAULT_AUTO_PROMOTION_FAILED",
        nextAction: "RETRY_AFTER_DATABASE_CHECK",
        diagnosticId,
      }, { status: 503 });
    }
    if (!vaultPreflight) {
      return NextResponse.json({
        error: "Engine run blocked: create the Company Vault profile first.",
        code: "COMPANY_VAULT_REQUIRED",
        nextAction: "OPEN_COMPANY_VAULT",
        diagnosticId,
      }, { status: 422 });
    }

    const enqueue = await enqueueEngineJobForCurrentSources(prisma, {
    tenderId: id,
    userId,
    companyId: vaultPreflight.companyId,
    purpose: "INTERNAL_ARTIFACT_PREPARATION",
  });
  if (!enqueue) {
    return NextResponse.json({
      error: "Engine source revision could not be established.",
      code: "ENGINE_SOURCE_REVISION_UNAVAILABLE",
      nextAction: "RETRY_AFTER_DATABASE_CHECK",
      diagnosticId,
    }, { status: 503 });
  }
  const { revision, idempotencyKey, job: enqueueResult } = enqueue;

    logger.info("[engine route] durable Engine job accepted", {
      diagnosticId,
      tenderId: id,
      jobId: enqueueResult.id,
      status: enqueueResult.status,
      sourceRevision: revision.sourceRevision,
      reusedActiveJob: enqueueResult.reusedActiveJob,
      companyId: vaultPreflight.companyId,
    });

    return NextResponse.json({
      jobId: enqueueResult.id,
      status: enqueueResult.status,
      persistedStatus: enqueueResult.status,
      reusedActiveJob: enqueueResult.reusedActiveJob,
      sourceRevision: revision.sourceRevision,
      idempotencyKey,
      statusEndpoint: `/api/ai-jobs/${enqueueResult.id}`,
      diagnosticId,
      vaultVerification: "COMPLETED",
      vaultVerifiedExperts: vaultPreflight.sourceVerification?.expertsVerified ?? 0,
      vaultVerifiedProjects: vaultPreflight.sourceVerification?.projectsVerified ?? 0,
      sourceInventory: {
        tenderFiles: revision.tenderFileCount,
        requirements: revision.requirementCount,
        vaultDocuments: revision.vaultDocumentCount,
        evidenceRecords: revision.evidenceRecordCount,
      },
      extractionWarnings: extractionReports.filter(
        (item) => item.quality.severity === "WARNING",
      ),
    }, { status: 202 });
  } catch (error) {
    const errorName = error instanceof Error ? error.constructor.name : typeof error;
    logger.error("Engine enqueue failed:", { diagnosticId, errorName });
    const mapped = actionableEngineError(error);
    return NextResponse.json({ ...mapped.body, diagnosticId }, { status: mapped.status });
  }
}
