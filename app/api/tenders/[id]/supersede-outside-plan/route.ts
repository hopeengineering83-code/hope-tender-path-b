import { NextResponse } from "next/server";
import { forbiddenResponse, requireRole, unauthorizedResponse } from "../../../../../lib/auth";
import { logAction } from "../../../../../lib/audit";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { buildSubmissionPlan } from "../../../../../lib/engine/submission-plan";
import { buildSubmissionPlanWithDerivedFallback } from "../../../../../lib/engine/submission-plan";
import { MUTATION_RATE_LIMIT, rateLimit } from "../../../../../lib/rate-limit";
import { extractRequestId } from "../../../../../lib/request-id";

export const dynamic = "force-dynamic";

const normalizeExactFileName = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

async function getOutsidePlanDocIds(tenderId: string, userId: string): Promise<{ ids: string[]; planEmpty: boolean }> {
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: {
      requirements: true,
      generatedDocuments: {
        where: { generationStatus: { not: "SUPERSEDED" } },
        select: { id: true, name: true, exactFileName: true },
      },
    },
  });
  if (!tender) return { ids: [], planEmpty: false };
  const plan = buildSubmissionPlanWithDerivedFallback(tender);
  if (plan.files.length === 0) return { ids: [], planEmpty: true };
  const required = new Set(plan.files.map((f) => normalizeExactFileName(f.exactFileName)).filter(Boolean));
  const ids = tender.generatedDocuments
    .filter((d) => !required.has(normalizeExactFileName(d.exactFileName ?? d.name)))
    .map((d) => d.id);
  return { ids, planEmpty: false };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  await prismaReady;
  const { id } = await params;
  const { ids: outsideIds, planEmpty } = await getOutsidePlanDocIds(id, actor.id);
  if (planEmpty) return NextResponse.json({ success: true, outsidePlanDocuments: [], warning: "Submission plan empty; outside-plan supersede skipped." });
  const outsidePlanDocuments = outsideIds.length
    ? await prisma.generatedDocument.findMany({ where: { id: { in: outsideIds } }, select: { id: true, name: true, exactFileName: true, exactOrder: true } })
    : [];

  return NextResponse.json({ success: true, outsidePlanDocuments });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  const requestId = extractRequestId(req);
  const rl = rateLimit(`supersede-outside-plan:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) return NextResponse.json({ success: false, error: "Rate limit exceeded. Wait and retry.", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });

  await prismaReady;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const requestedIds = Array.isArray(body.documentIds) ? body.documentIds.map(String) : [];

  const { ids: outsideIds, planEmpty } = await getOutsidePlanDocIds(id, actor.id);
  if (planEmpty) return NextResponse.json({ success: true, superseded: 0, warning: "Submission plan empty; outside-plan supersede skipped." });
  if (outsideIds.length === 0) return NextResponse.json({ success: true, superseded: 0 });

  const selectedIds = requestedIds.length > 0
    ? outsideIds.filter((docId) => requestedIds.includes(docId))
    : outsideIds;

  if (selectedIds.length === 0) return NextResponse.json({ success: false, error: "No selected documents are outside the submission plan." }, { status: 400 });

  await prisma.generatedDocument.updateMany({
    where: { id: { in: selectedIds }, tenderId: id },
    data: {
      generationStatus: "SUPERSEDED",
      validationStatus: "SUPERSEDED",
      reviewStatus: "NOT_EXPORTABLE",
      reviewNotes: "Superseded as outside submission plan.",
    },
  });

  await logAction({ userId: actor.id, action: "OUTSIDE_PLAN_SUPERSEDED", entityType: "Tender", entityId: id, description: `${actor.email} superseded ${selectedIds.length} outside-plan document(s).`, metadata: { tenderId: id, supersededCount: selectedIds.length, supersededIds: selectedIds }, requestId });

  return NextResponse.json({ success: true, superseded: selectedIds.length });
}
