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
import { selectCanonicalTenderFiles } from "../../../../../lib/tender/canonical-source-files";
import { getTenderReleaseSnapshot } from "../../../../../lib/engine/tender-release-snapshot";
import { scheduleRequestScopedEngineWorkerWake } from "../../../../../lib/ai-jobs/request-scoped-engine-worker-wake";

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
  const rejectedPolicyParameters = CLIENT_POLICY_PARAMETERS.filter((parameter) => requestUrl.searchParams.has(parameter));
  if (rejectedPolicyParameters.length > 0) {
    return NextResponse.json({
      error: "Engine execution policy is controlled by the server.",
      code: "CLIENT_POLICY_OVERRIDE_REJECTED",
      rejectedParameters: rejectedPolicyParameters,
      diagnosticId,
    }, { status: 400 });
  }

  const rate = await rateLimitPersistent(`engine:${userId}`, AI_RATE_LIMIT);
  if (!rate.allowed) {
    const retryAfter = Math.ceil((rate.resetAt - Date.now()) / 1000);
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
            extractionMethod: true,
            totalPages: true,
            extractedPages: true,
            ocrPages: true,
            failedPages: true,
            deletionStatus: true,
            contentSha256: true,
            integrityStatus: true,
            createdAt: true,
          },
        },
      },
    });
    if (!tender) {
      return NextResponse.json({ error: "Tender not found", code: "TENDER_NOT_FOUND", diagnosticId }, { status: 404 });
    }

    const canonicalFiles = selectCanonicalTenderFiles(tender.files);
    if (canonicalFiles.length === 0) {
      return NextResponse.json({
        error: "Engine run blocked: no canonical tender source is available.",
        code: "NO_TENDER_FILES",
        nextAction: "UPLOAD_TENDER_DOCUMENT",
        diagnosticId,
      }, { status: 422 });
    }

    const invalidFields = listInvalidStoredFields(tender);
    if (invalidFields.length > 0) {
      await prisma.tender.update({ where: { id: tender.id }, data: computeStoredMetadataPatch(tender) });
    }

    const effectiveExtractionFiles = canonicalFiles.map((file) => {
      const quality = assessExtractionQuality(file.extractedText, file.originalFileName || file.fileName);
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
      integrityStatus: file.integrityStatus,
    }));
    const integrityBlockers = effectiveExtractionFiles.filter(
      (file) => file.integrityStatus !== "VERIFIED" || !file.contentSha256,
    );
    const blockers = extractionReports.filter(
      (item) => item.quality.severity === "FAILED" || item.quality.severity === "POOR",
    );
    if (integrityBlockers.length > 0 || !isExtractionAcceptableForGeneration(effectiveExtractionFiles)) {
      const corruptedFiles = effectiveExtractionFiles
        .filter((file) => file.quality.corrupted)
        .map((file) => file.originalFileName || file.fileName || file.id);
      return NextResponse.json({
        error: integrityBlockers.length > 0
          ? "Engine run blocked: canonical source byte integrity is not verified."
          : "Engine run blocked: canonical tender extraction is not reliable enough for matching or AI work.",
        code: integrityBlockers.length > 0
          ? "SOURCE_INTEGRITY_ENGINE_BLOCKED"
          : corruptedFiles.length > 0
            ? "EXTRACTION_CORRUPTED_ENGINE_SKIPPED"
            : "EXTRACTION_QUALITY_ENGINE_BLOCKED",
        nextAction: integrityBlockers.length > 0 ? "REUPLOAD_SOURCE" : "OPEN_EXTRACTION_QUALITY",
        blockers,
        corruptedFiles,
        duplicateSourceRepresentationsExcluded: Math.max(0, tender.files.length - canonicalFiles.length),
        diagnosticId,
      }, { status: 422 });
    }

    const releaseSnapshot = await getTenderReleaseSnapshot(prisma, id, userId);
    if (!releaseSnapshot?.analysis.eligibleForExport) {
      return NextResponse.json({
        error: "Run Engine requires a successful manual AI Analyze result for the current canonical source revision.",
        code: "CURRENT_ANALYSIS_REQUIRED",
        nextAction: "RUN_AI_ANALYZE",
        hint: releaseSnapshot?.analysis.blocker ?? "Run AI Analyze, wait for durable success, then run Engine.",
        contentHashMatch: releaseSnapshot?.analysis.contentHashMatch ?? false,
        diagnosticId,
      }, { status: 422 });
    }

    const engineAnalysisStatus = tender.analysisExtractionStatus;
    if (engineAnalysisStatus === "OCR_REQUIRED") {
      return NextResponse.json({
        error: "Engine run blocked: AI Analyze was skipped due to corrupted extraction. Re-upload or run OCR first.",
        code: "ANALYSIS_FROM_CORRUPTED_EXTRACTION",
        nextAction: "RUN_OCR_OR_UPLOAD_CLEARER_SCAN",
        diagnosticId,
      }, { status: 422 });
    }
    if (engineAnalysisStatus === "EXTRACTION_WEAK_REVIEW_REQUIRED" || engineAnalysisStatus === "REGEX_FALLBACK_FROM_WEAK_EXTRACTION") {
      return NextResponse.json({
        error: "Engine run blocked: analysis was produced from weak extraction. Re-extract and re-run AI Analyze.",
        code: "ANALYSIS_FROM_WEAK_EXTRACTION",
        nextAction: "RERUN_AI_ANALYZE",
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
      // FIX 3: This is the authenticated manual Run Engine route. Only this
      // route may set manualRequested=true. The previous code passed
      // purpose="INTERNAL_ARTIFACT_PREPARATION" which the enqueue function
      // treated as equivalent to manual authority — a bypass that has been
      // removed. Now manualRequested is a hard requirement.
      manualRequested: true,
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

    // Manual authority ends at durable enqueue. The server, not the browser,
    // immediately wakes the existing worker; atomic claim logic still owns the
    // QUEUED -> RUNNING transition. A rejected wake does not mutate the row.
    if (enqueueResult.status === "QUEUED") {
      scheduleRequestScopedEngineWorkerWake(req, id);
    }

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
      duplicateSourceRepresentationsExcluded: Math.max(0, tender.files.length - canonicalFiles.length),
      sourceInventory: {
        tenderFiles: revision.tenderFileCount,
        requirements: revision.requirementCount,
        vaultDocuments: revision.vaultDocumentCount,
        evidenceRecords: revision.evidenceRecordCount,
      },
      extractionWarnings: extractionReports.filter((item) => item.quality.severity === "WARNING"),
    }, { status: 202 });
  } catch (error) {
    const errorName = error instanceof Error ? error.constructor.name : typeof error;
    logger.error("Engine enqueue failed:", { diagnosticId, errorName });
    const mapped = actionableEngineError(error);
    return NextResponse.json({ ...mapped.body, diagnosticId }, { status: mapped.status });
  }
}
