// GET /api/tenders/[id]/facts-ledger
// POST /api/tenders/[id]/facts-ledger
//
// TenderFactsLedger runtime authority endpoints.
//
// GET returns a sanitized snapshot of all ledger facts for a tender:
//   - semanticKey, displayLabel, normalizedValue, authorityState, confidence
//   - hasSourceEvidence, sourcePage, sourceQuotePreview (truncated)
//   - updatedAt
//   - summary counts (total, grounded, userConfirmed, userEdited, etc.)
//
// POST accepts 5 actions:
//   - confirm              → USER_CONFIRMED ledger fact
//   - edit                 → USER_EDITED ledger fact
//   - mark_not_applicable  → NOT_APPLICABLE ledger fact
//   - reject_invalid       → REJECTED_INVALID ledger fact
//   - supersede            → SUPERSEDED ledger fact
//
// Both endpoints enforce:
//   - Authentication (requireRole ADMIN, PROPOSAL_MANAGER, REVIEWER)
//   - RBAC (only ADMIN/PROPOSAL_MANAGER can POST; REVIEWER can only GET)
//   - Tenant ownership (tender must belong to the user's company)
//   - Audit logging (every POST logs the mutation)
//   - Idempotency (upsert by tenderId + semanticKey)
//   - Structured errors
//
// Neither endpoint exposes:
//   - Full source text, full file bytes, provider keys, prompts, or secrets
//   - Full source quotes (only a truncated preview ≤80 chars)

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import {
  getTenderFactLedgerSnapshot,
  upsertTenderFactFromManualOverride,
  markTenderFactNotApplicable,
  rejectInvalidTenderFact,
  supersedeTenderFact,
  AUTHORITY_STATE,
} from "../../../../../lib/engine/tender-facts-ledger-service";
import { logger } from "../../../../../lib/observability";

export const dynamic = "force-dynamic";

// ─── GET — sanitized read-only snapshot ──────────────────────────────────────

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER");
  } catch (e) {
    return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  await prismaReady;
  const { id: tenderId } = await params;

  // Tenant ownership check
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId: actor.id },
    select: { id: true },
  });
  if (!tender) {
    return NextResponse.json({ error: "Tender not found" }, { status: 404 });
  }

  try {
    const snapshot = await getTenderFactLedgerSnapshot(prisma, tenderId);

    // Sanitize: truncate source quotes to a preview (≤80 chars), never expose full text
    const sanitizedFacts = snapshot.facts.map((f) => ({
      semanticKey: f.semanticKey,
      displayLabel: f.displayLabel,
      normalizedValue: f.normalizedValue,
      authorityState: f.authorityState,
      confidence: f.confidence,
      relevance: f.relevance,
      hasSourceEvidence: f.hasSourceEvidence,
      sourcePage: f.sourcePage,
      sourceQuotePreview: f.sourceQuote
        ? (f.sourceQuote.length > 80 ? f.sourceQuote.slice(0, 77) + "..." : f.sourceQuote)
        : null,
      updatedAt: f.updatedAt.toISOString(),
    }));

    return NextResponse.json({
      ok: true,
      tenderId,
      facts: sanitizedFacts,
      summary: snapshot.summary,
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: "Failed to load facts ledger",
      tenderId,
      facts: [],
      summary: { total: 0, grounded: 0, userConfirmed: 0, userEdited: 0, notApplicable: 0, candidateNeedsReview: 0, rejectedInvalid: 0, missingFinalRequired: 0 },
    }, { status: 500 });
  }
}

// ─── POST — mutating actions ─────────────────────────────────────────────────

type LedgerPostAction = "confirm" | "edit" | "mark_not_applicable" | "reject_invalid" | "supersede";

type LedgerPostBody = {
  action: LedgerPostAction;
  semanticKey: string;
  displayLabel?: string;
  normalizedValue?: string;
  reason?: string;
  confirmationBasis?: string;
  category?: string;
  valueType?: string;
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // Only ADMIN and PROPOSAL_MANAGER can mutate the ledger
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (e) {
    return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  await prismaReady;
  const { id: tenderId } = await params;

  // Tenant ownership check
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId: actor.id },
    select: { id: true },
  });
  if (!tender) {
    return NextResponse.json({ error: "Tender not found" }, { status: 404 });
  }

  // Parse body
  const body = await req.json().catch(() => null) as LedgerPostBody | null;
  if (!body || !body.action || !body.semanticKey) {
    return NextResponse.json({
      error: "Missing required fields: action, semanticKey",
    }, { status: 400 });
  }

  const validActions: LedgerPostAction[] = ["confirm", "edit", "mark_not_applicable", "reject_invalid", "supersede"];
  if (!validActions.includes(body.action)) {
    return NextResponse.json({
      error: `Invalid action "${body.action}". Must be one of: ${validActions.join(", ")}`,
    }, { status: 400 });
  }

  const semanticKey = body.semanticKey.trim();
  const displayLabel = body.displayLabel?.trim() || semanticKey;
  const category = body.category?.trim() || "procuring-entity";
  const valueType = body.valueType?.trim() || "TEXT";

  try {
    switch (body.action) {
      case "confirm":
      case "edit": {
        // USER_CONFIRMED or USER_EDITED requires normalizedValue + reason + confirmationBasis
        if (!body.normalizedValue || !body.normalizedValue.trim()) {
          return NextResponse.json({ error: "normalizedValue is required for confirm/edit" }, { status: 400 });
        }
        if (!body.reason || body.reason.trim().length < 10) {
          return NextResponse.json({ error: "reason is required (at least 10 characters) for confirm/edit" }, { status: 400 });
        }
        if (!body.confirmationBasis || !body.confirmationBasis.trim()) {
          return NextResponse.json({ error: "confirmationBasis is required for confirm/edit" }, { status: 400 });
        }
        const result = await upsertTenderFactFromManualOverride(prisma, {
          tenderId,
          semanticKey,
          displayLabel,
          category,
          valueType,
          normalizedValue: body.normalizedValue.trim(),
          reason: body.reason.trim(),
          confirmationBasis: body.confirmationBasis.trim(),
          userId: actor.id,
          action: body.action === "edit" ? "USER_EDITED" : "USER_CONFIRMED",
        });
        return NextResponse.json({
          ok: true,
          action: body.action,
          semanticKey,
          authorityState: result.authorityState,
          updatedAt: result.updatedAt.toISOString(),
        });
      }

      case "mark_not_applicable": {
        if (!body.reason || body.reason.trim().length < 5) {
          return NextResponse.json({ error: "reason is required (at least 5 characters) for mark_not_applicable" }, { status: 400 });
        }
        const result = await markTenderFactNotApplicable(prisma, {
          tenderId,
          semanticKey,
          displayLabel,
          category,
          reason: body.reason.trim(),
          userId: actor.id,
        });
        return NextResponse.json({
          ok: true,
          action: body.action,
          semanticKey,
          authorityState: result.authorityState,
          updatedAt: result.updatedAt.toISOString(),
        });
      }

      case "reject_invalid": {
        if (!body.reason || body.reason.trim().length < 5) {
          return NextResponse.json({ error: "reason is required (at least 5 characters) for reject_invalid" }, { status: 400 });
        }
        const result = await rejectInvalidTenderFact(prisma, {
          tenderId,
          semanticKey,
          displayLabel,
          category,
          reason: body.reason.trim(),
          userId: actor.id,
        });
        return NextResponse.json({
          ok: true,
          action: body.action,
          semanticKey,
          authorityState: result.authorityState,
          updatedAt: result.updatedAt.toISOString(),
        });
      }

      case "supersede": {
        if (!body.reason || body.reason.trim().length < 5) {
          return NextResponse.json({ error: "reason is required (at least 5 characters) for supersede" }, { status: 400 });
        }
        const result = await supersedeTenderFact(prisma, {
          tenderId,
          semanticKey,
          reason: body.reason.trim(),
          userId: actor.id,
        });
        return NextResponse.json({
          ok: true,
          action: body.action,
          semanticKey,
          supersededCount: result.supersededCount,
        });
      }

      default:
        return NextResponse.json({ error: "Unhandled action" }, { status: 400 });
    }
  } catch (err) {
    const diagnosticId = randomUUID();
    logger.error("[facts-ledger:POST]", {
      tenderId,
      action: body.action,
      semanticKey,
      diagnosticId,
      errorClass: err instanceof Error ? err.constructor.name : "UnknownError",
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({
      ok: false,
      error: "Facts ledger update failed.",
      action: body.action,
      semanticKey,
      diagnosticId,
    }, { status: 500 });
  }
}
