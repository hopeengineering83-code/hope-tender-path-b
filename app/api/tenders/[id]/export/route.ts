import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { validateTender } from "../../../../../lib/engine/validate";
import { checkFullExportReadiness, exportReadinessError } from "../../../../../lib/engine/export-readiness";
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

/**
 * Preflight only. The one canonical Final ZIP owner is
 * GET /api/tenders/:id/download?type=zip, which assembles and verifies the
 * actual bytes before persisting the package snapshot and EXPORTED lifecycle
 * transition. This route may verify readiness but must never create a READY
 * package or mark a tender EXPORTED without real archive bytes.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (error) {
    return error instanceof Error && error.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  const rl = rateLimit(`export:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.ceil((rl.resetAt - Date.now()) / 1000);
    return NextResponse.json({ error: "Too many requests", retryAfter }, {
      status: 429,
      headers: { "Retry-After": String(retryAfter) },
    });
  }

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
    if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

    const company = await prisma.company.findUnique({ where: { userId }, select: { id: true } });
    if (!company) return NextResponse.json({ error: "Company profile required before export." }, { status: 422 });

    const looksLikeExpertOrProject = (requirement: {
      requirementType: string | null;
      title: string | null;
      description: string | null;
    }) => {
      const inferred = inferRequirementType(`${requirement.title ?? ""} ${requirement.description ?? ""}`);
      return requirement.requirementType === "EXPERT" || requirement.requirementType === "PROJECT_EXPERIENCE"
        ? requirement.requirementType
        : inferred === "EXPERT" || inferred === "PROJECT_EXPERIENCE"
          ? inferred
          : null;
    };
    const ingestion = await getCompanyIngestionReadiness(company.id, {
      requireDocuments: true,
      requireReviewedExperts: tender.requirements.some((requirement) => looksLikeExpertOrProject(requirement) === "EXPERT"),
      requireReviewedProjects: tender.requirements.some((requirement) => looksLikeExpertOrProject(requirement) === "PROJECT_EXPERIENCE"),
    });
    if (!ingestion.ingestionReady) {
      return NextResponse.json({
        error: "Export blocked: company knowledge ingestion is not ready.",
        code: "INGESTION_NOT_READY",
        blockers: ingestion.blockers,
        totals: ingestion.totals,
      }, { status: 422 });
    }

    const effectiveExtractionFiles = tender.files.map((file) => {
      const quality = assessExtractionQuality(file.extractedText, file.originalFileName);
      return { ...file, extractionScore: Math.min(file.extractionScore ?? quality.score, quality.score), quality };
    });
    if (!isExtractionAcceptableForExport(effectiveExtractionFiles)) {
      return NextResponse.json({
        error: "Export blocked: tender document extraction quality is insufficient. Re-upload a clearer document or run OCR before exporting.",
        code: "EXTRACTION_QUALITY_INSUFFICIENT",
      }, { status: 422 });
    }

    const analysisExtractionStatus = (tender as { analysisExtractionStatus?: string | null }).analysisExtractionStatus;
    const weakAnalysisStatuses = [
      "REGEX_FALLBACK_FROM_WEAK_EXTRACTION",
      "OCR_REQUIRED",
      "EXTRACTION_WEAK_REVIEW_REQUIRED",
      "PARTIAL_EXTRACTION_AI_ANALYZED",
    ] as const;
    if (weakAnalysisStatuses.some((status) => status === analysisExtractionStatus)) {
      const detail = analysisExtractionStatus === "OCR_REQUIRED"
        ? "AI Analyze was skipped because the extracted text is corrupted"
        : analysisExtractionStatus === "REGEX_FALLBACK_FROM_WEAK_EXTRACTION"
          ? "tender analysis used regex/deterministic fallback"
          : analysisExtractionStatus === "EXTRACTION_WEAK_REVIEW_REQUIRED"
            ? "AI Analyze ran on weak extraction"
            : "AI Analyze ran on a partially-extracted tender";
      return NextResponse.json({
        error: `Export blocked: ${detail}. Re-run AI Analyze after OCR extraction before exporting.`,
        code: "ANALYSIS_FROM_WEAK_EXTRACTION",
        analysisExtractionStatus,
      }, { status: 422 });
    }

    const blockingGaps = tender.complianceGaps.filter(
      (gap) => !gap.isResolved && gap.severity === "CRITICAL",
    );
    if (blockingGaps.length > 0) {
      return NextResponse.json({
        error: `Resolve ${blockingGaps.length} CRITICAL compliance gap(s) before export.`,
      }, { status: 400 });
    }

    const untracedMandatoryRequirements = tender.requirements.filter(
      (requirement) => requirement.priority === "MANDATORY" && ((requirement.sourceConfidence ?? 0) <= 0),
    );
    if (untracedMandatoryRequirements.length > 0) {
      return NextResponse.json({
        error: `Export blocked: ${untracedMandatoryRequirements.length} mandatory requirement(s) are not source-grounded yet.`,
        code: "UNTRACED_MANDATORY_REQUIREMENTS",
        requirements: untracedMandatoryRequirements.slice(0, 20).map((requirement) => ({
          id: requirement.id,
          title: requirement.title,
        })),
      }, { status: 422 });
    }

    if (tender.generatedDocuments.length === 0) {
      return NextResponse.json({ error: "Run the tender engine before export preparation." }, { status: 400 });
    }

    const validation = await validateTender(id);
    const blockingIssues = validation.issues.filter((issue) => issue.severity === "BLOCK");
    if (blockingIssues.length > 0) {
      return NextResponse.json({
        error: `Validation failed — resolve ${blockingIssues.length} blocking issue(s) before export.`,
        issues: blockingIssues,
      }, { status: 400 });
    }

    const generatedDocuments = filterFinalExportCandidateDocuments(
      tender.generatedDocuments.filter((document) => document.generationStatus === "GENERATED"),
    );
    if (generatedDocuments.length === 0) {
      return NextResponse.json({ error: "No generated documents are available for export." }, { status: 400 });
    }

    const readiness = await checkFullExportReadiness({ tenderId: tender.id, docs: generatedDocuments });
    if (!readiness.ok) {
      return NextResponse.json({
        error: exportReadinessError(readiness.failures, readiness.tenderLevelBlockers),
        failures: readiness.failures,
        tenderLevelBlockers: readiness.tenderLevelBlockers ?? [],
      }, { status: 409 });
    }

    const tenderState = tender as Record<string, unknown>;
    const manifestEntries: ManifestEntry[] = [];
    for (const requirement of tender.requirements) {
      const exactFileName = (requirement as Record<string, unknown>).exactFileName;
      if (typeof exactFileName === "string" && exactFileName.trim()) {
        manifestEntries.push({ exactFileName, documentType: "TENDER_REQUIRED_FILE" });
      }
    }
    for (const raw of [tenderState.exactFileNaming, tenderState.exactFileOrder]) {
      if (typeof raw !== "string" || !raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) continue;
        for (const entry of parsed) {
          if (typeof entry === "string" && entry.trim()) {
            manifestEntries.push({ exactFileName: entry.trim(), documentType: "TENDER_REQUIRED_FILE" });
          } else if (entry && typeof entry === "object" && typeof entry.name === "string") {
            manifestEntries.push({
              exactFileName: entry.name.trim(),
              documentType: typeof entry.documentType === "string" ? entry.documentType : "TENDER_REQUIRED_FILE",
            });
          }
        }
      } catch { /* invalid legacy JSON is ignored; canonical gates remain fail-closed */ }
    }

    const authorityDocuments: DocumentInput[] = generatedDocuments.map((document) => ({
      id: document.id,
      name: document.name ?? "",
      documentType: document.documentType ?? "TENDER_REQUIRED_FILE",
      contentSummary: document.contentSummary ?? undefined,
      reviewNotes: (document as Record<string, unknown>).reviewNotes as string | undefined,
      exactFileName: document.exactFileName ?? undefined,
    }));
    // Required sections are the tender's exactly-named submission files, NOT
    // the tender title. runAuthorityReview asks whether some generated
    // document's name or documentType CONTAINS each section string, and no file
    // name contains a whole tender title ("Expression of Interest for Design
    // Review and Technical Audit of Rural Water Supply Schemes" is never a
    // substring of "01-Expression-Of-Interest"), so passing the title raised a
    // CRITICAL MISSING_REQUIRED_SECTION on every tender and made
    // AUTHORITY_REVIEW_BLOCKED an unconditional refusal of the final export.
    //
    // manifestEntries above already collects those names from the requirements
    // and from exactFileNaming/exactFileOrder. Match on the base name, because
    // generated rows are named without the extension.
    const authorityRequiredSections = Array.from(
      new Set(
        manifestEntries
          .map((entry) => entry.exactFileName.replace(/\.[a-z0-9]{2,5}$/i, "").trim())
          .filter((name) => name.length > 0),
      ),
    );
    const authorityResult = runAuthorityReview(authorityDocuments, manifestEntries, authorityRequiredSections);
    if (authorityResult.status !== "AUTHORITY_READY") {
      return NextResponse.json({
        error: `Export blocked: Authority Review status is ${authorityResult.status}. Resolve all critical blockers before export.`,
        code: "AUTHORITY_REVIEW_BLOCKED",
        authorityStatus: authorityResult.status,
        authorityScore: authorityResult.overallScore,
        blockers: authorityResult.blockers
          .filter((blocker) => blocker.severity === "CRITICAL")
          .map((blocker) => blocker.detail),
      }, { status: 422 });
    }

    const centralGate = await assertTenderReadyForGenerationAndExport({
      prisma,
      tenderId: id,
      userId,
      purpose: "export",
    });
    if (!centralGate.ok) {
      return NextResponse.json({
        error: `Export blocked: ${centralGate.blockerDetail}`,
        code: centralGate.blockerCode,
      }, { status: 409 });
    }

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
      requirements: tender.requirements.map((requirement) => ({
        priority: requirement.priority,
        sourceTenderFileId: requirement.sourceTenderFileId,
      })),
      overrides: [],
      buildPlan: { ok: reviewBuildPlan.ok, items: reviewBuildPlan.ok ? reviewBuildPlan.items : [] },
      operation: "REVIEW_EXPORT",
    });
    if (reviewOperationGate.warnings.length > 0) {
      logger.info(`[export] tender=${id} operation-gate warnings: ${reviewOperationGate.warnings.join("; ")}`);
    }
    if (reviewOperationGate.blockers.length > 0) {
      return NextResponse.json({
        error: `Export blocked by operation gate: ${reviewOperationGate.blockers.join("; ")}`,
        code: "OPERATION_GATE_BLOCKED",
        blockers: reviewOperationGate.blockers,
        warnings: reviewOperationGate.warnings,
      }, { status: 422 });
    }

    const generatedFileNames = generatedDocuments
      .sort((left, right) => (left.exactOrder ?? Number.MAX_SAFE_INTEGER) - (right.exactOrder ?? Number.MAX_SAFE_INTEGER))
      .map((document) => document.exactFileName ?? document.name);
    const downloadUrl = `/api/tenders/${id}/download?type=zip`;

    await logAction({
      userId,
      action: "EXPORT_READINESS_CHECK",
      entityType: "Tender",
      entityId: id,
      description: `Verified final-package download readiness for "${tender.title}" — ${generatedFileNames.length} file(s)`,
      metadata: {
        fileCount: generatedFileNames.length,
        validationPassed: true,
        reviewGatePassed: true,
        persistedPackageCreated: false,
      },
    });

    return NextResponse.json({
      success: true,
      readyToDownload: true,
      downloadUrl,
      fileList: generatedFileNames,
      packageName: `${tender.title} Submission Package`,
      format: "ZIP",
      message: "All preflight gates passed. Download the Final ZIP to assemble, verify and persist the exact archive bytes.",
    });
  } catch (error) {
    logger.error("Export readiness preflight failed", { detail: error });
    void reportError(error, { route: "/api/tenders/[id]/export", userId });
    return NextResponse.json({ error: "Export readiness check failed" }, { status: 500 });
  }
}
