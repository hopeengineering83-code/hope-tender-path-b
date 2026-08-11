import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { logAction } from "../../../../../lib/audit";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../../lib/rate-limit";
import {
  auditLogToControlRecord,
  controlActionForType,
  controlDescription,
  controlSummary,
  normalizeTenderControlPayload,
} from "../../../../../lib/engine/tender-control-ledger";
import { computeTenderLifecycle } from "../../../../../lib/engine/tender-lifecycle-orchestrator";
import { deriveControlSuggestions, type SuggestedControl } from "../../../../../lib/engine/tender-control-suggestions";
import { classifyWeakMatches } from "../../../../../lib/engine/weak-match-classifier";
import { getCanonicalTenderWorkflowDecision } from "../../../../../lib/engine/canonical-workflow-decision";
import { presentTwoActionWorkflowDecision } from "../../../../../lib/engine/two-action-workflow-presentation";

export const dynamic = "force-dynamic";

async function deriveSuggestedControls(tenderId: string, userId?: string): Promise<SuggestedControl[]> {
  try {
    const lifecycle = await computeTenderLifecycle(prisma, tenderId, userId);
    if (!lifecycle) return [];
    const canonicalDecision = presentTwoActionWorkflowDecision(await getCanonicalTenderWorkflowDecision(prisma, userId ?? "", tenderId));
    const tenderForMatches = await prisma.tender.findFirst({
      where: { id: tenderId },
      select: {
        requirements: { select: { requirementType: true, description: true } },
        expertMatches: { take: 200, select: { id: true, score: true, isSelected: true, expert: { select: { fullName: true, trustLevel: true } } } },
        projectMatches: { take: 200, select: { id: true, score: true, isSelected: true, project: { select: { name: true, trustLevel: true } } } },
      },
    });
    const expertRequirementsCount = tenderForMatches?.requirements.filter((r) => r.requirementType === "EXPERT" || /technical|methodology|expertise/i.test(r.description ?? "")).length ?? 0;
    const projectRequirementsCount = tenderForMatches?.requirements.filter((r) => r.requirementType === "PROJECT_EXPERIENCE" || /similar\s+(project|experience|assignment)|past\s+performance|reference/i.test(r.description ?? "")).length ?? 0;
    const weakMatchReport = classifyWeakMatches({
      expertMatches: (tenderForMatches?.expertMatches ?? []).map((m) => ({ id: m.id, score: m.score, isSelected: m.isSelected, trustLevel: m.expert.trustLevel, label: m.expert.fullName })),
      projectMatches: (tenderForMatches?.projectMatches ?? []).map((m) => ({ id: m.id, score: m.score, isSelected: m.isSelected, trustLevel: m.project.trustLevel, label: m.project.name })),
      expertRequirementsCount,
      projectRequirementsCount,
    });
    const all = deriveControlSuggestions({
      canonicalDecision: canonicalDecision ? { nextRequiredAction: canonicalDecision.nextRequiredAction, nextRequiredActionLabel: canonicalDecision.nextRequiredActionLabel, nextRequiredActionReason: canonicalDecision.nextRequiredActionReason } : null,
      metadataStatus: lifecycle.metadataStatus,
      analysisStatus: lifecycle.analysisStatus,
      sourceReferenceStatus: lifecycle.sourceReferenceStatus,
      planStatus: lifecycle.planStatus,
      evidenceStatus: lifecycle.evidenceStatus,
      counts: lifecycle.counts,
      providerStatus: lifecycle.providerStatus,
      officialOriginalStatus: lifecycle.officialOriginalStatus,
      weakMatchReport,
    });
    const rejectedLogs = await prisma.auditLog.findMany({
      where: { entityType: "Tender", entityId: tenderId, action: "TENDER_CONTROL_SUGGESTION_REJECTED" },
      select: { metadata: true },
    });
    const rejectedCodes = new Set<string>();
    for (const row of rejectedLogs) {
      const raw = row.metadata;
      const parsed = typeof raw === "string" ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
      const code = parsed && typeof parsed === "object" && "suggestionCode" in (parsed as Record<string, unknown>) ? String((parsed as Record<string, unknown>).suggestionCode) : null;
      if (code) rejectedCodes.add(code);
    }
    return all.filter((s) => !rejectedCodes.has(s.code));
  } catch {
    return [];
  }
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
      select: { id: true, action: true, entityType: true, entityId: true, description: true, metadata: true, createdAt: true, userId: true },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
    deriveSuggestedControls(id, actor.id),
  ]);
  const records = logs.map(auditLogToControlRecord).filter((r): r is NonNullable<typeof r> => r !== null);
  const persistedSummary = controlSummary(records);
  const suggestedHighRisk = suggested.filter((s) => s.severity === "HIGH").length;
  const summary = {
    ...persistedSummary,
    // The dashboard summary now counts suggested controls separately in the
    // totals so the panel no longer shows "0 total / 0 high risk" while listing
    // several high-risk suggestions directly underneath.
    total: persistedSummary.total + suggested.length,
    open: persistedSummary.open + suggested.length,
    highRisk: persistedSummary.highRisk + suggestedHighRisk,
    suggested: suggested.length,
    persistedTotal: persistedSummary.total,
  };
  return NextResponse.json({ success: true, controls: records, suggestedControls: suggested, summary });
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
  } catch {
    return NextResponse.json({ error: "Invalid control payload" }, { status: 400 });
  }

  const tender = await prisma.tender.findFirst({ where: { id, userId: actor.id }, select: { id: true, title: true } });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  await logAction({
    userId: actor.id,
    action: controlActionForType(control.type),
    entityType: "Tender",
    entityId: id,
    description: controlDescription(actor.email, tender.title, control),
    metadata: { tenderId: id, control },
  });

  // Controls are audit/coordination records, never workflow eligibility authority.

  return NextResponse.json({ success: true, control });
}
