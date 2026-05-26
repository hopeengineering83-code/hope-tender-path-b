import { NextResponse } from "next/server";
import { forbiddenResponse, requireRole, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { buildSubmissionPlan } from "../../../../../lib/engine/submission-plan";

export const dynamic = "force-dynamic";

const normalizeExactFileName = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

async function getOutsidePlanDocIds(tenderId: string, userId: string): Promise<string[]> {
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
  if (!tender) return [];
  const plan = buildSubmissionPlan(tender);
  const required = new Set(plan.files.map((f) => normalizeExactFileName(f.exactFileName)).filter(Boolean));
  return tender.generatedDocuments
    .filter((d) => !required.has(normalizeExactFileName(d.exactFileName ?? d.name)))
    .map((d) => d.id);
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  await prismaReady;
  const { id } = await params;
  const outsideIds = await getOutsidePlanDocIds(id, actor.id);
  const outsidePlanDocuments = outsideIds.length
    ? await prisma.generatedDocument.findMany({ where: { id: { in: outsideIds } }, select: { id: true, name: true, exactFileName: true, exactOrder: true } })
    : [];

  return NextResponse.json({ success: true, outsidePlanDocuments });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  await prismaReady;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const requestedIds = Array.isArray(body.documentIds) ? body.documentIds.map(String) : [];
  const outsideIds = await getOutsidePlanDocIds(id, actor.id);
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

  return NextResponse.json({ success: true, superseded: selectedIds.length });
}
