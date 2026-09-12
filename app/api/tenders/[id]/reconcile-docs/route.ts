// POST /api/tenders/[id]/reconcile-docs
//
// Manually trigger submission-plan reconciliation against the current
// GeneratedDocument rows. Returns the per-document decisions + the
// roll-up counts.
//
// Why a separate endpoint (not auto-run inside the engine):
//   • run-tender-engine.ts already supersedes ALL prior generated docs
//     at the top of each run when the plan changes substantially. That
//     blanket reset is intentional and audit-logged.
//   • For NON-disruptive cases (re-analysis that didn't change the
//     plan), users want fine-grained reconcile semantics — keep some,
//     supersede others, relink semantic matches. This endpoint provides
//     exactly that, on demand.
//   • UI button "Reconcile plan" can hit this endpoint and refresh the
//     submission-plan reconciliation panel.

import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { getCurrentConfirmedBuildPlan } from "../../../../../lib/engine/build-plan";
import { reconcileGeneratedDocuments, applyReconcileDecisions } from "../../../../../lib/engine/reconcile-generated-docs";
import { logAction } from "../../../../../lib/audit";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../../lib/rate-limit";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (e) {
    return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  const rl = rateLimit(`reconcile-docs:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });

  await prismaReady;
  const { id: tenderId } = await params;

  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId: actor.id },
    include: {
      requirements: { orderBy: { createdAt: "asc" } },
      generatedDocuments: {
        where: { generationStatus: { not: "SUPERSEDED" } },
        orderBy: [{ exactOrder: "asc" }, { createdAt: "asc" }],
      },
    },
  });
  if (!tender) {
    return NextResponse.json(
      {
        success: false,
        code: "TENDER_NOT_FOUND",
        message: "Tender not found or not owned by this user.",
        nextAction: "OPEN_DASHBOARD",
      },
      { status: 404 },
    );
  }

  // AUTHORITATIVE: reconciliation supersedes/relinks GeneratedDocument rows,
  // so it must run against the current source-verified BuildPlan only. A derived
  // heuristic plan could supersede documents that the verified plan requires.
  const confirmedPlan = await getCurrentConfirmedBuildPlan(prisma, tenderId, actor.id);
  if (!confirmedPlan.ok) {
    return NextResponse.json(
      {
        success: false,
        code: "BUILD_PLAN_NOT_CONFIRMED",
        message: `Reconciliation requires a current source-verified Build Plan. ${confirmedPlan.blocker}`,
        nextAction: "RUN_ENGINE",
      },
      { status: 422 },
    );
  }
  const plan = { files: confirmedPlan.items, warnings: [] as string[] } as any;

  const decisions = reconcileGeneratedDocuments({
    plan,
    generatedDocuments: tender.generatedDocuments.map((d) => ({
      id: d.id,
      name: d.name,
      exactFileName: d.exactFileName,
      documentType: d.documentType,
      format: d.format,
      generationStatus: d.generationStatus,
    })),
  });

  const result = await applyReconcileDecisions(prisma, decisions);

  await logAction({
    userId: actor.id,
    action: "TENDER_DOCS_RECONCILED",
    entityType: "Tender",
    entityId: tenderId,
    description: `Reconciled generated documents for "${tender.title}" — kept=${result.kept}, relinked=${result.relinked}, superseded=${result.superseded}, needsRevalidation=${result.needsRevalidation}.`,
    metadata: {
      tenderId,
      plannedFileCount: plan.files.length,
      activeDocCount: tender.generatedDocuments.length,
      ...result,
      decisionsByAction: decisions.reduce<Record<string, number>>((acc, d) => {
        acc[d.action] = (acc[d.action] ?? 0) + 1;
        return acc;
      }, {}),
    },
  });

  return NextResponse.json({
    success: true,
    tenderId,
    plannedFileCount: plan.files.length,
    activeDocCount: tender.generatedDocuments.length,
    summary: result,
    decisions: decisions.map((d) => ({
      documentId: d.documentId,
      documentName: d.documentName,
      action: d.action,
      matchedPlanFileName: d.matchedPlanFileName ?? null,
      rationale: d.rationale,
    })),
  });
}
