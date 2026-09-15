import { logger } from "../../../../../lib/observability";
// Auto-approval for regex-fallback analysis.
//
// When all AI providers fail and the engine falls back to the regex
// analyzer, `lib/engine/analysis-source.ts` blocks final proposal
// generation by default. This endpoint records an audit-only human review;
// it never promotes fallback output into genuine AI authority.
//
// Endpoint:
//   POST /api/tenders/[id]/approve-analysis      { note?: string }
//     → records approval (idempotent)
//   DELETE /api/tenders/[id]/approve-analysis
//     → revokes approval (the next attempt will be blocked again)
//
// Storage: ComplianceGap row, severity="ADVISORY",
// title="ANALYSIS_APPROVAL:REGEX_FALLBACK", isResolved=true. Same
// pattern we use for donor advisory resolutions (no migration).
//
// Auth: ADMIN or PROPOSAL_MANAGER. REVIEWER and VIEWER are rejected.

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { logAction } from "../../../../../lib/audit";
import {
  ANALYSIS_APPROVAL_GAP_TITLE,
  approveRegexFallbackAnalysis,
  detectAnalysisSourceWithApproval,
  revokeRegexFallbackApproval,
} from "../../../../../lib/engine/analysis-source";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { resolveCurrentAnalysisBinding } from "../../../../../lib/engine/generation-readiness-gate";
import { recordFallbackApproval, revokeFallbackApprovals } from "../../../../../lib/engine/readiness-overrides";
import { extractRequestId } from "../../../../../lib/request-id";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

function err(message: string, status = 500, extra: Record<string, unknown> = {}) {
  const code = typeof extra.code === "string" ? extra.code : "ANALYSIS_APPROVAL_ERROR";
  return NextResponse.json({ ok: false, success: false, code, error: message, message, ...extra }, { status });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = extractRequestId(req);
  try {
    let actor;
    try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
    catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

    const rl = rateLimit(`approve-analysis:${actor.id}`, MUTATION_RATE_LIMIT);
    if (!rl.allowed) return NextResponse.json({ error: "Too many requests", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });

    await prismaReady;
    const { id } = await params;

    const tender = await prisma.tender.findFirst({ where: { id, userId: actor.id }, select: { id: true, notes: true } });
    if (!tender) return err("Tender not found", 404, { code: "TENDER_NOT_FOUND" });

    const body = await req.json().catch(() => ({}));
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : null;

    await approveRegexFallbackAnalysis(prisma, id, note);

    // Durable, auditable approval bound to the exact current analysis job and
    // content hash. The legacy ComplianceGap remains for backward compatibility,
    // but release gates trust only the bound record and still reject fallback
    // analysis as generation/export authority.
    const binding = await resolveCurrentAnalysisBinding(prisma, id, actor.id);
    if (binding.jobId && binding.contentHash) {
      await recordFallbackApproval(prisma, {
        tenderId: id,
        jobId: binding.jobId,
        contentHash: binding.contentHash,
        approverId: actor.id,
        reason: note ?? "Human-approved regex fallback",
        approvalRoute: "approve-analysis",
      });
    }

    const source = await detectAnalysisSourceWithApproval(prisma, id, tender);
    await logAction({
      userId: actor.id,
      action: "ANALYSIS_REGEX_FALLBACK_APPROVED",
      entityType: "Tender",
      entityId: id,
      description: `Human approved current regex-fallback analysis${note ? ` — ${note}` : ""}.`,
    });

    return NextResponse.json({
      success: true,
      approved: true,
      analysisSource: source,
      auditOnly: true,
      message: "Human approval recorded as AUDIT-ONLY. It does NOT authorize generation, export, download, regeneration, AI proposal, missing-file generation, or ZIP. Re-run AI Analyze with healthy providers to obtain a genuine AI analysis that authorizes release.",
    });
  } catch (error) {
    logger.error("approve-analysis POST failed", {
      requestId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return err("Approve-analysis failed.", 500, {
      code: "ANALYSIS_APPROVAL_RUNTIME_ERROR",
      requestId,
    });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = extractRequestId(req);
  try {
    let actor;
    try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
    catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }
    await prismaReady;
    const { id } = await params;
    const tender = await prisma.tender.findFirst({ where: { id, userId: actor.id }, select: { id: true } });
    if (!tender) return err("Tender not found", 404, { code: "TENDER_NOT_FOUND" });

    await revokeRegexFallbackApproval(prisma, id);
    await revokeFallbackApprovals(prisma, id);
    await logAction({
      userId: actor.id,
      action: "ANALYSIS_REGEX_FALLBACK_REVOKED",
      entityType: "Tender",
      entityId: id,
      description: "Human revoked prior approval of regex-fallback analysis.",
    });
    return NextResponse.json({ success: true, approved: false, gapTitle: ANALYSIS_APPROVAL_GAP_TITLE });
  } catch (error) {
    logger.error("approve-analysis DELETE failed", {
      requestId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return err("Revoke-approval failed.", 500, {
      code: "ANALYSIS_APPROVAL_RUNTIME_ERROR",
      requestId,
    });
  }
}
