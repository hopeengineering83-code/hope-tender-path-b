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
import { computeTenderLifecycle } from "../../../../../lib/engine/tender-lifecycle-orchestrator";
import { deriveControlSuggestions, type SuggestedControl } from "../../../../../lib/engine/tender-control-suggestions";

export const dynamic = "force-dynamic";

// ── Suggested controls derived from lifecycle state (read-only, no DB writes) ─
//
// Delegates to the pure lib/engine/tender-control-suggestions module so the
// derivation is unit-testable and covers every blocker category from the
// audit task (metadata, regex fallback, source refs, mandatory coverage,
// outside-plan, planned-not-generated, no-export-candidates, AI providers,
// official originals, quality-failed, plan-not-built).

async function deriveSuggestedControls(tenderId: string): Promise<SuggestedControl[]> {
  try {
    const lifecycle = await computeTenderLifecycle(prisma, tenderId);
    if (!lifecycle) return [];
    const all = deriveControlSuggestions({
      metadataStatus: lifecycle.metadataStatus,
      analysisStatus: lifecycle.analysisStatus,
      sourceReferenceStatus: lifecycle.sourceReferenceStatus,
      planStatus: lifecycle.planStatus,
      evidenceStatus: lifecycle.evidenceStatus,
      counts: lifecycle.counts,
      providerStatus: lifecycle.providerStatus,
      officialOriginalStatus: lifecycle.officialOriginalStatus,
    });
    // Hide suggestions the user has explicitly rejected. Lookup the audit log
    // for TENDER_CONTROL_SUGGESTION_REJECTED entries on this tender; the
    // suggestionCode lives in the metadata blob.
    const rejectedLogs = await prisma.auditLog.findMany({
      where: { entityType: "Tender", entityId: tenderId, action: "TENDER_CONTROL_SUGGESTION_REJECTED" },
      select: { metadata: true },
    });
    const rejectedCodes = new Set<string>();
    for (const row of rejectedLogs) {
      const raw = row.metadata;
      const parsed = typeof raw === "string" ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
      const code = parsed && typeof parsed === "object" && "suggestionCode" in (parsed as Record<string, unknown>)
        ? String((parsed as Record<string, unknown>).suggestionCode)
        : null;
      if (code) rejectedCodes.add(code);
    }
    return all.filter((s) => !rejectedCodes.has(s.code));
  } catch {
    // Never block the main controls response if suggestion derivation fails.
    return [];
  }
}

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

  const [logs, suggested] = await Promise.all([
    prisma.auditLog.findMany({
      where: { entityType: "Tender", entityId: id, action: { startsWith: "TENDER_CONTROL_" } },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
    deriveSuggestedControls(id),
  ]);
  const records = logs.map(auditLogToControlRecord).filter((r): r is NonNullable<typeof r> => r !== null);
  return NextResponse.json({ success: true, controls: records, suggestedControls: suggested, summary: controlSummary(records) });
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
