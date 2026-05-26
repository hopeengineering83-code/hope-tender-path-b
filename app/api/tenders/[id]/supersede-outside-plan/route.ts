import { NextResponse } from "next/server";
import { forbiddenResponse, requireRole, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { buildSubmissionPlan } from "../../../../../lib/engine/submission-plan";
const normalizeExactFileName = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor; try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"); } catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }
  await prismaReady;
  const { id } = await params;
  const tender = await prisma.tender.findFirst({ where: { id, userId: actor.id }, include: { requirements: true, generatedDocuments: { where: { generationStatus: { not: "SUPERSEDED" } }, select: { id: true, name: true, exactFileName: true } } } });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });
  const plan = buildSubmissionPlan(tender);
  const required = new Set(plan.files.map((f) => normalizeExactFileName(f.exactFileName)).filter(Boolean));
  const outside = tender.generatedDocuments.filter((d) => !required.has(normalizeExactFileName(d.exactFileName ?? d.name)));
  return NextResponse.json({ success: true, outsidePlanDocuments: outside });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor; try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); } catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }
  await prismaReady;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.documentIds) ? body.documentIds.map(String) : [];
  const where = ids.length ? { tenderId: id, id: { in: ids } } : { tenderId: id, generationStatus: { not: "SUPERSEDED" } };
  const docs = await prisma.generatedDocument.findMany({ where, select: { id: true } });
  if (docs.length === 0) return NextResponse.json({ success: true, superseded: 0 });
  await prisma.generatedDocument.updateMany({ where: { id: { in: docs.map((d) => d.id) } }, data: { generationStatus: "SUPERSEDED", validationStatus: "SUPERSEDED", reviewStatus: "NOT_EXPORTABLE", reviewNotes: "Superseded as outside submission plan." } });
  return NextResponse.json({ success: true, superseded: docs.length });
}
