import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { logAction } from "../../../../../lib/audit";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../../lib/rate-limit";
import {
  appendControlNote,
  auditLogToControlRecord,
  controlActionForType,
  controlDescription,
  controlSummary,
  normalizeTenderControlPayload,
} from "../../../../../lib/engine/tender-control-ledger";

export const dynamic = "force-dynamic";

function stageForControl(type: string, currentStage: string): string {
  if (["ADDENDUM", "CLARIFICATION", "QUESTION"].includes(type)) return "COMPLIANCE";
  if (["MILESTONE", "TASK", "RISK"].includes(type)) return currentStage === "TENDER_INTAKE" ? "MATCHING" : currentStage;
  if (type === "COMMERCIAL_ASSUMPTION") return "COMMERCIAL";
  return currentStage;
}

function statusForControl(type: string, currentStatus: string): string {
  if (["ADDENDUM", "CLARIFICATION", "QUESTION"].includes(type)) return "COMPLIANCE_REVIEW";
  if (type === "RISK" && currentStatus === "EXPORTED") return "COMPLIANCE_REVIEW";
  return currentStatus;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return msg === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  await prismaReady;
  const { id } = await params;
  const tender = await prisma.tender.findFirst({ where: { id, userId: actor.id }, select: { id: true } });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const logs = await prisma.auditLog.findMany({
    where: { entityType: "Tender", entityId: id, action: { startsWith: "TENDER_CONTROL_" } },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  const records = logs.map(auditLogToControlRecord).filter((r): r is NonNullable<typeof r> => r !== null);
  return NextResponse.json({ success: true, controls: records, summary: controlSummary(records) });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return msg === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  const rl = rateLimit(`controls:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });

  await prismaReady;
  const { id } = await params;
  let control;
  try {
    control = normalizeTenderControlPayload(await req.json());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid control payload" }, { status: 400 });
  }

  const tender = await prisma.tender.findFirst({ where: { id, userId: actor.id }, select: { id: true, title: true, notes: true, status: true, stage: true } });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  await logAction({
    userId: actor.id,
    action: controlActionForType(control.type),
    entityType: "Tender",
    entityId: id,
    description: controlDescription(actor.email, tender.title, control),
    metadata: { tenderId: id, control },
  });

  await prisma.tender.update({
    where: { id },
    data: {
      notes: appendControlNote(tender.notes, control),
      status: statusForControl(control.type, tender.status),
      stage: stageForControl(control.type, tender.stage),
    },
  });

  return NextResponse.json({ success: true, control });
}
