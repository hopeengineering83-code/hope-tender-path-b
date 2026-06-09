import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { logAction } from "../../../../../lib/audit";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../../lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

function normalizeStatus(value: unknown): "RESOLVED" | "WAIVED" {
  const status = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (status === "RESOLVED" || status === "WAIVED") return status;
  throw new Error("status must be RESOLVED or WAIVED");
}

function normalizeNote(value: unknown): string {
  const note = typeof value === "string" ? value.trim() : "";
  if (note.length < 8) throw new Error("resolutionNote must be at least 8 characters.");
  if (note.length > 2000) throw new Error("resolutionNote must be 2000 characters or fewer.");
  return note;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return msg === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  await prismaReady;
  const { id } = await params;
  const tender = await prisma.tender.findFirst({ where: { id, userId: actor.id }, select: { id: true } });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const objections = await prisma.evaluatorObjection.findMany({
    where: { tenderId: id },
    select: { id: true, severity: true, category: true, title: true, description: true, sectionRef: true, status: true, resolvedAt: true, createdAt: true },
    orderBy: [{ status: "asc" }, { severity: "asc" }, { createdAt: "desc" }],
  });

  const openHigh = objections.filter((o) => o.status === "OPEN" && o.severity === "HIGH").length;
  const openTotal = objections.filter((o) => o.status === "OPEN").length;
  const resolvedTotal = objections.filter((o) => o.status === "RESOLVED").length;
  const waivedTotal = objections.filter((o) => o.status === "WAIVED").length;

  return NextResponse.json({
    success: true,
    objections,
    summary: {
      total: objections.length,
      open: openTotal,
      openHigh,
      resolved: resolvedTotal,
      waived: waivedTotal,
      exportBlockedByHighObjections: openHigh > 0,
    },
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return msg === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  const rl = rateLimit(`evaluator-objections:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });

  await prismaReady;
  const { id } = await params;
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const objectionId = typeof body.objectionId === "string" ? body.objectionId.trim() : "";
  if (!objectionId) return NextResponse.json({ error: "objectionId is required" }, { status: 400 });

  let status: "RESOLVED" | "WAIVED";
  let resolutionNote: string;
  try {
    status = normalizeStatus(body.status);
    resolutionNote = normalizeNote(body.resolutionNote);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid payload" }, { status: 400 });
  }

  const tender = await prisma.tender.findFirst({ where: { id, userId: actor.id }, select: { id: true, title: true } });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const existing = await prisma.evaluatorObjection.findFirst({ where: { id: objectionId, tenderId: id } });
  if (!existing) return NextResponse.json({ error: "Evaluator objection not found" }, { status: 404 });
  if (existing.status !== "OPEN") {
    return NextResponse.json({ error: `Only OPEN objections can be updated. Current status is ${existing.status}.` }, { status: 409 });
  }

  const updated = await prisma.evaluatorObjection.update({
    where: { id: objectionId },
    data: {
      status,
      resolvedAt: new Date(),
      resolvedBy: actor.id,
      resolutionNote,
      updatedAt: new Date(),
    },
  });

  await logAction({
    userId: actor.id,
    action: status === "RESOLVED" ? "EVALUATOR_OBJECTION_RESOLVED" : "EVALUATOR_OBJECTION_WAIVED",
    entityType: "Tender",
    entityId: id,
    description: `${actor.email} ${status.toLowerCase()} evaluator objection "${existing.title}" for "${tender.title}"`,
    metadata: {
      tenderId: id,
      objectionId,
      previousStatus: existing.status,
      newStatus: status,
      severity: existing.severity,
      category: existing.category,
      sectionRef: existing.sectionRef,
      resolutionNote,
    },
  });

  return NextResponse.json({ success: true, objection: updated });
}
