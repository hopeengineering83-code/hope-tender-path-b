// POST /api/tenders/[id]/deduplicate-documents
// Supersedes duplicate GeneratedDocument rows, keeping the best (latest with content).
// Auth: ADMIN or PROPOSAL_MANAGER

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { logAction } from "../../../../../lib/audit";
import { MUTATION_RATE_LIMIT, rateLimit } from "../../../../../lib/rate-limit";
import { planDeduplication } from "../../../../../lib/engine/generated-document-dedup-planner";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const rl = rateLimit(`dedup:${ip}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });

  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  await prismaReady;
  const { id: tenderId } = await params;
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const dryRun = body.dryRun === true;

  // Verify tender ownership (audit SEC-003, 2026-06-20). The previous lookup
  // had NO userId filter — any ADMIN/PROPOSAL_MANAGER from any company could
  // pass another company's tender UUID and supersede all of that tender's
  // duplicate documents (destructive `generationStatus: "SUPERSEDED"`).
  // The owner-scoped findFirst is the only safe lookup; if the tender doesn't
  // belong to the actor, return 404 (not 403, to avoid leaking existence).
  const tender = await prisma.tender.findFirst({ where: { id: tenderId, userId: actor.id }, select: { id: true } });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  // Load all non-superseded docs
  const docs = await prisma.generatedDocument.findMany({
    where: { tenderId, generationStatus: { not: "SUPERSEDED" } },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true, name: true, exactFileName: true, documentType: true,
      reviewStatus: true, generationStatus: true, validationStatus: true,
      updatedAt: true, fileContent: true, storagePath: true, exactOrder: true,
    },
  });

  // Delegate the grouping + keep/supersede decisions to the pure planner
  // module so the same logic is unit-testable across canonical-name variants.
  const plan = planDeduplication(docs);

  if (!dryRun && plan.supersedeIds.length > 0) {
    await prisma.generatedDocument.updateMany({
      where: { id: { in: plan.supersedeIds } },
      data: { generationStatus: "SUPERSEDED", validationStatus: "SUPERSEDED" },
    });
    // Audit metadata carries the per-row reason so a reviewer can audit WHY
    // each historical row was retired.
    const supersededDecisions = plan.decisions.filter((d) => d.action === "SUPERSEDE");
    await logAction({
      userId: actor.id,
      action: "DOCUMENT_DEDUPLICATE",
      entityType: "Tender",
      entityId: tenderId,
      description: `Superseded ${plan.supersedeIds.length} duplicate document(s) across ${plan.summary.duplicateGroups} canonical group(s).`,
      metadata: {
        tenderId,
        duplicateGroups: plan.summary.duplicateGroups,
        supersededCount: plan.summary.supersededRows,
        keptCount: plan.summary.keptRows,
        decisions: supersededDecisions.map((d) => ({ id: d.id, groupKey: d.groupKey, reason: d.reason })),
      },
    });
  }

  return NextResponse.json({
    success: true,
    dryRun,
    duplicatesFound: plan.supersedeIds.length,
    supersededIds: dryRun ? plan.supersedeIds : [],
    summary: plan.summary,
    // Surface the per-row plan when dryRun so the operator can preview.
    plan: dryRun ? plan.decisions : undefined,
  });
}
