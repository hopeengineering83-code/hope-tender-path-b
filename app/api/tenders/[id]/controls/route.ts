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

export const dynamic = "force-dynamic";

// ── Suggested controls derived from lifecycle state (read-only, no DB writes) ─

type SuggestedControl = {
  id: string;
  type: "TASK" | "RISK";
  title: string;
  description: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  status: "SUGGESTED";
  action: "SUGGESTED";
  createdAt: string;
  createdBy: null;
};

async function deriveSuggestedControls(tenderId: string): Promise<SuggestedControl[]> {
  try {
    const lifecycle = await computeTenderLifecycle(prisma, tenderId);
    if (!lifecycle) return [];

    const suggested: SuggestedControl[] = [];
    const now = new Date().toISOString();

    // Metadata incomplete
    if (lifecycle.metadataStatus.criticalMissing.length > 0) {
      suggested.push({
        id: `suggested-metadata-${tenderId}`,
        type: "TASK",
        title: "Complete critical metadata",
        description: `Missing fields: ${lifecycle.metadataStatus.criticalMissing.slice(0, 4).join(", ")}. Incomplete metadata blocks downstream analysis accuracy.`,
        severity: "HIGH",
        status: "SUGGESTED",
        action: "SUGGESTED",
        createdAt: now,
        createdBy: null,
      });
    }

    // Regex fallback unapproved
    if (lifecycle.analysisStatus.source === "REGEX_FALLBACK_AI_ERROR") {
      suggested.push({
        id: `suggested-fallback-${tenderId}`,
        type: "RISK",
        title: "Analysis is regex fallback — low confidence",
        description: "AI analysis failed and regex fallback is unapproved. Requirement list may be incomplete. Retry AI Analyze or approve fallback with a human note.",
        severity: "HIGH",
        status: "SUGGESTED",
        action: "SUGGESTED",
        createdAt: now,
        createdBy: null,
      });
    }

    // Outside-plan documents
    if (lifecycle.counts.outsidePlanRows > 0) {
      suggested.push({
        id: `suggested-outside-plan-${tenderId}`,
        type: "TASK",
        title: `Reconcile ${lifecycle.counts.outsidePlanRows} outside-plan document(s)`,
        description: "Documents exist that are not mapped to any submission plan row. Map, supersede, or delete them before export.",
        severity: "MEDIUM",
        status: "SUGGESTED",
        action: "SUGGESTED",
        createdAt: now,
        createdBy: null,
      });
    }

    // Mandatory requirements uncovered
    const totalReqs = lifecycle.evidenceStatus.totalRequirements;
    const coveredReqs = lifecycle.evidenceStatus.requirementsWithLinkedEvidence;
    if (coveredReqs === 0 && totalReqs > 0) {
      suggested.push({
        id: `suggested-no-evidence-${tenderId}`,
        type: "RISK",
        title: "Mandatory requirements have zero evidence coverage",
        description: `${totalReqs} requirement(s) have no linked evidence. Link experts, projects, or documents before generating the proposal.`,
        severity: "HIGH",
        status: "SUGGESTED",
        action: "SUGGESTED",
        createdAt: now,
        createdBy: null,
      });
    }

    // No submission plan
    if (!lifecycle.planStatus.hasExplicitPlan && lifecycle.planStatus.totalRequired === 0) {
      suggested.push({
        id: `suggested-no-plan-${tenderId}`,
        type: "TASK",
        title: "Build submission plan",
        description: "No explicit submission plan exists. Without a plan, generated documents cannot be validated against tender requirements.",
        severity: "MEDIUM",
        status: "SUGGESTED",
        action: "SUGGESTED",
        createdAt: now,
        createdBy: null,
      });
    }

    // Quality failed documents
    if (lifecycle.counts.qualityFailedCandidates > 0) {
      suggested.push({
        id: `suggested-quality-failed-${tenderId}`,
        type: "RISK",
        title: `${lifecycle.counts.qualityFailedCandidates} document(s) failed quality gate`,
        description: "Quality-failed documents cannot be included in the export package. Rewrite or replace them.",
        severity: "HIGH",
        status: "SUGGESTED",
        action: "SUGGESTED",
        createdAt: now,
        createdBy: null,
      });
    }

    return suggested;
  } catch {
    // Never block the main controls response if suggestion derivation fails
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
