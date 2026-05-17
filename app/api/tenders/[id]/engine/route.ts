// POST /api/tenders/[id]/engine
//
// Triggers the tender engine: analyze + extract + match + AI rematch.
//
// SYNC MODE (default) — runs the full pipeline inside the 60s Vercel
// Hobby route. Pre-flight extraction-quality blockers + structured error
// codes + diagnosticId. Works for small/medium tenders.
//
// ASYNC MODE (?async=true) — enqueues an ENGINE_RUN AiJob and returns
// { jobId } with HTTP 202. The frontend then:
//   1. POSTs /api/ai-jobs/run-next to kick off the worker (separate
//      function invocation with its own 60s budget)
//   2. Polls /api/ai-jobs/[jobId] every 3s until status = SUCCEEDED | FAILED
// This escapes the 60s Hobby cap for large tenders.

import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { runTenderEngine } from "../../../../../lib/engine/run-tender-engine";
import { assessExtractionQuality } from "../../../../../lib/extraction-quality";
import { actionableEngineError } from "../../../../../lib/engine/actionable-engine-error";
import { enqueueJob } from "../../../../../lib/ai-jobs";
import { computeStoredMetadataPatch, listInvalidStoredFields } from "../../../../../lib/engine/sanitize-stored-metadata";

// Vercel route timeout — engine runs analyze + extract + match. Default
// 10s is too short. 60 = Hobby max; Pro uses its own plan limit.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function requestDiagnosticId() {
  return `eng_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const diagnosticId = requestDiagnosticId();
  const userId = await getSession();
  if (!userId) {
    return NextResponse.json({
      error: "Unauthorized. Sign in again before running the tender engine.",
      code: "UNAUTHORIZED",
      nextAction: "LOGIN_AGAIN",
      diagnosticId,
    }, { status: 401 });
  }

  try {
    await prismaReady;

    const { id } = await params;
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "true";
    const isAsync = url.searchParams.get("async") === "true";
    const tender = await prisma.tender.findFirst({
      where: { id, userId },
      include: { files: { select: { id: true, originalFileName: true, fileName: true, extractedText: true } } },
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

    // ─── Defensive metadata sanitisation ──────────────────────────────
    // NULL any stored values that fail the canonical validators BEFORE
    // the engine pipeline reads them. This prevents corrupted strings
    // (TOC fragments, stop-word references, non-whitelist countries,
    // contact fragments) from flowing into AI prompts, theme detection,
    // and generated cover letters. The re-extract route can later
    // recover real values from the stored PDF text; this layer just
    // makes sure the engine never operates on garbage.
    //
    // Audit logs the nullified fields so we can trace which tenders
    // came in with legacy corruption that never got cleaned via the
    // user-facing banner.
    const invalidFields = listInvalidStoredFields(tender);
    if (invalidFields.length > 0) {
      const patch = computeStoredMetadataPatch(tender);
      await prisma.tender.update({ where: { id: tender.id }, data: patch });
      console.warn(`[engine] tender=${tender.id} sanitised ${invalidFields.length} invalid stored field(s) before run: ${invalidFields.join(", ")}`);
      // Reload tender with the patch applied so subsequent code reads clean data.
      for (const field of invalidFields) {
        (tender as Record<string, unknown>)[field] = null;
      }
    }

    const extractionReports = tender.files.map((file) => ({
      fileName: file.originalFileName || file.fileName,
      quality: assessExtractionQuality(file.extractedText, file.originalFileName || file.fileName),
    }));
    const blockers = extractionReports.filter((item) => item.quality.severity === "FAILED" || item.quality.severity === "POOR");
    if (!force && blockers.length > 0) {
      return NextResponse.json({
        error: "Engine run blocked: one or more tender files have poor extraction quality.",
        code: "EXTRACTION_NOT_READY",
        nextAction: "OPEN_EXTRACTION_QUALITY",
        blockers,
        hint: "Re-import/OCR/review the file, or retry with ?force=true only when you intentionally accept degraded analysis quality.",
        diagnosticId,
      }, { status: 422 });
    }

    // ─── ASYNC MODE — enqueue + return jobId ──────────────────────────────
    // After all pre-flight checks pass (the queue is NOT a quality-bypass,
    // it's a 60s-cap-bypass). The frontend then POSTs /api/ai-jobs/run-next
    // to kick off the worker (separate 60s budget) and polls /api/ai-jobs/[id]
    // for status.
    if (isAsync) {
      const { id: jobId } = await enqueueJob({
        userId,
        tenderId: id,
        jobType: "ENGINE_RUN",
        input: {},
      });
      return NextResponse.json({
        success: true,
        async: true,
        jobId,
        diagnosticId,
        extractionWarnings: extractionReports.filter((item) => item.quality.severity === "WARNING"),
        message: "Engine run queued. Next step: POST /api/ai-jobs/run-next to start the worker, then poll GET /api/ai-jobs/[jobId] for status.",
      }, { status: 202 });
    }

    // ─── SYNC MODE (default) — run in-route ───────────────────────────────
    const result = await runTenderEngine(id, userId);
    return NextResponse.json({
      success: true,
      async: false,
      tender: result,
      extractionWarnings: extractionReports.filter((item) => item.quality.severity === "WARNING"),
      diagnosticId,
    });
  } catch (error) {
    console.error("Engine run failed:", { diagnosticId, error });
    const mapped = actionableEngineError(error);
    return NextResponse.json({ ...mapped.body, diagnosticId }, { status: mapped.status });
  }
}
