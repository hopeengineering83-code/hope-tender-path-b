import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { logAction } from "../../../../../../lib/audit";
import { assertTenderReadyForGenerationAndExport } from "../../../../../../lib/engine/generation-readiness-gate";
import { buildSubmissionPlanWithDerivedFallback, plannedSubmissionTargetFiles } from "../../../../../../lib/engine/submission-plan";
import { sanitizeError } from "../../../../../../lib/sanitize-error";
import { logger } from "../../../../../../lib/observability";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    let actor;
    try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
    catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

    await prismaReady;
    const { id } = await params;

    // Rule 6 Enforcement: No output GeneratedDocument row (even PLANNED)
    // may be created before strict release eligibility.
    const gate = await assertTenderReadyForGenerationAndExport({
      prisma,
      tenderId: id,
      userId: actor.id,
      purpose: "generate",
    });

    if (!gate.ok && gate.blockerCode !== "SUBMISSION_PLAN_MISSING") {
      return NextResponse.json({
        ok: false,
        errorCode: "BUILD_PLAN_PRECONDITION_FAILED",
        error: "Cannot build submission plan: tender is not yet eligible for release.",
        blocker: gate.blockerDetail,
        nextAction: "RESOLVE_READINESS_BLOCKERS",
      }, { status: 422 });
    }

    const tender = await prisma.tender.findFirst({
      where: { id, userId: actor.id },
      include: {
        requirements: true,
        files: { where: { deletionStatus: "ACTIVE" } },
        generatedDocuments: { where: { generationStatus: { not: "SUPERSEDED" } } },
      },
    });

    if (!tender) return NextResponse.json({ ok: false, error: "Tender not found" }, { status: 404 });

    const plan = buildSubmissionPlanWithDerivedFallback(tender);
    let plannedFiles = plannedSubmissionTargetFiles(plan);
    let isDerivedDraft = plan.warnings.some((w: string) => w.includes("derived draft"));

    if (plannedFiles.length === 0) {
      return NextResponse.json({
        ok: false,
        error: "No required submission files could be derived. Add mandatory requirements or explicit file names.",
        errorCode: "SUBMISSION_PLAN_EMPTY",
      }, { status: 422 });
    }

    const existingKeys = new Set(
      tender.generatedDocuments
        .map((doc: any) => (doc.exactFileName ?? doc.name ?? "").toLowerCase())
        .filter(Boolean),
    );

    let created = 0;
    for (const file of plannedFiles) {
      const key = file.exactFileName.toLowerCase();
      if (existingKeys.has(key)) continue;

      await prisma.generatedDocument.create({
        data: {
          tenderId: id,
          name: file.exactFileName,
          exactFileName: file.exactFileName,
          exactOrder: file.exactOrder,
          documentType: file.documentType ?? "TECHNICAL_PROPOSAL",
          generationStatus: "PLANNED",
          contentSummary: isDerivedDraft ? "DERIVED_DRAFT_UNCONFIRMED" : undefined,
          reviewStatus: "PENDING",
          validationStatus: "PENDING",
        },
      });
      created++;
    }

    await prisma.submissionPlanState.upsert({
      where: { tenderId: id },
      create: {
        tenderId: id,
        provenance: isDerivedDraft ? "DERIVED_DRAFT" : "REQUIREMENTS",
        activeDocumentCount: created + existingKeys.size,
      },
      update: {
        provenance: isDerivedDraft ? "DERIVED_DRAFT" : "REQUIREMENTS",
        activeDocumentCount: created + existingKeys.size,
      }
    });

    await logAction({
      userId: actor.id,
      action: "SUBMISSION_PLAN_BUILT",
      entityType: "Tender",
      entityId: id,
      description: `Submission plan built: ${created} new stubs created.`,
    });

    return NextResponse.json({ ok: true, created, total: plannedFiles.length });
  } catch (error) {
    logger.error("submission-plan/build failed", { error });
    return NextResponse.json({ ok: false, error: sanitizeError(error) }, { status: 500 });
  }
}
