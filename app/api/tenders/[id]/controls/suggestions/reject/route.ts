// POST /api/tenders/[id]/controls/suggestions/reject
//
// Records the user's decision to dismiss a suggested control derived from
// lifecycle state. Suggestions are NOT stored as rows — they're computed
// from current state on every GET — so "rejecting" one means writing a
// TENDER_CONTROL_SUGGESTION_REJECTED audit entry. The GET endpoint reads
// those audit entries and hides the matching suggestion code on subsequent
// loads.
//
// Hard safety:
//   • only ADMIN / PROPOSAL_MANAGER can reject suggestions,
//   • the suggestion code must be a known ControlSuggestionCode,
//   • the audit log carries the code + a short optional note so reviewers
//     can see WHY a suggestion was dismissed.

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../../lib/prisma";
import { logAction } from "../../../../../../../lib/audit";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../../../../lib/rate-limit";
import { extractRequestId } from "../../../../../../../lib/request-id";

export const dynamic = "force-dynamic";

const KNOWN_CODES = new Set([
  "METADATA_INCOMPLETE",
  "REGEX_FALLBACK_UNAPPROVED",
  "SOURCE_REFS_MISSING",
  "MANDATORY_COVERAGE_ZERO",
  "OUTSIDE_PLAN_DOCS",
  "PLANNED_DOCS_NOT_GENERATED",
  "NO_ACTIVE_EXPORT_CANDIDATES",
  "AI_PROVIDERS_COOLING",
  "AI_PROVIDERS_NOT_CONFIGURED",
  "MISSING_OFFICIAL_ORIGINALS",
  "QUALITY_FAILED_DOCS",
  "SUBMISSION_PLAN_NOT_BUILT",
  // I — weak-match feeds
  "WEAK_EXPERT_COVERAGE",
  "WEAK_PROJECT_COVERAGE",
  "JV_MITIGATION_NEEDED_EXPERTS",
  "JV_MITIGATION_NEEDED_PROJECTS",
]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  const requestId = extractRequestId(req);
  const rl = rateLimit(`controls-suggestion-reject:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.ceil((rl.resetAt - Date.now()) / 1000);
    return NextResponse.json({ error: "Rate limit exceeded. Wait and retry.", retryAfter }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }

  await prismaReady;
  const { id: tenderId } = await params;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const code = String((body as { code?: unknown }).code ?? "").trim().toUpperCase();
  if (!KNOWN_CODES.has(code)) {
    return NextResponse.json({ error: "Unknown suggestion code", code: "INVALID_SUGGESTION_CODE" }, { status: 400 });
  }
  const rawNote = typeof (body as { note?: unknown }).note === "string" ? (body as { note: string }).note.trim() : "";
  const note = rawNote.slice(0, 300);

  // Authorization: owner-scoped by default. Only ADMIN can fall back to the
  // unscoped lookup (mirrors proposal-versions/[versionId]/route.ts pattern).
  // PROPOSAL_MANAGER is restricted to their own tenders.
  const ownerTender = await prisma.tender.findFirst({ where: { id: tenderId, userId: actor.id }, select: { id: true, title: true } });
  let tender = ownerTender;
  if (!tender && actor.role === "ADMIN") {
    tender = await prisma.tender.findFirst({ where: { id: tenderId }, select: { id: true, title: true } });
  }
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  await logAction({
    userId: actor.id,
    action: "TENDER_CONTROL_SUGGESTION_REJECTED",
    entityType: "Tender",
    entityId: tenderId,
    description: `${actor.email} dismissed suggested control ${code}${note ? `: ${note}` : ""}`.slice(0, 500),
    metadata: { tenderId, suggestionCode: code, note: note || null },
    requestId,
  });

  return NextResponse.json({ success: true, dismissed: code });
}
