import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { validateTender } from "../../../../../lib/engine/validate";
import { checkExportReadiness, checkFullExportReadiness, exportReadinessError } from "../../../../../lib/engine/export-readiness";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { filterFinalExportCandidateDocuments } from "../../../../../lib/engine/document-output-state";
import { logAction } from "../../../../../lib/audit";
import { getCompanyIngestionReadiness } from "../../../../../lib/company-ingestion-readiness";
import { isExtractionAcceptableForExport } from "../../../../../lib/engine/extraction-quality-gate";
import { assessExtractionQuality } from "../../../../../lib/extraction-quality";
import { runAuthorityReview, type ManifestEntry, type DocumentInput } from "../../../../../lib/engine/authority-review";
import { reportError, logger } from "../../../../../lib/observability";
import { assertTenderReadyForGenerationAndExport } from "../../../../../lib/engine/generation-readiness-gate";
import { resolveTenderOperationGate } from "../../../../../lib/engine/tender-operation-gate";
import { getCurrentConfirmedBuildPlan } from "../../../../../lib/engine/build-plan";
import { inferType as inferRequirementType } from "../../../../../lib/engine/analysis";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); } catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  const rl = rateLimit(`export:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });

  const userId = actor.id;

  await prismaReady;

  try {
    const { id } = await params;
    const tender = await prisma.tender.findFirst({
      where: { id, userId },
      include: {
        complianceGaps: true,
        requirements: true,
        generatedDocuments: true,
        files: {
          select: {
            id: true,
            originalFileName: true,
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
      return NextResponse.json({ error: "Tender not found" }, { status: 404 });
    }

    const company = await prisma.company.findUnique({ where: { userId }, select: { id: true } });
    if (!company) return NextResponse.json({ error: "Company profile required before export." }, { status: 422 });
    // Safety net alongside the AI-assigned requirementType: the AI classifier
    // can plausibly miscategorize an expert-CV or project-reference requirement
    // for an unusually-phrased tender, which would silently disable the
    // reviewed-evidence gate below. inferType() is the same deterministic
    // keyword classifier already used by the regex-fallback extraction path
    // (lib/engine/analysis.ts) -- reusing it as an OR-signal never weakens
    // the gate, only strengthens it.
    const looksLikeExpertOrProject = (req: { requirementType: string | null; title: string | null; description: string | null }) => {
      const inferred = inferRequirementType(`${req.title ?? ""} ${req.description ?? ""}`);
      return req.requirementType === "EXPERT" || req.requirementType === "PROJECT_EXPERIENCE"
        ? req.requirementType
        : inferred === "EXPERT" || inferred === "PROJECT_EXPERIENCE" ? inferred : null;
    };
    const ingestion = await getCompanyIngestionReadiness(company.id, { requireDocuments: true, requireReviewedExperts: tender.requirements.some((r) => looksLikeExpertOrProject(r) === "EXPERT"), requireReviewedProjects: tender.requirements.some((r) => looksLikeExpertOrProject(r) === "PROJECT_EXPERIENCE") });
    if (!ingestion.ingestionReady) return NextResponse.json({ error: "Export blocked: company knowledge ingestion is not ready.", code: "INGESTION_NOT_READY", blockers: ingestion.blockers, totals: ingestion.totals }, { status: 422 });

    // Block export when page extraction is too poor to trust the submitted documents.
    // CLAUDE.md Export/ZIP gate: poor extraction, unknown page count, or failed pages.
    // Re-assess extraction quality from extractedText — stored extractionScore may be
    // stale if the file was re-uploaded/overwritten with garbage after the original score.
    // Mirrors the generate route's re-assessment pattern (generate/route.ts:400-404).
    const effectiveExtractionFiles = tender.files.map((file) => {
      const quality = assessExtractionQuality(file.extractedText, file.originalFileName);
      return { ...file, extractionScore: Math.min(file.extractionScore ?? quality.score, quality.score), quality };
    });
    if (!isExtractionAcceptableForExport(effectiveExtractionFiles)) {
      return NextResponse.json(
        {
          error: "Export blocked: tender document extraction quality is insufficient. Re-upload a clearer document or run OCR before exporting.",
          code: "EXTRACTION_QUALITY_INSUFFICIENT",
        },
        { status: 422 },
      );
    }

    // Block export when AI Analyze ran on weak/corrupted extraction, was skipped,
    // or used regex fallback — the generated documents may be based on incomplete
    // requirement extraction. Note: "EXTRACTION_CORRUPTED_AI_SKIPPED" is the tender
    // job status; the analysisExtractionStatus field is set to "OCR_REQUIRED" in
    // that case (see ai-analyze/route.ts).
    const analysisExtractionStatus = (tender as { analysisExtractionStatus?: string | null }).analysisExtractionStatus;
    const weakAnalysisStatuses = [
      "REGEX_FALLBACK_FROM_WEAK_EXTRACTION",
      "OCR_REQUIRED",                   // AI was skipped — no reliable analysis at all
      "EXTRACTION_WEAK_REVIEW_REQUIRED", // AI ran on weak extraction
      "PARTIAL_EXTRACTION_AI_ANALYZED",  // AI ran on incomplete pages
    ] as const;
    if (weakAnalysisStatuses.some((s) => s === analysisExtractionStatus)) {
      const detail =
        analysisExtractionStatus === "OCR_REQUIRED"
          ? "AI Analyze was skipped because the extracted text is corrupted"
          : analysisExtractionStatus === "REGEX_FALLBACK_FROM_WEAK_EXTRACTION"
          ? "tender analysis used regex/deterministic fallback"
          : analysisExtractionStatus === "EXTRACTION_WEAK_REVIEW_REQUIRED"
          ? "AI Analyze ran on weak extraction"
          : "AI Analyze ran on a partially-extracted tender";
      return NextResponse.json(
        {
          error: `Export blocked: ${detail}. Re-run AI Analyze after OCR extraction before exporting.`,
          code: "ANALYSIS_FROM_WEAK_EXTRACTION",
          analysisExtractionStatus,
        },
        { status: 422 },
      );
    }

    const blockingGaps = tender.complianceGaps.filter(
      (gap) => !gap.isResolved && gap.severity === "CRITICAL",
    );

    if (blockingGaps.length > 0) {
      return NextResponse.json(
        { error: `Resolve ${blockingGaps.length} CRITICAL compliance gap(s) before marking as exported.` },
        { status: 400 },
      );
    }

    const untracedMandatoryRequirements = tender.requirements.filter((req) => req.priority === "MANDATORY" && ((req.sourceConfidence ?? 0) <= 0));
    if (untracedMandatoryRequirements.length > 0) return NextResponse.json({ error: `Export blocked: ${untracedMandatoryRequirements.length} mandatory requirement(s) are not source-grounded yet.`, code: "UNTRACED_MANDATORY_REQUIREMENTS", requirements: untracedMandatoryRequirements.slice(0, 20).map((req) => ({ id: req.id, title: req.title })) }, { status: 422 });

    if (tender.generatedDocuments.length === 0) {
      return NextResponse.json({ error: "Run the tender engine before export preparation." }, { status: 400 });
    }

    const report = await validateTender(id);
    const blockingIssues = report.issues.filter((issue) => issue.severity === "BLOCK");
    if (blockingIssues.length > 0) {
      return NextResponse.json(
        {
          error: `Validation failed — resolve ${blockingIssues.length} blocking issue(s) before export.`,
          issues: blockingIssues,
        },
        { status: 400 },
      );
    }

    // Only count final export candidates (not internal drafts, SUPERSEDED, etc.)
    const generatedDocuments = filterFinalExportCandidateDocuments(
      tender.generatedDocuments.filter((doc) => doc.generationStatus === "GENERATED"),
    );
    if (generatedDocuments.length === 0) {
      return NextResponse.json({ error: "No generated documents are available for export." }, { status: 400 });
    }

    // PR XX-G4 — full readiness check: per-document + tender-level blockers
    // (HIGH evaluator objections, pricing workbook leakage). The export
    // gate now closes when EITHER set of blockers is non-empty.
    const readiness = await checkFullExportReadiness({ tenderId: tender.id, docs: generatedDocuments });
    if (!readiness.ok) {
      return NextResponse.json(
        {
          error: exportReadinessError(readiness.failures, readiness.tenderLevelBlockers),
          failures: readiness.failures,
          tenderLevelBlockers: readiness.tenderLevelBlockers ?? [],
        },
        { status: 409 },
      );
    }

    // Authority Review hard gate — export is blocked unless the review passes.
    const t = tender as Record<string, unknown>;
    const manifestEntries: ManifestEntry[] = [];
    for (const req of tender.requirements) {
      if ((req as Record<string, unknown>).exactFileName) {
        manifestEntries.push({ exactFileName: (req as Record<string, unknown>).exactFileName as string, documentType: "TENDER_REQUIRED_FILE" });
      }
    }
    for (const raw of [t.exactFileNaming, t.exactFileOrder]) {
      if (typeof raw !== "string" || !raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const entry of parsed) {
            if (typeof entry === "string" && entry.trim()) manifestEntries.push({ exactFileName: entry.trim(), documentType: "TENDER_REQUIRED_FILE" });
            else if (entry && typeof entry === "object" && typeof entry.name === "string") manifestEntries.push({ exactFileName: entry.name.trim(), documentType: (entry as Record<string, unknown>).documentType as string ?? "TENDER_REQUIRED_FILE" });
          }
        }
      } catch { /* ignore */ }
    }
    const authorityDocuments: DocumentInput[] = generatedDocuments.map((d) => ({
      id: d.id,
      name: d.name ?? "",
      documentType: d.documentType ?? "TENDER_REQUIRED_FILE",
      contentSummary: d.contentSummary ?? undefined,
      reviewNotes: (d as Record<string, unknown>).reviewNotes as string | undefined,
      exactFileName: d.exactFileName ?? undefined,
    }));
    // Required sections are the tender's exactly-named submission files, NOT
    // the tender title. runAuthorityReview asks whether some generated
    // document's name or documentType CONTAINS each section string; the tender
    // title ("Expression of Interest for Design Review and Technical Audit of
    // Rural Water Supply Schemes") is never a substring of a file name like
    // "01-Expression-Of-Interest", so passing the title raised a CRITICAL
    // MISSING_REQUIRED_SECTION on every tender, pushed the authority score
    // under the 85 threshold, and made AUTHORITY_REVIEW_BLOCKED an
    // unconditional refusal of the final export.
    //
    // manifestEntries above already collects those names from the requirements
    // and from exactFileNaming/exactFileOrder — the same source
    // deriveRequiredSections uses in the authority-review route, so the export
    // gate and that panel now agree. Match on the base name (extension
    // stripped) because generated documents are named without it.
    const authorityRequiredSections = Array.from(
      new Set(
        manifestEntries
          .map((entry) => entry.exactFileName.replace(/\.[a-z0-9]{2,5}$/i, "").trim())
          .filter((name) => name.length > 0),
      ),
    );
    const authorityResult = runAuthorityReview(authorityDocuments, manifestEntries, authorityRequiredSections);
    if (authorityResult.status !== "AUTHORITY_READY") {
      return NextResponse.json(
        {
          error: `Export blocked: Authority Review status is ${authorityResult.status}. Resolve all critical blockers and raise the authority score to ≥85 before export.`,
          code: "AUTHORITY_REVIEW_BLOCKED",
          authorityStatus: authorityResult.status,
          authorityScore: authorityResult.overallScore,
          blockers: authorityResult.blockers.filter((b) => b.severity === "CRITICAL").map((b) => b.detail),
        },
        { status: 422 },
      );
    }

    // Central authoritative readiness gate (condition K) — the final, fail-closed
    // check immediately before the export package is created. Enforces
    // current-content-hash match, canonical promotion, chunk integrity,
    // mandatory-requirement source grounding, and a confirmed non-empty
    // submission plan so a stale/partial/unapproved-fallback analysis can never
    // be marked EXPORTED.
    const centralGate = await assertTenderReadyForGenerationAndExport({ prisma, tenderId: id, userId, purpose: "export" });
    if (!centralGate.ok) {
      return NextResponse.json(
        { error: `Export blocked: ${centralGate.blockerDetail}`, code: centralGate.blockerCode },
        { status: 409 },
      );
    }

    // ── Operation gate (REVIEW_EXPORT) — authoritative metadata check ────
    // For REVIEW_EXPORT, metadata NEVER blocks. The gate surfaces warnings
    // for the UI and is the single authority for metadata eligibility.
    // This connects the source-driven tender model to the live export route.
    const reviewBuildPlan = await getCurrentConfirmedBuildPlan(prisma, id, userId);
    const reviewOperationGate = resolveTenderOperationGate({
      tender: {
        id: tender.id,
        title: tender.title,
        reference: tender.reference,
        clientName: tender.clientName,
        deadline: tender.deadline,
        submissionMethod: tender.submissionMethod,
        submissionEmails: tender.submissionEmails,
        submissionAddress: tender.submissionAddress,
        country: tender.country,
        metadataContaminated: tender.metadataContaminated,
        analysisExtractionStatus: tender.analysisExtractionStatus,
      },
      requirements: tender.requirements.map((r: any) => ({
        priority: r.priority,
        sourceTenderFileId: r.sourceTenderFileId,
      })),
      overrides: [],
      buildPlan: { ok: reviewBuildPlan.ok, items: reviewBuildPlan.ok ? reviewBuildPlan.items : [] },
      operation: "REVIEW_EXPORT",
    });
    if (reviewOperationGate.warnings.length > 0) {
      logger.info(`[export] tender=${id} operation-gate warnings: ${reviewOperationGate.warnings.join("; ")}`);
    }
    // Defensive: REVIEW_EXPORT should never be blocked by the operation gate.
    if (reviewOperationGate.blockers.length > 0) {
      return NextResponse.json(
        {
          error: `Export blocked by operation gate (REVIEW_EXPORT): ${reviewOperationGate.blockers.join("; ")}`,
          code: "OPERATION_GATE_BLOCKED",
          blockers: reviewOperationGate.blockers,
          warnings: reviewOperationGate.warnings,
        },
        { status: 422 },
      );
    }

    const generatedFileNames = generatedDocuments
      .sort((a, b) => (a.exactOrder ?? Number.MAX_SAFE_INTEGER) - (b.exactOrder ?? Number.MAX_SAFE_INTEGER))
      .map((doc) => doc.exactFileName ?? doc.name);

    const exportPackage = await prisma.$transaction(async (tx) => {
      await tx.exportPackage.updateMany({
        where: { tenderId: id, status: "READY" },
        data: { status: "SUPERSEDED" },
      });
      return tx.exportPackage.create({
        data: { tenderId: id, status: "READY", fileList: JSON.stringify(generatedFileNames), downloadCount: 0 },
      });
    }, { timeout: 30_000 });

    // Move the tender status update inside the same transaction to prevent
    // the export package being READY while the tender shows a stale status
    // (was outside the tx — if the tender update failed, the export package
    // was READY but the UI showed a stale status).
    await prisma.$transaction(async (tx) => {
      await tx.exportPackage.updateMany({
        where: { tenderId: id, status: "READY" },
        data: {},
      });
      await tx.tender.update({
        where: { id },
        data: { status: "EXPORTED", stage: "EXPORT" },
      });
    });

    await logAction({
      userId,
      action: "EXPORT_PACKAGE_CREATE",
      entityType: "Tender",
      entityId: id,
      description: `Prepared export package for "${tender.title}" — ${generatedFileNames.length} file(s)`,
      metadata: { exportPackageId: exportPackage.id, fileCount: generatedFileNames.length, validationPassed: true, reviewGatePassed: true },
    });

    return NextResponse.json(
      {
        success: true,
        exportPackage: {
          id: exportPackage.id,
          tenderId: tender.id,
          status: exportPackage.status,
          fileList: generatedFileNames,
          name: `${tender.title} Submission Package`,
          format: "ZIP",
        },
      },
      { status: 201 },
    );
  } catch (error) {
    logger.error("Export preparation failed:", { detail: error });
    void reportError(error, { route: "/api/tenders/[id]/export", userId });
    return NextResponse.json({ error: "Export preparation failed" }, { status: 500 });
  }
}
