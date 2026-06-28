import { assertTenderReadyForGenerationAndExport } from "../../../../../../lib/engine/generation-readiness-gate";
import { logger } from "../../../../../../lib/observability";
import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { buildSubmissionPlan, buildSubmissionPlanWithDerivedFallback, plannedSubmissionTargetFiles, buildDerivedDraftPlan } from "../../../../../../lib/engine/submission-plan";
import { logAction } from "../../../../../../lib/audit";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../../../lib/rate-limit";
import { sanitizeError } from "../../../../../../lib/sanitize-error";
import { assessExtractionQualityPerPage } from "../../../../../../lib/extraction-quality";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await (params as any);
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"); } catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }
  const userId = actor.id;

  // Rule 6: No GeneratedDocument before eligibility
  const gate = await assertTenderReadyForGenerationAndExport({ prisma, tenderId: id, userId, purpose: "generate" });
  if (!gate.ok) {
    return NextResponse.json({ error: `Submission plan build blocked: ${gate.blockerDetail}`, code: gate.blockerCode }, { status: 422 });
  }

  const rl = rateLimit(`submission-plan-build:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "Rate limit exceeded. Please wait and retry.", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    );
  }

  await prismaReady;

  try {
    const tender = await prisma.tender.findFirst({
      where: { id, userId: actor.id },
      include: {
        files: { where: { deletionStatus: "ACTIVE" } },
        requirements: true,
        generatedDocuments: { where: { generationStatus: { not: "SUPERSEDED" } } },
      },
    });

    if (!tender) return NextResponse.json({ error: "Tender not found or access denied" }, { status: 404 });

    const plan = buildSubmissionPlanWithDerivedFallback(tender as any);
    let plannedFiles = plannedSubmissionTargetFiles(plan);
    let isDerivedDraft = plan.warnings.some((w: string) => w.includes("derived draft"));

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
        tenderCategory: tender.category,
        analysisExtractionStatus: tender.analysisExtractionStatus as any,
      });

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
    }

    const existingKeys = new Set(
      tender.generatedDocuments
        .map((doc) => (doc.exactFileName ?? doc.name ?? "").toLowerCase())
        .filter(Boolean),
    );

    let created = 0;
    let skipped = 0;
    for (const file of plannedFiles) {
      const key = file.exactFileName.toLowerCase();
      if (existingKeys.has(key)) {
        skipped++;
        continue;
      }

      await prisma.generatedDocument.create({
        data: {
          tenderId: id,
          name: file.exactFileName,
          exactFileName: file.exactFileName,
          exactOrder: file.exactOrder,
          documentType: (file.documentType as any) ?? "TECHNICAL_PROPOSAL",
          generationStatus: "PLANNED",
          contentSummary: isDerivedDraft ? "DERIVED_DRAFT_UNCONFIRMED" : undefined,
        },
      });
      created++;
    }

    const contentPageWarnings: string[] = [];
    if (tender.files.length > 0) {
      let anySubmission = false;
      let anyEvaluation = false;
      let anyRequiredDocs = false;
      for (const file of tender.files) {
        const pp = assessExtractionQualityPerPage(file.extractedText);
        if (pp.submissionInstructionPages.length > 0) anySubmission = true;
        if (pp.evaluationCriteriaPages.length > 0) anyEvaluation = true;
        if (pp.requiredDocumentPages.length > 0) anyRequiredDocs = true;
      }
      const missingSections: string[] = [];
      if (!anySubmission) missingSections.push("submission instructions");
      if (!anyEvaluation) missingSections.push("evaluation criteria");
      if (!anyRequiredDocs) missingSections.push("required documents/forms");
      if (missingSections.length > 0) {
        contentPageWarnings.push(`Submission plan cannot be trusted because required tender pages were not fully extracted — no ${missingSections.join(" or ")} pages detected. Re-extract or run OCR, then re-run AI Analyze before finalizing the plan.`);
      }
    }

    await logAction({
      userId: actor.id,
      action: "SUBMISSION_PLAN_BUILT",
      entityType: "Tender",
      entityId: id,
      description: `Submission plan built for tender "${tender.title}" — ${created} created, ${skipped} skipped`,
      metadata: { created, skipped, total: plannedFiles.length, isDerivedDraft },
    });

    return NextResponse.json({
      ok: true,
      created,
      skipped,
      total: plannedFiles.length,
      isDerivedDraft,
      contentPageWarnings: contentPageWarnings.length > 0 ? contentPageWarnings : undefined,
    });
  } catch (error) {
    logger.error("[submission-plan/build] error:", { detail: error });
    return NextResponse.json({ ok: false, error: sanitizeError(error) }, { status: 500 });
  }
}
