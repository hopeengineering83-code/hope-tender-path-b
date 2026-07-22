import { logger } from "../../../../../lib/observability";
// Persistent donor advisory resolution endpoint.
//
// Donor safeguard advisories are non-blocking by default. A user can mark
// them as resolved and that decision persists across readiness checks.
//
// Storage strategy: ComplianceGap rows namespaced as ADVISORY:<code>.

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { logAction } from "../../../../../lib/audit";
import { ADVISORY_GAP_PREFIX, buildAdvisoryGapTitle, parseAdvisoryGapTitle } from "../../../../../lib/engine/final-submission-readiness";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { extractRequestId } from "../../../../../lib/request-id";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const VALID_RESOLUTIONS = new Set([
  "NOT_REQUIRED_BY_TOR",
  "POST_AWARD_DELIVERABLE",
  "DONOR_TEMPLATE_PROVIDED",
  "ADDED_TO_TECHNICAL",
  "REOPEN",
]);

function jsonError(message: string, status = 500, extra: Record<string, unknown> = {}) {
  const code = typeof extra.code === "string" ? extra.code : "ADVISORY_RESOLUTION_ERROR";
  return NextResponse.json({ ok: false, success: false, code, error: message, message, ...extra }, { status });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = extractRequestId(req);
  try {
    let actor;
    try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
    catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }
    await prismaReady;
    const { id } = await params;

    const tender = await prisma.tender.findFirst({ where: { id, userId: actor.id }, select: { id: true } });
    if (!tender) return jsonError("Tender not found", 404, { code: "TENDER_NOT_FOUND" });

    const rows = await prisma.complianceGap.findMany({
      where: { tenderId: id, severity: "ADVISORY", title: { startsWith: ADVISORY_GAP_PREFIX } },
      select: { id: true, title: true, isResolved: true, resolvedNote: true, createdAt: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    });

    return NextResponse.json({
      success: true,
      resolutions: rows.map((row) => ({
        code: parseAdvisoryGapTitle(row.title),
        resolved: row.isResolved,
        resolution: row.resolvedNote,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    logger.error("advisory-resolutions GET failed", {
      requestId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return jsonError("Advisory resolution lookup failed.", 500, {
      code: "ADVISORY_RESOLUTION_RUNTIME_ERROR",
      requestId,
    });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = extractRequestId(req);
  try {
    let actor;
    try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
    catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

    const rl = rateLimit(`advisory-resolutions:${actor.id}`, MUTATION_RATE_LIMIT);
    if (!rl.allowed) return NextResponse.json({ error: "Too many requests", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });

    await prismaReady;
    const { id } = await params;

    const tender = await prisma.tender.findFirst({ where: { id, userId: actor.id }, select: { id: true } });
    if (!tender) return jsonError("Tender not found", 404, { code: "TENDER_NOT_FOUND" });

    const body = await req.json().catch(() => ({}));
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const resolution = typeof body.resolution === "string" ? body.resolution.trim().toUpperCase() : "";
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";

    if (!code) return jsonError("Missing required field: code (e.g. DONOR_ESMP_MISSING).", 400, { code: "MISSING_CODE" });
    if (!VALID_RESOLUTIONS.has(resolution)) {
      return jsonError(`Invalid resolution. Use one of: ${Array.from(VALID_RESOLUTIONS).join(", ")}.`, 400, { code: "INVALID_RESOLUTION" });
    }
    if (resolution !== "REOPEN" && note.length < 10) {
      return jsonError("A genuine reviewer note of at least 10 characters is required to resolve an advisory.", 400, { code: "REVIEWER_NOTE_REQUIRED" });
    }

    const title = buildAdvisoryGapTitle(code);
    const resolvedNote = note ? `${resolution} | ${note}` : resolution;
    const existing = await prisma.complianceGap.findFirst({
      where: { tenderId: id, severity: "ADVISORY", title },
      select: { id: true },
    });

    if (resolution === "REOPEN") {
      if (existing) await prisma.complianceGap.delete({ where: { id: existing.id } });
    } else if (existing) {
      await prisma.complianceGap.update({
        where: { id: existing.id },
        data: { isResolved: true, resolvedNote },
      });
    } else {
      await prisma.complianceGap.create({
        data: {
          tenderId: id,
          severity: "ADVISORY",
          title,
          description: `Donor advisory resolution for ${code} — recorded via Export Readiness panel.`,
          isResolved: true,
          resolvedNote,
        },
      });
    }

    await logAction({
      userId: actor.id,
      action: "ADVISORY_RESOLUTION",
      entityType: "Tender",
      entityId: id,
      description: `Advisory ${code} marked ${resolution}${note ? ` — ${note}` : ""}`,
    });

    return NextResponse.json({
      success: true,
      code,
      resolution,
      resolved: resolution !== "REOPEN",
    });
  } catch (error) {
    logger.error("advisory-resolutions POST failed", {
      requestId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return jsonError("Advisory resolution failed.", 500, {
      code: "ADVISORY_RESOLUTION_RUNTIME_ERROR",
      requestId,
    });
  }
}
