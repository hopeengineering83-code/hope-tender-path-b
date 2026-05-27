import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { getFinalSubmissionReadiness } from "../../../../../lib/engine/final-submission-readiness";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

function jsonError(message: string, status = 500, extra: Record<string, unknown> = {}) {
  const code = typeof extra.code === "string" ? extra.code : "EXPORT_READINESS_ERROR";
  return NextResponse.json({ ok: false, success: false, code, message, error: message, ...extra }, { status });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    let actor;
    try {
      actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      return msg === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
    }

    await prismaReady;
    const { id } = await params;
    const readiness = await getFinalSubmissionReadiness(prisma, { tenderId: id, userId: actor.id, requireFileContent: false });
    if (!readiness) return jsonError("Tender not found", 404, { code: "TENDER_NOT_FOUND" });

    // Canonical shape — Bid Control, Export Readiness Panel, Final Submission
    // Control Center, and the download route all read from this exact payload.
    return NextResponse.json({
      success: true,
      exportReadiness: {
        ok: readiness.ok,
        tender: readiness.tender,
        summary: {
          // Legacy fields kept for backwards compatibility with consumers that
          // still read `activeDocuments` / `workspaceDocuments` /
          // `excludedInternalDrafts` from the old shape.
          activeDocuments: readiness.summary.finalExportCandidates,
          workspaceDocuments: readiness.summary.workspaceDocuments,
          excludedInternalDrafts: readiness.summary.excludedInternalRows,
          documentBlockers: readiness.summary.documentBlockers,
          tenderLevelBlockers: readiness.summary.tenderLevelBlockers,
          advisoryWarnings: readiness.summary.advisoryWarnings,
          totalBlockers: readiness.summary.totalBlockers,
          // Canonical extension — used by Bid Control + audit endpoint.
          finalExportCandidates: readiness.summary.finalExportCandidates,
          excludedInternalRows: readiness.summary.excludedInternalRows,
          missingContentCount: readiness.summary.missingContentCount,
          invalidSignatureCount: readiness.summary.invalidSignatureCount,
          hygieneIssueCount: readiness.summary.hygieneIssueCount,
          officialOriginalBlockers: readiness.summary.officialOriginalBlockers,
          envelopeBreakdown: readiness.summary.envelopeBreakdown,
          strictTwoEnvelope: readiness.summary.strictTwoEnvelope,
          packageMode: readiness.summary.packageMode,
          planStatus: readiness.summary.planStatus,
        },
        documentBlockers: readiness.documentBlockers,
        tenderLevelBlockers: readiness.tenderLevelBlockers,
        advisoryWarnings: readiness.advisoryWarnings,
        message: readiness.message,
      },
    });
  } catch (error) {
    console.error("Export readiness route failed", error);
    return jsonError("Export-readiness route failed.", 500, {
      code: "EXPORT_READINESS_RUNTIME_ERROR",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
