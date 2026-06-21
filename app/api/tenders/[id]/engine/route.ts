import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { rateLimitPersistent, AI_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { runTenderEngine, type EngineRunOptions } from "../../../../../lib/engine/run-tender-engine";
import { assessExtractionQuality } from "../../../../../lib/extraction-quality";
import { isExtractionAcceptableForGeneration } from "../../../../../lib/engine/extraction-quality-gate";
import { actionableEngineError } from "../../../../../lib/engine/actionable-engine-error";
import { enqueueJob, findActiveEngineRunForTender } from "../../../../../lib/ai-jobs";
import { computeStoredMetadataPatch, listInvalidStoredFields } from "../../../../../lib/engine/sanitize-stored-metadata";
import { autoFillTenderMetadata } from "../../../../../lib/engine/auto-fill-tender-metadata";
import { checkEnginePostconditions } from "../../../../../lib/engine/engine-postconditions";
import { sanitizeError } from "../../../../../lib/sanitize-error";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function requestDiagnosticId() {
  return `eng_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const diagnosticId = requestDiagnosticId();
  // SEC-005 FIX: require ADMIN or PROPOSAL_MANAGER role — any authenticated
  // user (including VIEWER) was previously able to trigger the full engine.
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }
  const userId = actor.id;

  const rl = await rateLimitPersistent(`engine:${userId}`, AI_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json({ error: "Too many engine runs. Please wait before retrying.", code: "RATE_LIMITED", resetAt: rl.resetAt, retryAfter, diagnosticId }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }

  try {
    await prismaReady;
    const { id } = await params;
    const url = new URL(req.url);
    const isAsync = url.searchParams.get("async") === "true";
    const isSafe = url.searchParams.get("safe") === "true";
    const skipAiRematch = url.searchParams.get("skipAiRematch") === "true";
    const maxCharsRaw = Number(url.searchParams.get("maxChars"));
    const maxChars = Number.isFinite(maxCharsRaw) && maxCharsRaw >= 1000 ? maxCharsRaw : undefined;
    const tender = await prisma.tender.findFirst({
      where: { id, userId },
      select: {
        id: true, title: true, analysisExtractionStatus: true,
        clientName: true, country: true, reference: true, currency: true, deadline: true,
        submissionMethod: true, submissionAddress: true, submissionEmails: true,
        analysisSummary: true, evaluationMethodology: true, exactFileNaming: true,
        exactFileOrder: true, notes: true, intakeSummary: true, clientContactName: true,
        procuringEntityName: true, legalClientName: true, donorAgency: true, implementingAgency: true,
        files: {
          select: {
            id: true, originalFileName: true, fileName: true, extractedText: true,
            extractionScore: true, totalPages: true, extractedPages: true, ocrPages: true, failedPages: true,
          },
        },
      },
    });
    if (!tender) return NextResponse.json({ error: "Tender not found", code: "TENDER_NOT_FOUND", diagnosticId }, { status: 404 });

    const totalChars = tender.files.reduce((s, f) => s + (f.extractedText?.length ?? 0), 0);
    const inputStats = { fileCount: tender.files.length, totalChars, safeModeAvailable: true };

    if (tender.files.length === 0) return NextResponse.json({ error: "Engine run blocked: no tender file is uploaded.", code: "NO_TENDER_FILES", nextAction: "UPLOAD_TENDER_DOCUMENT", hint: "Upload the tender/RFP document first, then run AI Analyze or Run Engine.", diagnosticId, inputStats }, { status: 422 });

    const invalidFields = listInvalidStoredFields(tender);
    if (invalidFields.length > 0) {
      const patch = computeStoredMetadataPatch(tender);
      await prisma.tender.update({ where: { id: tender.id }, data: patch });
      console.warn(`[engine] tender=${tender.id} sanitised ${invalidFields.length} invalid stored field(s) before run: ${invalidFields.join(", ")}`);
      for (const field of invalidFields) (tender as Record<string, unknown>)[field] = null;
    }

    const metadataAutoFill = await autoFillTenderMetadata(tender, prisma);
    if (metadataAutoFill.filled.length > 0) console.info(`[engine] tender=${tender.id} auto-filled ${metadataAutoFill.filled.length} metadata field(s): ${metadataAutoFill.filled.join(", ")}`);

    const effectiveExtractionFiles = tender.files.map((file) => {
      const quality = assessExtractionQuality(file.extractedText, file.originalFileName || file.fileName);
      return { ...file, extractionScore: Math.min(file.extractionScore ?? quality.score, quality.score), quality };
    });
    const extractionReports = effectiveExtractionFiles.map((file) => ({ fileName: file.originalFileName || file.fileName, quality: file.quality, totalPages: file.totalPages, extractedPages: file.extractedPages, failedPages: file.failedPages }));
    const blockers = extractionReports.filter((item) => item.quality.severity === "FAILED" || item.quality.severity === "POOR");
    if (!isExtractionAcceptableForGeneration(effectiveExtractionFiles)) {
      const corruptedFiles = effectiveExtractionFiles.filter((file) => file.quality.corrupted).map((file) => file.originalFileName || file.fileName || file.id);
      return NextResponse.json({
        error: "Engine run blocked: tender extraction is not reliable enough for matching or AI work.",
        code: corruptedFiles.length > 0 ? "EXTRACTION_CORRUPTED_ENGINE_SKIPPED" : "EXTRACTION_QUALITY_ENGINE_BLOCKED",
        nextAction: corruptedFiles.length > 0 ? "RUN_OCR_OR_UPLOAD_CLEARER_SCAN" : "OPEN_EXTRACTION_QUALITY",
        blockers,
        corruptedFiles,
        hint: "Run OCR/re-extract the tender first. Run Engine cannot be forced through corrupted, unknown-page, or incomplete extraction.",
        diagnosticId,
        inputStats,
      }, { status: 422 });
    }

    const engineAnalysisStatus = tender.analysisExtractionStatus;
    if (engineAnalysisStatus === "OCR_REQUIRED") return NextResponse.json({ error: "Engine run blocked: AI Analyze was skipped due to corrupted extraction. Re-upload or run OCR before running the engine.", code: "ANALYSIS_FROM_CORRUPTED_EXTRACTION", nextAction: "RUN_OCR_OR_UPLOAD_CLEARER_SCAN", hint: "The tender's AI analysis was not completed due to corrupted extraction. Re-extract or run OCR, then re-run AI Analyze before running the engine.", diagnosticId, inputStats }, { status: 422 });
    if (engineAnalysisStatus === "EXTRACTION_WEAK_REVIEW_REQUIRED") return NextResponse.json({ error: "Engine run blocked: AI Analyze ran on a weak extraction. Re-extract and re-run AI Analyze before running the engine.", code: "ANALYSIS_FROM_WEAK_EXTRACTION", nextAction: "RERUN_AI_ANALYZE", hint: "AI Analyze ran on weak extraction — requirements and metadata may be incomplete. Fix extraction quality and re-run AI Analyze before running the engine.", diagnosticId, inputStats }, { status: 422 });
    if (engineAnalysisStatus === "REGEX_FALLBACK_FROM_WEAK_EXTRACTION") return NextResponse.json({ error: "Engine run blocked: tender analysis used regex fallback on weak extraction — re-extract and re-run AI Analyze before running the engine.", code: "ANALYSIS_FROM_WEAK_EXTRACTION", nextAction: "RERUN_AI_ANALYZE", hint: "AI Analyze fell back to regex because extraction was too weak. Fix extraction quality and re-run AI Analyze before running the engine.", diagnosticId, inputStats }, { status: 422 });

    const LARGE_VAULT_SYNC_THRESHOLD = 30;
    let effectiveSkipAiRematch = skipAiRematch;
    if (!isAsync && !skipAiRematch) {
      const [reviewedExpertsCount, reviewedProjectsCount] = await Promise.all([
        prisma.expert.count({ where: { company: { userId }, trustLevel: "REVIEWED" } }),
        prisma.project.count({ where: { company: { userId }, trustLevel: "REVIEWED" } }),
      ]);
      if (reviewedExpertsCount + reviewedProjectsCount > LARGE_VAULT_SYNC_THRESHOLD) {
        effectiveSkipAiRematch = true;
        console.info(`[engine] tender=${id} large vault (${reviewedExpertsCount} experts + ${reviewedProjectsCount} projects) — auto-applying skipAiRematch to prevent 60s timeout`);
      }
    }

    if (isAsync) {
      const activeJob = await prisma.aiJob.findFirst({ where: { userId, tenderId: id, jobType: "ENGINE_RUN", status: { in: ["QUEUED", "RUNNING"] } }, orderBy: { createdAt: "desc" }, select: { id: true, status: true } });
      if (activeJob) return NextResponse.json({ success: true, async: true, reusedExistingJob: true, jobId: activeJob.id, jobStatus: activeJob.status, diagnosticId, message: "An engine run is already queued or running for this tender. Reusing the existing job." }, { status: 202 });
      const { id: jobId } = await enqueueJob({ userId, tenderId: id, jobType: "ENGINE_RUN", input: { safe: isSafe, skipAiRematch: effectiveSkipAiRematch, ...(maxChars ? { maxChars } : {}) } });
      return NextResponse.json({ success: true, async: true, jobId, diagnosticId, inputStats, metadataAutoFill, extractionWarnings: extractionReports.filter((item) => item.quality.severity === "WARNING"), message: "Engine run queued. Next step: POST /api/ai-jobs/run-next to start the worker, then poll GET /api/ai-jobs/[jobId] for status." }, { status: 202 });
    }

    const activeSyncJob = await findActiveEngineRunForTender(id, userId);
    if (activeSyncJob) return NextResponse.json({ success: true, async: false, reusedExistingJob: true, jobId: activeSyncJob.id, diagnosticId, message: "An engine run is already queued or running for this tender." }, { status: 202 });

    const engineOptions: EngineRunOptions = { safe: isSafe, skipAiRematch: effectiveSkipAiRematch, maxChars };
    const result = await runTenderEngine(id, userId, undefined, engineOptions);
    const postconditions = await checkEnginePostconditions(id);
    if (postconditions.blockers.length > 0) {
      return NextResponse.json({
        success: false,
        async: false,
        tender: result,
        code: "ENGINE_COMPLETED_WITH_BLOCKERS",
        failedStage: "POSTCONDITION_VALIDATION",
        nextAction: "REVIEW_MATCHING_INPUTS",
        blockers: postconditions.blockers,
        counts: postconditions.counts,
        metadataAutoFill,
        extractionWarnings: extractionReports.filter((item) => item.quality.severity === "WARNING"),
        diagnosticId,
      }, { status: 422 });
    }
    return NextResponse.json({ success: true, async: false, tender: result, extractionWarnings: extractionReports.filter((item) => item.quality.severity === "WARNING"), inputStats, metadataAutoFill, diagnosticId });
  } catch (error) {
    console.error("Engine run failed:", { diagnosticId, error: sanitizeError(error) });
    const mapped = actionableEngineError(error);
    return NextResponse.json({ ...mapped.body, diagnosticId }, { status: mapped.status });
  }
}
