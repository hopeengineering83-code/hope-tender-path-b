import { logger } from "../../../../../lib/observability";
// Canonical readiness score endpoint.
//
// Background:
//   The dashboard previously read `tender.readinessScore` directly from the
//   database. That column drifts from the actual gate state — the screenshot
//   regression showed "Readiness 100%" while evidence coverage was 0% and
//   13 required documents were missing, because the DB column was never
//   updated to reflect those failed gates.
//
//   This endpoint surfaces the *gated* score from
//   getFinalSubmissionReadiness() so the UI can render the same number that
//   the gates use. The DB column is left alone (other consumers still read
//   it for legacy purposes) but the UI shows reality.
//
// Response shape:
//   { ok, score, severity, capReason, capDimension, summary, dimensions }
//
// Auth: ADMIN, PROPOSAL_MANAGER, or REVIEWER. VIEWER is rejected to mirror
// the other tender routes.

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { getFinalSubmissionReadiness } from "../../../../../lib/engine/final-submission-readiness";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

function err(message: string, status = 500, extra: Record<string, unknown> = {}) {
  const code = typeof extra.code === "string" ? extra.code : "READINESS_SCORE_ERROR";
  return NextResponse.json({ ok: false, success: false, code, error: message, message, ...extra }, { status });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    let actor;
    try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"); }
    catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }
    await prismaReady;
    const { id } = await params;

    const readiness = await getFinalSubmissionReadiness(prisma, { tenderId: id, userId: actor.id });
    if (!readiness) return err("Tender not found", 404, { code: "TENDER_NOT_FOUND" });

    return NextResponse.json({
      success: true,
      ok: readiness.ok,
      score: readiness.summary.readinessScore,
      severity: readiness.summary.readinessScore >= 80 ? "READY" : readiness.summary.readinessScore >= 50 ? "PARTIAL" : "BLOCKED",
      capReason: readiness.summary.readinessCapReason,
      capDimension: readiness.summary.readinessCapDimension,
      capScore: readiness.summary.readinessCapScore,
      tender: readiness.tender,
      summary: {
        // Gate signals consumed by the readiness-score widget on the dashboard.
        ok: readiness.ok,
        readinessScore: readiness.summary.readinessScore,
        capReason: readiness.summary.readinessCapReason,
        capDimension: readiness.summary.readinessCapDimension,
        capScore: readiness.summary.readinessCapScore,
        analysisSource: readiness.summary.analysisSource,
        metadataCompletenessRatio: readiness.summary.metadataCompletenessRatio,
        missingCriticalMetadataCount: readiness.summary.missingCriticalMetadataCount,
        metadataPlaceholderCount: readiness.summary.metadataPlaceholderCount,
        missingRequiredDocuments: readiness.summary.missingRequiredDocuments,
        outsidePlanDocuments: readiness.summary.outsidePlanDocuments,
        finalExportCandidates: readiness.summary.finalExportCandidates,
        workspaceDocuments: readiness.summary.workspaceDocuments,
        staleRowCount: readiness.summary.staleRowCount,
        qualityFailedDocuments: readiness.summary.qualityFailedDocuments,
        documentBlockers: readiness.summary.documentBlockers,
        tenderLevelBlockers: readiness.summary.tenderLevelBlockers,
        advisoryWarnings: readiness.summary.advisoryWarnings,
        envelopeBreakdown: readiness.summary.envelopeBreakdown,
        strictTwoEnvelope: readiness.summary.strictTwoEnvelope,
        planStatus: readiness.summary.planStatus,
        ungeneratedPlannedRequired: readiness.summary.ungeneratedPlannedRequired,
        missingCriticalMetadataFields: readiness.summary.missingCriticalMetadataFields,
      },
    });
  } catch (error) {
    logger.error("readiness-score route failed", { detail: error });
    return err("Readiness-score route failed.", 500, { code: "READINESS_SCORE_RUNTIME_ERROR", detail: error instanceof Error ? error.message : String(error) });
  }
}
