import { logger } from "../../../../../lib/observability";
// Submission Plan Completeness endpoint.
//
// Returns the full per-row plan view answering the screenshot question
// "where are the missing 13 of 19 docs?" — for each planned file the
// response includes status (GENERATED / GENERATED_NEEDS_REVIEW /
// GENERATED_QUALITY_FAILED / PLANNED / OFFICIAL_ORIGINAL_REQUIRED /
// REPLACE_WITH_ORIGINAL / MISSING / OUTSIDE_PLAN / SUPERSEDED) and a
// recommended next action.
//
// Auth: ADMIN / PROPOSAL_MANAGER / REVIEWER. User-scoped tender query.

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { resolveSubmissionPlanCompleteness } from "../../../../../lib/engine/submission-plan-completeness";
import { getCurrentConfirmedBuildPlan } from "../../../../../lib/engine/build-plan";
import { extractRequestId } from "../../../../../lib/request-id";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

function err(message: string, status = 500, extra: Record<string, unknown> = {}) {
  const code = typeof extra.code === "string" ? extra.code : "SUBMISSION_PLAN_ERROR";
  return NextResponse.json({ ok: false, success: false, code, error: message, message, ...extra }, { status });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = extractRequestId(req);
  try {
    let actor;
    try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"); }
    catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }
    await prismaReady;
    const { id } = await params;

    const tender = await prisma.tender.findFirst({
      where: { id, userId: actor.id },
      select: {
        id: true,
        title: true,
        exactFileNaming: true,
        exactFileOrder: true,
        pageLimit: true,
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
          orderBy: [{ exactOrder: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            name: true,
            exactFileName: true,
            exactOrder: true,
            documentType: true,
            format: true,
            generationStatus: true,
            validationStatus: true,
            reviewStatus: true,
            storagePath: true,
            contentSummary: true,
          },
        },
      },
    });
    if (!tender) return err("Tender not found", 404, { code: "TENDER_NOT_FOUND" });

    // Keep this endpoint metadata-only to avoid loading GeneratedDocument.fileContent
    // on every dashboard poll. Deep content/quality checks remain in the canonical
    // export-readiness and admin audit routes that intentionally inspect bytes.
    const qualityFailedIds = new Set<string>();

    // AUTHORITATIVE: when a current source-verified Build Plan exists,
    // completeness is computed against ITS items so this panel can never
    // disagree with the plan the generation/export gates enforce.
    const confirmedPlan = await getCurrentConfirmedBuildPlan(prisma, id, actor.id);
    const report = resolveSubmissionPlanCompleteness({
      tender,
      generatedDocuments: tender.generatedDocuments.map((doc) => ({ ...doc, fileContent: null })),
      qualityFailedIds,
      confirmedPlanItems: confirmedPlan.ok ? confirmedPlan.items : null,
    });
    const automaticPlanPending = !confirmedPlan.ok;

    return NextResponse.json({
      success: true,
      tender: { id: tender.id, title: tender.title },
      summary: {
        totalRequired: report.totalRequired,
        totalGenerated: report.totalGenerated,
        totalMissing: report.totalMissing,
        totalOfficialOriginalsRequired: report.totalOfficialOriginalsRequired,
        totalOutsidePlan: report.totalOutsidePlan,
        totalSuperseded: report.totalSuperseded,
        totalQualityFailed: report.totalQualityFailed,
        envelopeBreakdown: report.envelopeBreakdown,
        requirementCount: report.requirementCount,
        hasExplicitScope: report.hasExplicitScope,
        planState: report.planState,
        // Retained as a compatibility field. The current workflow never needs
        // a generic human confirmation; missing/stale plans are rebuilt and
        // source-verified automatically by the Engine or recovery action.
        requiresUserConfirmation: false,
        automaticPlanPending,
        automaticPlanBlocker: confirmedPlan.ok ? null : confirmedPlan.blocker,
      },
      rows: report.rows,
      warnings: report.warnings.map((warning) =>
        warning
          .replace(/Build and confirm it before generation or export\./g, "The Engine will build and source-verify it automatically before generation or export.")
          .replace(/Confirm tender-issued file names\/order before final export/g, "The server will verify tender-issued file names/order before final export"),
      ),
    });
  } catch (error) {
    logger.error("submission-plan route failed", {
      requestId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return err("Submission-plan route failed.", 500, {
      code: "SUBMISSION_PLAN_RUNTIME_ERROR",
      requestId,
    });
  }
}
