import { logger } from "../../../../../../lib/observability";
// POST /api/tenders/[id]/submission-plan/build
//
// Builds and persists a submission plan for the given tender.
// Creates a BuildPlan record bound to the current file state (contentHash).
// The plan becomes invalid if files are added/removed/renamed; generation requires
// a valid plan.
//
// Auth: ADMIN or PROPOSAL_MANAGER. User-scoped tender query.

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { buildSubmissionPlan, buildSubmissionPlanWithDerivedFallback, plannedSubmissionTargetFiles, buildDerivedDraftPlan } from "../../../../../../lib/engine/submission-plan";
import { logAction } from "../../../../../../lib/audit";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../../../lib/rate-limit";
import { sanitizeError } from "../../../../../../lib/sanitize-error";
import { isExtractionAcceptableForGeneration } from "../../../../../../lib/engine/extraction-quality-gate";
import { assessExtractionQuality, assessExtractionQualityPerPage } from "../../../../../../lib/extraction-quality";
import { assessTenderAnalysisQuality } from "../../../../../../lib/analysis-quality";
import { detectAnalysisSourceWithApproval } from "../../../../../../lib/engine/analysis-source";
import { computeBuildPlanContentHash } from "../../../../../../lib/engine/build-plan-hash";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  const rl = rateLimit(`submission-plan-build:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "Rate limit exceeded. Please wait and retry.", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    );
  }

  await prismaReady;
  const { id } = await params;

  try {
    const tender = await prisma.tender.findFirst({
      where: { id, userId: actor.id },
      select: {
        id: true,
        title: true,
        category: true,
        exactFileNaming: true,
        exactFileOrder: true,
        pageLimit: true,
        analysisExtractionStatus: true,
        submissionMethod: true,
        submissionAddress: true,
        submissionEmails: true,
        deadline: true,
        notes: true,
        intakeSummary: true,
        analysisSummary: true,
        evaluationMethodology: true,
        clientName: true,
        procuringEntityName: true,
        reference: true,
        country: true,
        clientContactName: true,
        files: {
          select: {
            id: true,
            extractedText: true,
            originalFileName: true,
            extractionScore: true,
            totalPages: true,
            extractedPages: true,
            ocrPages: true,
            failedPages: true,
          },
        },
        requirements: {
          select: {
            id: true,
            title: true,
            description: true,
            requirementType: true,
            priority: true,
            exactFileName: true,
            exactOrder: true,
            requiredQuantity: true,
            pageLimit: true,
            restrictions: true,
            sectionReference: true,
          },
        },
        generatedDocuments: {
          select: {
            id: true,
            exactFileName: true,
            name: true,
            generationStatus: true,
          },
        },
      },
    });

    if (!tender) {
      return NextResponse.json({ ok: false, error: "Tender not found", code: "TENDER_NOT_FOUND" }, { status: 404 });
    }

    // Block when extraction quality is too poor to trust the plan.
    // Uses the shared gate (threshold: score < 40) so Build Plan, Generate
    // Docs, and Export all apply the same quality bar.
    const effectiveExtractionFiles = tender.files.map((file) => {
      const quality = assessExtractionQuality(file.extractedText, file.originalFileName);
      return { ...file, extractionScore: Math.min(file.extractionScore ?? quality.score, quality.score) };
    });
    if (!isExtractionAcceptableForGeneration(effectiveExtractionFiles)) {
      const corruptedFiles = effectiveExtractionFiles.filter((file) => assessExtractionQuality(file.extractedText, file.originalFileName).corrupted).map((file) => file.originalFileName ?? file.id);
      return NextResponse.json({
        ok: false,
        error: "Submission plan cannot be trusted because required tender pages were not fully extracted. Re-extract or run OCR before building the plan.",
        code: corruptedFiles.length > 0 ? "EXTRACTION_CORRUPTED_BUILD_PLAN_SKIPPED" : "EXTRACTION_QUALITY_INSUFFICIENT",
        nextAction: corruptedFiles.length > 0 ? "RUN_OCR_OR_UPLOAD_CLEARER_SCAN" : "OPEN_EXTRACTION_QUALITY",
        corruptedFiles,
      }, { status: 422 });
    }

    // Hard block: tender has files but no requirements AND extraction is weak.
    // Weak = any file score < 60 OR analysisExtractionStatus indicates corruption.
    if (tender.requirements.length === 0 && tender.files.length > 0) {
      // Note: "EXTRACTION_CORRUPTED_AI_SKIPPED" is tender.status; the
      // analysisExtractionStatus field is "OCR_REQUIRED" in that case.
      const isWeak = tender.files.some((f) =>
        (f.extractionScore ?? 100) < 60 ||
        tender.analysisExtractionStatus === "OCR_REQUIRED" ||
        tender.analysisExtractionStatus === "EXTRACTION_WEAK_REVIEW_REQUIRED" ||
        tender.analysisExtractionStatus === "REGEX_FALLBACK_FROM_WEAK_EXTRACTION"
      );

      if (isWeak) {
        return NextResponse.json({
          errorCode: "BUILD_PLAN_BLOCKED_WEAK_EXTRACTION",
          message: "Cannot build submission plan: no requirements were extracted and extraction quality is weak. Run OCR or re-run AI Analyze before building the plan.",
          blockers: ["No requirements extracted", "Extraction quality is weak"],
          nextAction: "RERUN_AI_ANALYZE_AFTER_OCR",
        }, { status: 400 });
      }
    }

    // Allow building from exactFileNaming/exactFileOrder even when no
    // requirements are extracted yet, because buildSubmissionPlan calls
    // buildFilesFromExactNames() as a fallback. Only block when neither
    // requirements nor explicit file lists exist.
    const hasExplicitFiles =
      (tender.exactFileNaming ?? "").trim().length > 2 ||
      (tender.exactFileOrder ?? "").trim().length > 2;
    if (tender.requirements.length === 0 && !hasExplicitFiles) {
      return NextResponse.json({ ok: false, error: "Tender has no requirements or explicit file lists — run AI Analyze first, or manually add requirements/exact file names.", code: "NO_REQUIREMENTS" }, { status: 422 });
    }

    const approvedAnalysisSource = await detectAnalysisSourceWithApproval(prisma, id, tender).catch(() => null);
    if (tender.requirements.length > 0) {
      const analysisQuality = assessTenderAnalysisQuality({
      requirements: tender.requirements,
      analysisSummary: tender.analysisSummary,
      evaluationMethodology: tender.evaluationMethodology,
      submissionNotes: [tender.notes, tender.intakeSummary].filter(Boolean).join("\n\n"),
      exactFileNaming: tender.exactFileNaming,
      exactFileOrder: tender.exactFileOrder,
      clientName: tender.clientName || tender.procuringEntityName,
      referenceNumber: tender.reference,
      country: tender.country,
      clientContactName: tender.clientContactName,
      extractedTextLength: tender.files.reduce((sum, file) => sum + (file.extractedText?.length ?? 0), 0),
      totalPageCount: tender.files.reduce((sum, file) => sum + (file.totalPages ?? 0), 0),
      deadline: tender.deadline,
      submissionMethod: tender.submissionMethod,
      submissionAddress: tender.submissionAddress,
      submissionEmails: tender.submissionEmails,
      analysisExtractionStatus: tender.analysisExtractionStatus,
      analysisSource: approvedAnalysisSource,
    });
      if (analysisQuality.severity === "POOR" || analysisQuality.severity === "UNSAFE") {
        return NextResponse.json({
          ok: false,
          errorCode: "BUILD_PLAN_BLOCKED_UNSAFE_ANALYSIS",
          error: `Cannot build a trusted submission plan: tender analysis is ${analysisQuality.severity.toLowerCase()} (${analysisQuality.score}/100).`,
          blockers: analysisQuality.warnings.slice(0, 10),
          nextAction: "RERUN_AI_ANALYZE",
        }, { status: 422 });
      }
    }

    const plan = buildSubmissionPlanWithDerivedFallback(tender);
    let plannedFiles = plannedSubmissionTargetFiles(plan);

    // ── Derived draft fallback ────────────────────────────────────────────────
    // The primary plan produced 0 files (e.g. all requirements are non-MANDATORY
    // and no exactFileName is set). Try a heuristic derived draft from keywords.
    let isDerivedDraft = plan.warnings.some((w: string) => w.includes("derived draft"));

    // Guard: even if plan is empty and no requirements exist, ensure we never
    // return a 200 response with 0 planned files. This is a gate violation per
    // CLAUDE.md: "The app does not build an empty submission plan when requirements
    // exist." and per the Build Plan gate: "the plan may under-score sections".
    if (plannedFiles.length === 0 && !hasExplicitFiles && tender.requirements.length === 0) {
      return NextResponse.json({
        ok: false,
        errorCode: "BUILD_PLAN_EMPTY_NO_REQUIREMENTS",
        error: "Cannot build submission plan: no requirements exist and no explicit file names are set. Run AI Analyze first or manually add requirements.",
        blockers: ["No requirements extracted", "No explicit file names configured"],
        nextAction: "RERUN_AI_ANALYZE",
      }, { status: 422 });
    }

    if (plannedFiles.length === 0 && tender.requirements.length > 0) {
      // Gate: if ALL requirements are non-MANDATORY (SCORED/INFORMATIONAL) and no
      // exactFileName is set, we cannot reliably auto-build a plan — require the
      // user to manually mark at least one requirement as MANDATORY or add explicit
      // file names. This prevents a derived draft from being built on purely advisory
      // requirements, which would produce a misleading DERIVED_DRAFT_UNCONFIRMED plan.
      const hasExplicitFileNames = tender.requirements.some((r) => (r.exactFileName ?? "").trim().length > 0);
      const hasMandatory = tender.requirements.some((r) => (r.priority ?? "").toUpperCase() === "MANDATORY");
      if (!hasMandatory && !hasExplicitFileNames) {
        return NextResponse.json({
          ok: false,
          errorCode: "BUILD_PLAN_ALL_OPTIONAL_REQUIREMENTS",
          error: "Cannot auto-build submission plan: all requirements are SCORED or INFORMATIONAL (none are MANDATORY) and no explicit file names are set. Mark at least one requirement as MANDATORY or add exact file names before building the plan.",
          blockers: [
            "All requirements are non-MANDATORY — no required submission files can be derived.",
            "Set at least one requirement priority to MANDATORY, or add exactFileName values, then rebuild.",
          ],
          nextAction: "SET_MANDATORY_REQUIREMENTS_OR_ADD_FILE_NAMES",
        }, { status: 422 });
      }

      const derivedEntries = buildDerivedDraftPlan({
        requirements: tender.requirements.map((r) => ({
          title: r.title,
          description: r.description,
          requirementType: r.requirementType,
          priority: r.priority,
        })),
        submissionMethod: tender.submissionMethod,
        title: tender.title,
        tenderCategory: tender.category,
        analysisExtractionStatus: tender.analysisExtractionStatus,
      });

      if (derivedEntries.length === 0) {
        // Requirements exist but derived plan also empty — hard block.
        return NextResponse.json({
          errorCode: "BUILD_PLAN_EMPTY",
          message: "Cannot build a submission plan: no requirements could be mapped to submission documents. Re-run AI Analyze or manually add requirements.",
          blockers: ["No submission documents could be derived from the current requirements"],
          nextAction: "RERUN_AI_ANALYZE",
        }, { status: 400 });
      }

      // Use derived entries as planned files — store DERIVED_DRAFT note in contentSummary
      // since the schema generationStatus only has known values (PLANNED, GENERATED, …).
      plannedFiles = derivedEntries.map((entry, index) => ({
        canonicalId: `derived-${index + 1}`,
        exactFileName: `${entry.name}.docx`,
        documentType: entry.documentType,
        required: entry.required,
        exactOrder: index + 1,
        format: "DOCX" as const,
        envelope: (entry.documentType === "FINANCIAL" ? "FINANCIAL" : "TECHNICAL") as "TECHNICAL" | "FINANCIAL",
        sourceRequirementIds: [],
        pageLimit: null,
        templateRequired: false,
        templateSourceFileId: null,
        brandingAllowed: true,
        signatureAllowed: true,
        stampAllowed: true,
        grouping: null,
        notes: entry.derivedFrom,
      }));

      isDerivedDraft = true;
    } else if (plannedFiles.length === 0) {
      return NextResponse.json({
        ok: false,
        error: "Submission plan build produced zero required files. Review extraction/analysis output or manually confirm required submission documents before generation.",
        code: "SUBMISSION_PLAN_EMPTY_REVIEW_REQUIRED",
        nextAction: "REVIEW_REQUIREMENTS_OR_ADD_MANUAL_PLAN",
        blockers: plan.warnings.length > 0 ? plan.warnings : ["No required submission files could be derived from tender requirements or exact file naming instructions."],
      }, { status: 422 });
    }

    // Planned documents are virtual/readiness-only at this stage. Do not create
    // GeneratedDocument rows until the final generation gate has passed; otherwise
    // PLANNED database rows can be mistaken for real output or a confirmed plan.
    const existingKeys = new Set(
      tender.generatedDocuments
        .map((doc) => (doc.exactFileName ?? doc.name ?? "").toLowerCase())
        .filter(Boolean),
    );

    const created = 0;
    let skipped = 0;
    const fileStatuses: { exactFileName: string; status: "virtual" | "already_exists" }[] = [];

    for (const file of plannedFiles) {
      const key = file.exactFileName.toLowerCase();
      if (existingKeys.has(key)) {
        skipped++;
        fileStatuses.push({ exactFileName: file.exactFileName, status: "already_exists" });
        continue;
      }
      // Virtual only — no GeneratedDocument.create call
      fileStatuses.push({ exactFileName: file.exactFileName, status: "virtual" });
    }

    const isWeakExtraction =
      tender.analysisExtractionStatus === "EXTRACTION_CORRUPTED_AI_SKIPPED" ||
      tender.analysisExtractionStatus === "EXTRACTION_WEAK_REVIEW_REQUIRED";

    // Per-page content warnings: detect whether key content types were found
    // in the extracted text. If submission/eval/required-doc pages are absent,
    // the plan should warn that critical tender sections may have been missed.
    const contentPageWarnings: string[] = [];
    if (tender.files.length > 0) {
      let anySubmission = false;
      let anyEvaluation = false;
      let anyRequiredDocs = false;
      let totalDetected = 0;
      for (const file of tender.files) {
        const pp = assessExtractionQualityPerPage(file.extractedText);
        if (pp.detectionMode !== "PAGE_MARKERS") continue;
        totalDetected += pp.totalDetectedPages;
        if (pp.submissionInstructionPages.length > 0) anySubmission = true;
        if (pp.evaluationCriteriaPages.length > 0) anyEvaluation = true;
        if (pp.requiredDocumentPages.length > 0) anyRequiredDocs = true;
      }
      if (totalDetected > 0) {
        const missingSections: string[] = [];
        if (!anySubmission) missingSections.push("submission instructions");
        if (!anyEvaluation) missingSections.push("evaluation criteria");
        if (!anyRequiredDocs) missingSections.push("required documents/forms");
        if (missingSections.length > 0) {
          // CLAUDE.md mandate: Build Plan gate must show this exact message when
          // critical section pages are missing from the extracted text.
          contentPageWarnings.push(
            `Submission plan cannot be trusted because required tender pages were not fully extracted — no ${missingSections.join(" or ")} pages detected. Re-extract or run OCR, then re-run AI Analyze before finalizing the plan.`
          );
        }
      }
    }

    // Persist the BuildPlan bound to the current file state
    const contentHash = computeBuildPlanContentHash(tender.files.map((f) => ({ id: f.id, originalFileName: f.originalFileName })));
    const filesList = JSON.stringify(
      tender.files.map((f) => ({ fileId: f.id, fileName: f.originalFileName, order: 0 }))
    );
    const plannedDocumentsJson = JSON.stringify(
      plannedFiles.map((doc) => ({
        canonicalId: doc.canonicalId,
        exactFileName: doc.exactFileName,
        documentType: doc.documentType,
        required: doc.required,
      }))
    );

    await prisma.buildPlan.upsert({
      where: { tenderId: id },
      update: {
        contentHash,
        filesList,
        plannedDocuments: plannedDocumentsJson,
        planType: isDerivedDraft ? "DERIVED_DRAFT" : "DERIVED",
        updatedAt: new Date(),
      },
      create: {
        tenderId: id,
        contentHash,
        filesList,
        plannedDocuments: plannedDocumentsJson,
        planType: isDerivedDraft ? "DERIVED_DRAFT" : "DERIVED",
        createdBy: actor.id,
      },
    });

    await logAction({
      userId: actor.id,
      action: "SUBMISSION_PLAN_BUILT",
      entityType: "Tender",
      entityId: id,
      description: `Submission plan built for tender "${tender.title}" — ${plannedFiles.length} planned files, ${skipped} existing generated rows${isDerivedDraft ? " [DERIVED DRAFT]" : ""}`,
      metadata: { created, skipped, total: plannedFiles.length, isDerivedDraft, virtualOnly: true, contentHash },
    });

    const baseWarning = isDerivedDraft
      ? `Derived draft plan created — requires user confirmation. ${isWeakExtraction ? "Extraction quality was weak; re-run AI Analyze after OCR for a more reliable plan." : "Re-run AI Analyze or manually confirm required submission documents."}`
      : undefined;

    return NextResponse.json({
      ok: true,
      created,
      skipped,
      total: plannedFiles.length,
      isDerivedDraft,
      virtualOnly: true,
      warning: baseWarning,
      contentPageWarnings: contentPageWarnings.length > 0 ? contentPageWarnings : undefined,
      files: fileStatuses,
    });
  } catch (error) {
    logger.error("[submission-plan/build] error:", { detail: error });
    return NextResponse.json({ ok: false, error: sanitizeError(error) }, { status: 500 });
  }
}
