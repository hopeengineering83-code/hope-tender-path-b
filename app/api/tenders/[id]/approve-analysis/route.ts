import { logger } from "../../../../../lib/observability";
// Human approval for a regex-fallback analysis.
//
// When all AI providers fail and the engine falls back to the regex
// analyzer, `lib/engine/analysis-source.ts` blocks final proposal
// generation by default — a senior engineer must explicitly confirm the
// fallback analysis captured the tender correctly before the final
// proposal can be generated.
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
// Auth: ADMIN, PROPOSAL_MANAGER, or REVIEWER. VIEWER is rejected.
// REVIEWER is included so that Recovery Command Center Execute buttons work
// for reviewer-role users — see tests/recovery-command-center-actions.test.ts.

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
import { sanitizeError } from "../../../../../lib/sanitize-error";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

function err(message: string, status = 500, extra: Record<string, unknown> = {}) {
  const code = typeof extra.code === "string" ? extra.code : "ANALYSIS_APPROVAL_ERROR";
  return NextResponse.json({ ok: false, success: false, code, error: message, message, ...extra }, { status });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    let actor;
    try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"); }
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
    const source = await detectAnalysisSourceWithApproval(prisma, id, tender);
    await logAction({
      userId: actor.id,
      action: "ANALYSIS_REGEX_FALLBACK_APPROVED",
      entityType: "Tender",
      entityId: id,
      description: `Human approved current regex-fallback analysis${note ? ` — ${note}` : ""}.`,
    });

    return NextResponse.json({ success: true, approved: true, analysisSource: source });
  } catch (error) {
    logger.error("approve-analysis POST failed", { detail: error });
    return err("Approve-analysis failed.", 500, { code: "ANALYSIS_APPROVAL_RUNTIME_ERROR", detail: sanitizeError(error) });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    let actor;
    try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"); }
    catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }
    await prismaReady;
    const { id } = await params;
    const tender = await prisma.tender.findFirst({ where: { id, userId: actor.id }, select: { id: true } });
    if (!tender) return err("Tender not found", 404, { code: "TENDER_NOT_FOUND" });

    await revokeRegexFallbackApproval(prisma, id);
    await logAction({
      userId: actor.id,
      action: "ANALYSIS_REGEX_FALLBACK_REVOKED",
      entityType: "Tender",
      entityId: id,
      description: "Human revoked prior approval of regex-fallback analysis.",
    });
    return NextResponse.json({ success: true, approved: false, gapTitle: ANALYSIS_APPROVAL_GAP_TITLE });
  } catch (error) {
    logger.error("approve-analysis DELETE failed", { detail: error });
    return err("Revoke-approval failed.", 500, { code: "ANALYSIS_APPROVAL_RUNTIME_ERROR", detail: sanitizeError(error) });
  }
}
