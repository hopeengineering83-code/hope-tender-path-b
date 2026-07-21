import { NextResponse } from "next/server";
import { logger } from "../../../../../lib/observability";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { runTenderEngine } from "../../../../../lib/engine/run-tender-engine";
import { assessExtractionQuality } from "../../../../../lib/extraction-quality";
import { actionableEngineError } from "../../../../../lib/engine/actionable-engine-error";
import { computeStoredMetadataPatch, listInvalidStoredFields } from "../../../../../lib/engine/sanitize-stored-metadata";
import { isExtractionAcceptableForGeneration } from "../../../../../lib/engine/extraction-quality-gate";
import { rateLimitPersistent, AI_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { enqueueJob, findActiveEngineRunForTender } from "../../../../../lib/ai-jobs";
import { checkEnginePostconditions } from "../../../../../lib/engine/engine-postconditions";

// Vercel route timeout — engine runs analyze + extract + match. Default
// 10s is too short. 60 = Hobby max; Pro uses its own plan limit.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

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

  // Persistent AI throttling — prevents abuse across serverless instances.
  const rl = await rateLimitPersistent(`engine:${userId}`, AI_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json({
      error: "Rate limit exceeded — too many engine requests. Please wait before retrying.",
      code: "RATE_LIMITED",
      retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000),
      diagnosticId,
    }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
  }

  try {
    await prismaReady;

    const { id } = await params;
    const tender = await prisma.tender.findFirst({
      where: { id, userId },
      select: {
        id: true, analysisExtractionStatus: true,
        title: true, clientName: true, reference: true, country: true, clientContactName: true,
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

    if (tender.files.length === 0) {
      return NextResponse.json({
        error: "Engine run blocked: no tender file is uploaded.",
        code: "NO_TENDER_FILES",
        nextAction: "UPLOAD_TENDER_DOCUMENT",
        hint: "Upload the tender/RFP document first, then run AI Analyze or Run Engine.",
        diagnosticId,
      }, { status: 422 });
    }

    // Nullify any contaminated stored metadata before the run so the sanitizer
    // — not the engine — owns data hygiene.
    const invalidFields = listInvalidStoredFields(tender);
    if (invalidFields.length > 0) {
      const patch = computeStoredMetadataPatch(tender);
      await prisma.tender.update({ where: { id: tender.id }, data: patch });
    }

    // Shared, non-bypassable extraction gate.
    const effectiveExtractionFiles = tender.files.map((file) => {
      const quality = assessExtractionQuality(file.extractedText, file.originalFileName || file.fileName);
      return { ...file, extractionScore: Math.min(file.extractionScore ?? quality.score, quality.score), quality };
    });
    const extractionReports = effectiveExtractionFiles.map((file) => ({
      fileName: file.originalFileName || file.fileName,
      quality: file.quality,
      totalPages: file.totalPages,
      extractedPages: file.extractedPages,
      failedPages: file.failedPages,
    }));
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
      }, { status: 422 });
    }

    const engineAnalysisStatus = tender.analysisExtractionStatus;
    if (engineAnalysisStatus === "OCR_REQUIRED") {
      return NextResponse.json({ error: "Engine run blocked: AI Analyze was skipped due to corrupted extraction. Re-upload or run OCR before running the engine.", code: "ANALYSIS_FROM_CORRUPTED_EXTRACTION", nextAction: "RUN_OCR_OR_UPLOAD_CLEARER_SCAN", hint: "The tender's AI analysis was not completed due to corrupted extraction. Re-extract or run OCR, then re-run AI Analyze before running the engine.", diagnosticId }, { status: 422 });
    }
    if (engineAnalysisStatus === "EXTRACTION_WEAK_REVIEW_REQUIRED") {
      return NextResponse.json({ error: "Engine run blocked: AI Analyze ran on a weak extraction. Re-extract and re-run AI Analyze before running the engine.", code: "ANALYSIS_FROM_WEAK_EXTRACTION", nextAction: "RERUN_AI_ANALYZE", hint: "AI Analyze ran on weak extraction — requirements and metadata may be incomplete. Fix extraction quality and re-run AI Analyze before running the engine.", diagnosticId }, { status: 422 });
    }
    if (engineAnalysisStatus === "REGEX_FALLBACK_FROM_WEAK_EXTRACTION") {
      return NextResponse.json({ error: "Engine run blocked: tender analysis used regex fallback on weak extraction — re-extract and re-run AI Analyze before running the engine.", code: "ANALYSIS_FROM_WEAK_EXTRACTION", nextAction: "RERUN_AI_ANALYZE", hint: "AI Analyze fell back to regex because extraction was too weak. Fix extraction quality and re-run AI Analyze before running the engine.", diagnosticId }, { status: 422 });
    }

    // ─── Async/background mode ──────────────────────────────────────────
    // The "Run Engine (Safe Mode)" / "Run in background" buttons
    // (components/engine-action-panel.tsx executeEngineRunAsync) call this
    // same route with ?async=true expecting a 202 + jobId to poll, exactly
    // like AI Analyze's ?mode=background path. This branch was previously
    // MISSING entirely — every "background" run silently fell back to the
    // synchronous 60s-capped path below with no jobId in the response, so
    // the client's `if (!enqueueRes.ok || !enqueueData.jobId)` guard always
    // fired and passed the raw synchronous result straight to the UI. That
    // raw shape has no `error` field on a partial-success response, so the
    // panel rendered the generic "Engine failed." fallback for what was
    // often a legitimate partial success (e.g. AI rematch skipped for a
    // deadline) — and large vaults never actually escaped the 60s cap this
    // was supposed to provide.
    const reqUrl = new URL(req.url);
    if (reqUrl.searchParams.get("async") === "true") {
      const safe = reqUrl.searchParams.get("safe") === "true";
      const skipAiRematch = reqUrl.searchParams.get("skipAiRematch") === "true";
      const maxCharsParam = reqUrl.searchParams.get("maxChars");
      const maxChars = maxCharsParam ? Number(maxCharsParam) : undefined;
      const active = await findActiveEngineRunForTender(id, userId);
      const jobId = active?.id ?? (await enqueueJob({
        userId,
        tenderId: id,
        jobType: "ENGINE_RUN",
        input: {
          safe,
          skipAiRematch,
          ...(typeof maxChars === "number" && Number.isFinite(maxChars) ? { maxChars } : {}),
        },
      })).id;
      return NextResponse.json({ jobId, status: "QUEUED", diagnosticId }, { status: 202 });
    }

    const deadlineAt = Date.now() + 50_000;
    const result = await runTenderEngine(id, userId, undefined, { deadlineAt });
    const engineMeta = result as {
      partial?: boolean;
      blockers?: string[];
      nextAction?: string | null;
      analysisMethod?: string;
      evidenceMatchingBlocker?: { code: string; message: string } | null;
    };

    // ─── Postcondition validation — same check as the async ENGINE_RUN job ──
    // Previously ONLY the background job handler (lib/ai-job-handlers.ts)
    // verified real postconditions (zero requirements persisted, zero
    // evidence rows, zero expert/project matches) after the engine ran; this
    // synchronous path used a narrower success criterion (only whether the
    // AI rematch itself failed), so a sync run that produced zero usable
    // output for any other reason still reported success:true. Both paths
    // must use the same success criteria: never report success when
    // required postconditions are missing.
    const postconditions = await checkEnginePostconditions(id);
    if (!postconditions.ok) {
      logger.warn(`[engine route] Postcondition check failed after synchronous run: ${postconditions.blockers.join(", ")}`, { diagnosticId, tenderId: id });
    }
    const isPartial = (engineMeta.partial ?? false) || !postconditions.ok;
    const combinedBlockers = [...(engineMeta.blockers ?? []), ...(postconditions.ok ? [] : postconditions.blockers)];
    return NextResponse.json({
      success: !isPartial,
      ok: !isPartial,
      partial: isPartial,
      blockers: combinedBlockers,
      nextAction: engineMeta.nextAction ?? (postconditions.ok ? null : "REVIEW_MATCHING_INPUTS"),
      analysisMethod: engineMeta.analysisMethod ?? null,
      evidenceMatchingBlocker: engineMeta.evidenceMatchingBlocker ?? null,
      postconditionCounts: postconditions.ok ? undefined : postconditions.counts,
      tender: result,
      extractionWarnings: extractionReports.filter((item) => item.quality.severity === "WARNING"),
      diagnosticId,
    });
  } catch (error) {
    const errorName = error instanceof Error ? error.constructor.name : typeof error;
    logger.error("Engine run failed:", { diagnosticId, errorName });
    const mapped = actionableEngineError(error);
    return NextResponse.json({ ...mapped.body, diagnosticId }, { status: mapped.status });
  }
}
