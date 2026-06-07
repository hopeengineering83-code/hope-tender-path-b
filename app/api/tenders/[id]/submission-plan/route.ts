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
import { sanitizeError } from "../../../../../lib/sanitize-error";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

function err(message: string, status = 500, extra: Record<string, unknown> = {}) {
  const code = typeof extra.code === "string" ? extra.code : "SUBMISSION_PLAN_ERROR";
  return NextResponse.json({ ok: false, success: false, code, error: message, message, ...extra }, { status });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
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

    const report = resolveSubmissionPlanCompleteness({
      tender,
      generatedDocuments: tender.generatedDocuments.map((doc) => ({ ...doc, fileContent: null })),
      qualityFailedIds,
    });

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
        requiresUserConfirmation: report.requiresUserConfirmation,
      },
      rows: report.rows,
      warnings: report.warnings,
    });
  } catch (error) {
    console.error("submission-plan route failed", error);
    return err("Submission-plan route failed.", 500, { code: "SUBMISSION_PLAN_RUNTIME_ERROR", detail: sanitizeError(error) });
  }
}
