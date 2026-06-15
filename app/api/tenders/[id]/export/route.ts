import { NextResponse } from "next/server";
import { requirePermission, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { validateTender } from "../../../../../lib/engine/validate";
import { checkExportReadiness, checkFullExportReadiness, exportReadinessError } from "../../../../../lib/engine/export-readiness";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { filterFinalExportCandidateDocuments } from "../../../../../lib/engine/document-output-state";
import { logAction } from "../../../../../lib/audit";
import { getCompanyIngestionReadiness } from "../../../../../lib/company-ingestion-readiness";
import { isExtractionAcceptableForExport } from "../../../../../lib/engine/extraction-quality-gate";
import { runAuthorityReview, type ManifestEntry, type DocumentInput } from "../../../../../lib/engine/authority-review";
import { reportError } from "../../../../../lib/observability";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requirePermission("FINAL_EXPORT"); } catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

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
    const ingestion = await getCompanyIngestionReadiness(company.id, { requireDocuments: true, requireReviewedExperts: tender.requirements.some((r) => r.requirementType === "EXPERT"), requireReviewedProjects: tender.requirements.some((r) => r.requirementType === "PROJECT_EXPERIENCE") });
    if (!ingestion.ingestionReady) return NextResponse.json({ error: "Export blocked: company knowledge ingestion is not ready.", code: "INGESTION_NOT_READY", blockers: ingestion.blockers, totals: ingestion.totals }, { status: 422 });

    // Block export when page extraction is too poor to trust the submitted documents.
    // CLAUDE.md Export/ZIP gate: poor extraction, unknown page count, or failed pages.
    if (!isExtractionAcceptableForExport(tender.files)) {
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
    const authorityRequiredSections = (typeof t.title === "string" ? [t.title] : []);
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
    });

    await prisma.tender.update({
      where: { id },
      data: { status: "EXPORTED", stage: "EXPORT" },
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
    console.error("Export preparation failed:", error);
    void reportError(error, { route: "/api/tenders/[id]/export", userId });
    return NextResponse.json({ error: "Export preparation failed" }, { status: 500 });
  }
}
