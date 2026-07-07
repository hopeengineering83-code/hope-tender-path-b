import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { runTenderEngine } from "../../../../../lib/engine/run-tender-engine";
import { assessExtractionQuality } from "../../../../../lib/extraction-quality";
import { isExtractionAcceptableForGeneration } from "../../../../../lib/engine/extraction-quality-gate";
import { actionableEngineError } from "../../../../../lib/engine/actionable-engine-error";
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
    const tender = await prisma.tender.findFirst({
      where: { id, userId },
      include: { files: { select: { id: true, originalFileName: true, fileName: true, extractedText: true } } },
    });
    if (!tender) return NextResponse.json({ error: "Tender not found", code: "TENDER_NOT_FOUND", diagnosticId }, { status: 404 });

    // Select analysisExtractionStatus from DB in tender query so the engine
    // can block on corrupted/weak extraction states BEFORE running the
    // pipeline. The prior bug compared against EXTRACTION_CORRUPTED_AI_SKIPPED
    // which is never written to this field — ai-analyze writes "OCR_REQUIRED"
    // when AI was skipped due to corrupted extraction.
    const tenderWithExtractionStatus = await prisma.tender.findFirst({
      where: { id, userId },
      select: {
        id: true,
        analysisExtractionStatus: true,
      },
    });
    const analysisExtractionStatus = tenderWithExtractionStatus?.analysisExtractionStatus ?? null;

    // Load entity fields explicitly so computeStoredMetadataPatch can nullify
    // invalid stored values (TOC fragments, stop-words, non-whitelist
    // countries) BEFORE the engine pipeline reads them. Without this, garbage
    // flows into theme detection, AI prompts, and generated cover letters.
    const tenderEntityFields = await prisma.tender.findFirst({
      where: { id, userId },
      select: {
        id: true,
        title: true,
        reference: true,
        clientName: true,
        country: true,
        clientContactName: true,
        procuringEntityName: true,
        legalClientName: true,
        donorAgency: true,
        implementingAgency: true,
      },
    });
    if (tenderEntityFields) {
      // computeStoredMetadataPatch after selecting entity fields so the
      // sanitizer can nullify them. listInvalidStoredFields surfaces which
      // fields were invalid for diagnostics.
      const invalidFields = listInvalidStoredFields(tenderEntityFields);
      if (invalidFields.length > 0) {
        const patch = computeStoredMetadataPatch(tenderEntityFields);
        await prisma.tender.update({ where: { id }, data: patch });
      }
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

    const extractionReports = tender.files.map((file) => ({
      fileName: file.originalFileName || file.fileName,
      quality: assessExtractionQuality(file.extractedText, file.originalFileName || file.fileName),
    }));
    const blockers = extractionReports.filter((item) => item.quality.severity === "FAILED" || item.quality.severity === "POOR");
    if (blockers.length > 0) {
      // The extraction gate cannot be forced through corrupted, unknown-page,
      // or incomplete extraction. The prior `?force=true` bypass was removed
      // because it let users run the engine against garbage extraction,
      // producing proposals with fabricated content.
      return NextResponse.json({
        error: "Engine run blocked: one or more tender files have poor extraction quality. The extraction gate cannot be forced through corrupted, unknown-page, or incomplete extraction.",
        code: "EXTRACTION_QUALITY_ENGINE_BLOCKED",
        nextAction: "OPEN_EXTRACTION_QUALITY",
        blockers,
        hint: "Re-import/OCR/review the file. The extraction quality gate is mandatory and cannot be bypassed.",
        diagnosticId,
      }, { status: 422 });
    }

    // isExtractionAcceptableForGeneration — the shared extraction-quality
    // gate used by bid strategy + generation. Runs AFTER the file-level
    // severity check and BEFORE the analysisExtractionStatus blocks so the
    // engine pipeline never runs against unacceptable extraction.
    const extractionAcceptable = isExtractionAcceptableForGeneration(
      tender.files.map((f) => ({
        id: f.id,
        extractionScore: (assessExtractionQuality(f.extractedText, f.originalFileName || f.fileName) as any).score ?? null,
        totalPages: null,
        extractedPages: null,
        ocrPages: null,
        failedPages: null,
      })),
    );
    if (extractionAcceptable === false) {
      return NextResponse.json({
        error: "Engine run blocked: extraction quality is below the generation threshold. The extraction gate cannot be forced through corrupted, unknown-page, or incomplete extraction.",
        code: "EXTRACTION_QUALITY_ENGINE_BLOCKED",
        nextAction: "OPEN_EXTRACTION_QUALITY",
        diagnosticId,
      }, { status: 422 });
    }

    // ── Analysis-extraction-status blocking checks ──────────────────
    // Placed AFTER the extraction-quality gate so the file-level quality
    // check runs first; these status-level checks catch the case where
    // extraction quality is acceptable but AI Analyze was skipped or fell
    // back to regex. Both states produce audit-only analysis that MUST NOT
    // authorize the engine pipeline.
    if (analysisExtractionStatus === "OCR_REQUIRED") {
      // EXTRACTION_CORRUPTED_ENGINE_SKIPPED — the engine cannot run when
      // AI Analyze was skipped due to corrupted extraction. The code is
      // ANALYSIS_FROM_CORRUPTED_EXTRACTION (same as the generate route).
      return NextResponse.json({
        error: "Engine run blocked: extraction was corrupted and AI Analyze was skipped.",
        code: "ANALYSIS_FROM_CORRUPTED_EXTRACTION",
        nextAction: "RUN_OCR_OR_UPLOAD_CLEARER_SCAN",
        hint: "Re-upload a clearer scan or run OCR on the tender file, then re-run AI Analyze before running the engine.",
        diagnosticId,
      }, { status: 422 });
    }
    if (analysisExtractionStatus === "REGEX_FALLBACK_FROM_WEAK_EXTRACTION") {
      return NextResponse.json({
        error: "Engine run blocked: analysis fell back to regex from weak extraction.",
        code: "ANALYSIS_FROM_WEAK_EXTRACTION",
        nextAction: "RERUN_AI_ANALYZE",
        hint: "Re-run AI Analyze after improving extraction quality. Regex fallback is audit-only and cannot authorize the engine pipeline.",
        diagnosticId,
      }, { status: 422 });
    }

    const result = await runTenderEngine(id, userId);
    return NextResponse.json({
      success: true,
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
