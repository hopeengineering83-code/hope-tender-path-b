import { logger } from "../../../../../lib/observability";
// Pipeline Diagnostic API — admin/proposal-manager only.
//
// Returns a single object showing the complete pipeline state for a tender:
// upload → extraction → AI Analyze → metadata → requirements → evidence →
// Build Plan → Generate Docs → validation → export readiness.
//
// Used by the NextActionPanel (server component) and the admin diagnostics
// page. Never returns raw errors or secrets.

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { assessExtractionQuality } from "../../../../../lib/extraction-quality";
import { isExtractionCorrupted } from "../../../../../lib/engine/extraction-quality-gate";
import { assessTenderMetadataCompleteness } from "../../../../../lib/engine/tender-metadata-completeness";
import { getFinalSubmissionReadiness } from "../../../../../lib/engine/final-submission-readiness";
import { getCurrentConfirmedBuildPlan } from "../../../../../lib/engine/build-plan";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); } catch (e) {
    return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  try {

  const { id } = await params;
  await prismaReady;

  const tender = await prisma.tender.findFirst({
    where: { id, userId: actor.id },
    select: {
      id: true,
      title: true,
      status: true,
      stage: true,
      analysisSummary: true,
      analysisExtractionStatus: true,
      metadataContaminated: true,
      clientName: true,
      procuringEntityName: true,
      submissionMethod: true,
      deadline: true,
      // client fields for metadata completeness
      country: true,
      clientContactName: true,
      clientContactEmail: true,
      submissionAddress: true,
      submissionEmails: true,
      currency: true,
      metadataOverrides: {
        select: { field: true, fieldState: true, overrideValue: true },
      },
      files: {
        select: {
          id: true,
          originalFileName: true,
          fileName: true,
          mimeType: true,
          extractedText: true,
          totalPages: true,
          extractedPages: true,
          ocrPages: true,
          failedPages: true,
          extractionScore: true,
          extractionMethod: true,
        },
      },
      requirements: {
        select: {
          id: true,
          title: true,
          priority: true,
          sourceConfidence: true,
          sourcePageNumber: true,
          sourceExactQuote: true,
          sourceTenderFileId: true,
        },
      },
      generatedDocuments: {
        where: { generationStatus: { not: "SUPERSEDED" } },
        select: {
          id: true,
          name: true,
          exactFileName: true,
          documentType: true,
          generationStatus: true,
          validationStatus: true,
          reviewStatus: true,
        },
      },
      complianceGaps: {
        where: { isResolved: false },
        select: { id: true, severity: true },
      },
    },
  });

  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  // ── Step 1: File upload ───────────────────────────────────────────────────
  const hasFiles = tender.files.length > 0;

  // ── Step 2: Extraction quality ────────────────────────────────────────────
  const fileQuality = tender.files.map((f) => {
    const quality = assessExtractionQuality(f.extractedText, f.originalFileName || f.fileName);
    const corrupted = f.extractedText ? isExtractionCorrupted(f.extractedText) : false;
    return {
      id: f.id,
      name: f.originalFileName || f.fileName,
      mimeType: f.mimeType,
      totalPages: f.totalPages,
      extractedPages: f.extractedPages,
      ocrPages: f.ocrPages,
      failedPages: f.failedPages,
      extractionScore: Math.min(f.extractionScore ?? quality.score, quality.score),
      severity: quality.severity,
      corrupted,
    };
  });
  const anyCorrupted = fileQuality.some((f) => f.corrupted);
  const anyFailed = fileQuality.some((f) => f.severity === "FAILED");
  const avgExtractionScore = fileQuality.length > 0
    ? Math.round(fileQuality.reduce((s, f) => s + f.extractionScore, 0) / fileQuality.length)
    : 0;
  const extractionOk = hasFiles && !anyCorrupted && !anyFailed && avgExtractionScore >= 45;

  // ── Step 3: AI Analyze ────────────────────────────────────────────────────
  const analysisStatus = tender.analysisExtractionStatus;
  const aiAnalyzed = Boolean(tender.analysisSummary);
  const aiAnalyzeOk = aiAnalyzed && analysisStatus !== "EXTRACTION_CORRUPTED_AI_SKIPPED";

  // ── Step 4: Metadata completeness ─────────────────────────────────────────
  const metadataReport = assessTenderMetadataCompleteness({
    clientName: (tender.clientName || (tender as Record<string, unknown>).procuringEntityName as string | null | undefined) ?? null,
    country: tender.country ?? null,
    clientContactName: tender.clientContactName ?? null,
    clientContactEmail: tender.clientContactEmail ?? null,
    submissionAddress: tender.submissionAddress ?? null,
    submissionEmails: tender.submissionEmails ?? null,
    submissionMethod: tender.submissionMethod ?? null,
    deadline: tender.deadline ?? null,
    currency: tender.currency ?? null,
    hasSubmissionRules: Boolean(tender.submissionMethod || tender.submissionEmails || tender.submissionAddress),
    requirementCount: tender.requirements.length,
  }, tender.metadataOverrides);
  const metadataOk = metadataReport.missingCritical.length === 0 &&
    metadataReport.placeholderCount === 0 &&
    !tender.metadataContaminated;

  // ── Step 5: Source-traced requirements ────────────────────────────────────
  const mandatoryReqs = tender.requirements.filter((r) => r.priority === "MANDATORY");
  const tracedReqs = mandatoryReqs.filter(
    (r) => (r.sourceConfidence ?? 0) > 0 || r.sourcePageNumber != null || (r.sourceExactQuote ?? "").trim().length > 0,
  );
  const requirementsOk = tender.requirements.length > 0 &&
    (mandatoryReqs.length === 0 || tracedReqs.length > 0);
  const traceabilityRatio = mandatoryReqs.length > 0
    ? Math.round((tracedReqs.length / mandatoryReqs.length) * 100)
    : 100;

  // ── Step 6: Build Plan ────────────────────────────────────────────────────
  const currentBuildPlan = await getCurrentConfirmedBuildPlan(prisma, id, actor.id);
  const hasPlan = currentBuildPlan.ok;
  const planFileCount = currentBuildPlan.ok ? currentBuildPlan.items.length : 0;
  const buildPlanBlocker = currentBuildPlan.ok ? null : currentBuildPlan.blocker;

  // ── Step 7: Generated documents ───────────────────────────────────────────
  const activeDocs = tender.generatedDocuments;
  const generatedCount = activeDocs.filter((d) => d.generationStatus === "GENERATED").length;
  const hasGeneratedDocs = generatedCount > 0;

  // ── Step 8: Validation ────────────────────────────────────────────────────
  const validationPassed = activeDocs
    .filter((d) => d.generationStatus === "GENERATED")
    .every((d) => d.validationStatus === "PASSED" || d.validationStatus === "VALIDATED");

  // ── Step 9: Export readiness ──────────────────────────────────────────────
  // Use getFinalSubmissionReadiness without loading fileContent (read-only diagnostic)
  const canonical = await getFinalSubmissionReadiness(prisma, {
    tenderId: id,
    userId: actor.id,
    requireFileContent: false,
  }).catch(() => null);

  const exportReady = canonical?.ok ?? false;
  const criticalGaps = tender.complianceGaps.filter((g) => g.severity === "CRITICAL");

  // ── Next Required Action ──────────────────────────────────────────────────
  type WorkflowStep =
    | "UPLOAD_TENDER"
    | "FIX_EXTRACTION"
    | "RUN_AI_ANALYZE"
    | "CONFIRM_METADATA"
    | "GROUND_REQUIREMENTS"
    | "BUILD_PLAN"
    | "CONFIRM_EVIDENCE"
    | "GENERATE_DOCUMENTS"
    | "VALIDATE_DOCUMENTS"
    | "REVIEW_MANIFEST"
    | "EXPORT_ZIP"
    | "COMPLETE";

  function deriveNextAction(): { step: WorkflowStep; label: string; reason: string; blockers: string[] } {
    if (!hasFiles) return { step: "UPLOAD_TENDER", label: "Upload tender document", reason: "No tender file uploaded yet.", blockers: ["No files"] };
    if (!extractionOk) {
      const reasons: string[] = [];
      if (anyCorrupted) reasons.push("Extracted text is corrupted — OCR required");
      if (anyFailed) reasons.push("One or more pages failed extraction");
      if (avgExtractionScore < 45) reasons.push(`Average extraction score ${avgExtractionScore}/100 is below minimum`);
      return { step: "FIX_EXTRACTION", label: "Fix extraction or re-upload", reason: "Tender file extraction quality is too poor for AI Analyze.", blockers: reasons };
    }
    if (!aiAnalyzeOk) {
      const blockers: string[] = [];
      if (!aiAnalyzed) blockers.push("AI Analyze has not been run yet");
      if (analysisStatus === "EXTRACTION_CORRUPTED_AI_SKIPPED") blockers.push("AI Analyze was skipped due to corrupted extraction");
      return { step: "RUN_AI_ANALYZE", label: "Run AI Analyze", reason: "Tender has not been analyzed by AI yet.", blockers };
    }
    if (!metadataOk) {
      // Metadata is NOT a hard blocker for draft work — warnings only.
      const blockers: string[] = [];
      metadataReport.missingCritical.forEach((f) => blockers.push(`Missing (optional): ${f.field}`));
      if (tender!.metadataContaminated) blockers.push("Client name is contaminated (optional — omitted from draft)");
      if (metadataReport.placeholderCount > 0) blockers.push(`${metadataReport.placeholderCount} placeholder(s) in metadata (optional — omitted from draft)`);
      return { step: "CONFIRM_METADATA", label: "Confirm tender metadata (optional)", reason: "Tender details incomplete — optional information was omitted from draft output.", blockers };
    }
    if (!requirementsOk) {
      const blockers: string[] = tender!.requirements.length === 0
        ? ["No requirements extracted — re-run AI Analyze"]
        : [`${mandatoryReqs.length - tracedReqs.length} mandatory requirements lack source traceability`];
      return { step: "GROUND_REQUIREMENTS", label: "Ground requirements from source", reason: "Requirements must be verified from the active source. Re-run AI Analyze; if they remain unprovable, upload a better source or make a genuine source correction. Confirmation cannot promote unsupported provenance.", blockers };
    }
    if (!hasPlan) return {
      step: "BUILD_PLAN",
      label: "Open exceptional Build Plan recovery",
      reason: "No current source-verified Build Plan authorizes generation. Run Engine creates and verifies it automatically.",
      blockers: [buildPlanBlocker ?? "Build Plan is not confirmed"],
    };
    if (!hasGeneratedDocs) return { step: "GENERATE_DOCUMENTS", label: "Generate proposal documents", reason: "No documents have been generated yet.", blockers: [] };
    if (!validationPassed) return { step: "VALIDATE_DOCUMENTS", label: "Validate and review generated documents", reason: "One or more documents have not passed validation.", blockers: ["Documents need review before export"] };
    if (criticalGaps.length > 0) return { step: "VALIDATE_DOCUMENTS", label: "Resolve critical compliance gaps", reason: `${criticalGaps.length} unresolved critical compliance gap(s).`, blockers: criticalGaps.map((g) => `Critical gap: ${g.id}`) };
    if (!exportReady) {
      const blockers = [
        ...(canonical?.tenderLevelBlockers.map((b) => b.title) ?? []),
        ...(canonical?.documentBlockers.flatMap((b) => b.reasons) ?? []),
      ].slice(0, 5);
      return { step: "REVIEW_MANIFEST", label: "Review final package manifest", reason: "Export readiness gate is not satisfied.", blockers };
    }
    if (tender!.status !== "EXPORTED") return { step: "EXPORT_ZIP", label: "Export final ZIP package", reason: "All gates passed — ready to export.", blockers: [] };
    return { step: "COMPLETE", label: "Submission package complete", reason: "Tender has been exported.", blockers: [] };
  }

  const nextAction = deriveNextAction();

  return NextResponse.json({
    tenderId: id,
    tenderTitle: tender.title,
    tenderStatus: tender.status,
    tenderStage: tender.stage,
    pipeline: {
      upload: { ok: hasFiles, fileCount: tender.files.length, files: fileQuality.map((f) => ({ name: f.name, mimeType: f.mimeType, severity: f.severity, score: f.extractionScore, corrupted: f.corrupted, totalPages: f.totalPages, extractedPages: f.extractedPages, ocrPages: f.ocrPages, failedPages: f.failedPages })) },
      extraction: { ok: extractionOk, avgScore: avgExtractionScore, anyCorrupted, anyFailed, status: analysisStatus ?? "NOT_RUN" },
      aiAnalyze: { ok: aiAnalyzeOk, analyzed: aiAnalyzed, extractionStatus: analysisStatus ?? "NOT_RUN" },
      metadata: { ok: metadataOk, missingCritical: metadataReport.missingCritical.map((f) => f.field), notApplicable: metadataReport.notApplicableFields.map((f) => f.field), placeholders: metadataReport.placeholderCount, contaminated: tender.metadataContaminated },
      requirements: { ok: requirementsOk, total: tender.requirements.length, mandatory: mandatoryReqs.length, traced: tracedReqs.length, traceabilityPercent: traceabilityRatio },
      buildPlan: { ok: hasPlan, planFileCount, blocker: buildPlanBlocker },
      generateDocs: { ok: hasGeneratedDocs, totalActive: activeDocs.length, generated: generatedCount },
      validation: { ok: validationPassed, totalDocs: activeDocs.filter((d) => d.generationStatus === "GENERATED").length },
      exportReadiness: { ok: exportReady, criticalGaps: criticalGaps.length, readinessScore: canonical?.summary.readinessScore ?? 0 },
    },
    nextAction,
  });

  } catch (err) {
    logger.error("[pipeline-diagnostic] unexpected error:", { detail: err });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
