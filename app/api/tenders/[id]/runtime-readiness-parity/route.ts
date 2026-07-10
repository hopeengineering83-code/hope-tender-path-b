// GET /api/tenders/[id]/runtime-readiness-parity
//
// Returns sanitized runtime-readiness parity payload showing:
//   - All metadata facts (deadline, submissionMethod, emails, etc.)
//   - Panel states (tenderDetail, confirmMetadata, etc.)
//   - Contradictions detected
//   - Next action
//
// Never exposes full tender text, full file bytes, raw prompts, provider
// keys, secrets, or full Prisma error.

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { getRuntimeReadinessFacts, safePanelError } from "../../../../../lib/engine/runtime-readiness-facts";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER");
  } catch (e) {
    return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  await prismaReady;
  const { id: tenderId } = await params;

  // Tenant ownership check
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId: actor.id },
    select: { id: true },
  });
  if (!tender) {
    return NextResponse.json({ error: "Tender not found" }, { status: 404 });
  }

  try {
    const facts = await getRuntimeReadinessFacts(prisma, tenderId, actor.id);

    // Build sanitized payload
    const sanitizeFact = (f: any) => ({
      key: f.key,
      value: Array.isArray(f.value) ? f.value.join(", ") : f.value,
      resolved: f.resolved,
      source: f.source,
      sourceEvidenceStatus: f.sourceEvidenceStatus,
      finalStatus: f.finalStatus,
      draftBlocker: f.draftBlocker,
      finalBlocker: f.finalBlocker,
      reason: f.reason,
    });

    // Determine panel states
    const panelStates = {
      tenderDetail: "loaded",
      confirmMetadata: facts.metadata.deadline.resolved ? "ok" : "blocked",
      recoveryCommandCenter: facts.metadata.deadline.resolved ? "ok" : "blocked",
      executiveSnapshot: facts.buildPlan.exportReadyAllowed ? "ready" : "blocked",
      canonicalReadiness: facts.metadata.deadline.resolved && facts.metadata.submissionMethod.resolved ? "ok" : "blocked",
      bidControl: facts.analysis.contentChangedHardBlock ? "blocked" : "ok",
      // NOTE: facts.finalPackage.exportReady is always false (the runtime
      // facts builder does not call the expensive getFinalSubmissionReadiness).
      // This is intentionally fail-closed — the actual export-ready verdict
      // is computed by the /export-readiness and /download routes. Do NOT
      // change this to call getFinalSubmissionReadiness here without profiling
      // (it loads full tender data + generated docs).
      finalSubmission: facts.finalPackage.exportReady ? "ready" : "blocked",
    };

    // Next action
    let nextAction = "All checks passed";
    if (facts.contradictions.length > 0) {
      nextAction = `Resolve ${facts.contradictions.length} contradiction(s): ${facts.contradictions.map((c) => c.field).join(", ")}`;
    } else if (!facts.buildPlan.buildPlanExists) {
      nextAction = "Create Build Plan";
    } else if (facts.analysis.contentChangedHardBlock) {
      nextAction = "Re-run AI Analyze (content changed, no current analysis)";
    } else if (facts.analysis.contentChangedWarningOnly) {
      nextAction = "Re-run AI Analyze recommended (content changed, but draft can proceed)";
    }

    return NextResponse.json({
      ok: true,
      tenderId,
      deployment: {
        commitSha: process.env.VERCEL_GIT_COMMIT_SHA || "unknown",
        deploymentId: process.env.VERCEL_DEPLOYMENT_ID || "unknown",
        deploymentUrl: process.env.VERCEL_URL || "unknown",
        environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
        buildTime: new Date().toISOString(),
      },
      facts: {
        deadline: sanitizeFact(facts.metadata.deadline),
        submissionMethod: sanitizeFact(facts.metadata.submissionMethod),
        submissionEmails: sanitizeFact(facts.metadata.submissionEmails),
        emailSubject: sanitizeFact(facts.metadata.emailSubject),
        financialProposalRequired: sanitizeFact(facts.metadata.financialProposalRequired),
        buildPlan: facts.buildPlan,
        analysis: {
          hasGoodAnalysisForCurrentSource: facts.analysis.hasGoodAnalysisForCurrentSource,
          contentChangedHardBlock: facts.analysis.contentChangedHardBlock,
          contentChangedWarningOnly: facts.analysis.contentChangedWarningOnly,
          stalePartialJobsCount: facts.analysis.stalePartialJobs.length,
        },
      },
      panelStates,
      contradictions: facts.contradictions,
      nextAction,
    });
  } catch (err) {
    const { message, diagnosticId } = safePanelError("runtime-readiness-parity", err);
    return NextResponse.json({
      ok: false,
      error: message,
      diagnosticId,
      tenderId,
    }, { status: 500 });
  }
}
