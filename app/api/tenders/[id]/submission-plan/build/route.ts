// POST /api/tenders/[id]/submission-plan/build
//
// Builds and persists a submission plan for the given tender.
// Creates GeneratedDocument rows (status=PLANNED) for each planned file
// that does not already have a matching row. Never overwrites rows that
// have already been generated (generationStatus !== "PLANNED").
//
// Auth: ADMIN or PROPOSAL_MANAGER. User-scoped tender query.

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { buildSubmissionPlan, plannedSubmissionTargetFiles, buildDerivedDraftPlan } from "../../../../../../lib/engine/submission-plan";
import { logAction } from "../../../../../../lib/audit";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../../../lib/rate-limit";
import { sanitizeError } from "../../../../../../lib/sanitize-error";
import { isExtractionAcceptableForGeneration } from "../../../../../../lib/engine/extraction-quality-gate";
import { assessExtractionQuality } from "../../../../../../lib/extraction-quality";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
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
        exactFileNaming: true,
        exactFileOrder: true,
        pageLimit: true,
        analysisExtractionStatus: true,
        submissionMethod: true,
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
    if (!isExtractionAcceptableForGeneration(tender.files)) {
      return NextResponse.json({
        ok: false,
        error: "Submission plan cannot be trusted because required tender pages were not fully extracted. Re-extract or run OCR before building the plan.",
        code: "EXTRACTION_QUALITY_INSUFFICIENT",
      }, { status: 422 });
    }

    // Hard block: tender has files but no requirements AND extraction is weak.
    // Weak = any file score < 60 OR analysisExtractionStatus indicates corruption.
    if (tender.requirements.length === 0 && tender.files.length > 0) {
      const isWeak = tender.files.some((f) =>
        (f.extractionScore ?? 100) < 60 ||
        tender.analysisExtractionStatus === "EXTRACTION_CORRUPTED_AI_SKIPPED"
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

    const plan = buildSubmissionPlan(tender);
    let plannedFiles = plannedSubmissionTargetFiles(plan);

    // ── Derived draft fallback ────────────────────────────────────────────────
    // The primary plan produced 0 files (e.g. all requirements are non-MANDATORY
    // and no exactFileName is set). Try a heuristic derived draft from keywords.
    let isDerivedDraft = false;

    if (plannedFiles.length === 0 && tender.requirements.length > 0) {
      const derivedEntries = buildDerivedDraftPlan({
        requirements: tender.requirements.map((r) => ({
          title: r.title,
          description: r.description,
          requirementType: r.requirementType,
          priority: r.priority,
        })),
        submissionMethod: tender.submissionMethod,
        title: tender.title,
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
        envelope: "TECHNICAL" as const,
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
    }

    // Build a set of already-existing exactFileNames (case-insensitive)
    const existingKeys = new Set(
      tender.generatedDocuments
        .map((doc) => (doc.exactFileName ?? doc.name ?? "").toLowerCase())
        .filter(Boolean),
    );

    let created = 0;
    let skipped = 0;
    const fileStatuses: { exactFileName: string; status: "created" | "skipped" }[] = [];

    for (const file of plannedFiles) {
      const key = file.exactFileName.toLowerCase();
      if (existingKeys.has(key)) {
        skipped++;
        fileStatuses.push({ exactFileName: file.exactFileName, status: "skipped" });
        continue;
      }

      await prisma.generatedDocument.create({
        data: {
          tenderId: id,
          name: file.exactFileName,
          exactFileName: file.exactFileName,
          exactOrder: file.exactOrder,
          documentType: file.documentType ?? "TECHNICAL_PROPOSAL",
          generationStatus: "PLANNED",
          // Store DERIVED_DRAFT marker in contentSummary so the UI and
          // export gate can surface a confirmation prompt.
          contentSummary: isDerivedDraft
            ? "DERIVED_DRAFT_UNCONFIRMED — requires user confirmation before export"
            : undefined,
          reviewStatus: "PENDING",
          validationStatus: "PENDING",
        },
      });
      existingKeys.add(key);
      created++;
      fileStatuses.push({ exactFileName: file.exactFileName, status: "created" });
    }

    const isWeakExtraction =
      tender.analysisExtractionStatus === "EXTRACTION_CORRUPTED_AI_SKIPPED" ||
      tender.analysisExtractionStatus === "EXTRACTION_WEAK_REVIEW_REQUIRED";

    await logAction({
      userId: actor.id,
      action: "SUBMISSION_PLAN_BUILT",
      entityType: "Tender",
      entityId: id,
      description: `Submission plan built for tender "${tender.title}" — ${created} created, ${skipped} skipped, ${plannedFiles.length} total planned files${isDerivedDraft ? " [DERIVED DRAFT]" : ""}`,
      metadata: { created, skipped, total: plannedFiles.length, isDerivedDraft },
    });

    return NextResponse.json({
      ok: true,
      created,
      skipped,
      total: plannedFiles.length,
      isDerivedDraft,
      warning: isDerivedDraft
        ? `Derived draft plan created — requires user confirmation. ${isWeakExtraction ? "Extraction quality was weak; re-run AI Analyze after OCR for a more reliable plan." : "Re-run AI Analyze or manually confirm required submission documents."}`
        : undefined,
      files: fileStatuses,
    });
  } catch (error) {
    console.error("[submission-plan/build] error:", error);
    return NextResponse.json({ ok: false, error: sanitizeError(error) }, { status: 500 });
  }
}
