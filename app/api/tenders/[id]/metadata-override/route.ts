// Tender Metadata Override endpoint.
//
// GET: Return all TenderMetadataOverride rows for a tender.
// POST: Upsert a TenderMetadataOverride for a specific field.
//
// Allows users to mark missing metadata fields as NOT_APPLICABLE,
// USER_CONFIRMED, USER_EDITED, or IGNORED_WITH_REASON so the generation
// gate can proceed without hard-blocking on genuinely absent metadata
// that the user has reviewed and confirmed.
//
// Auth: ADMIN / PROPOSAL_MANAGER.

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { logAction } from "../../../../../lib/audit";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { VALID_FIELD_STATES, KNOWN_METADATA_FIELDS, type MetadataFieldState } from "../../../../../lib/engine/metadata-override";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

function err(message: string, status = 400, code = "METADATA_OVERRIDE_ERROR") {
  return NextResponse.json({ ok: false, error: message, code }, { status });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  await prismaReady;
  const { id } = await params;

  const tender = await prisma.tender.findFirst({
    where: { id, userId: actor.id },
    select: { id: true },
  });
  if (!tender) return err("Tender not found", 404, "TENDER_NOT_FOUND");

  const overrides = await prisma.tenderMetadataOverride.findMany({
    where: { tenderId: id },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ ok: true, overrides });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  const rl = rateLimit(`metadata-override:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "Rate limit exceeded — too many override requests.", code: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    );
  }

  await prismaReady;
  const { id } = await params;

  type Body = {
    field?: string;
    fieldState?: string;
    overrideValue?: string | null;
    reason?: string | null;
    previousValue?: string | null;
  };
  const body = await req.json().catch(() => ({})) as Body;

  if (!body.field || typeof body.field !== "string") {
    return err("field is required", 400, "FIELD_REQUIRED");
  }
  if (!body.fieldState || typeof body.fieldState !== "string") {
    return err("fieldState is required", 400, "FIELD_STATE_REQUIRED");
  }

  const fieldState = body.fieldState.trim() as MetadataFieldState;
  if (!VALID_FIELD_STATES.includes(fieldState)) {
    return err(
      `Invalid fieldState "${fieldState}". Must be one of: ${VALID_FIELD_STATES.join(", ")}`,
      400,
      "INVALID_FIELD_STATE",
    );
  }

  const field = body.field.trim();
  if (!KNOWN_METADATA_FIELDS.has(field)) {
    return err(
      `Unknown metadata field "${field}". Must be a recognised tender metadata field name.`,
      400,
      "UNKNOWN_FIELD",
    );
  }

  const tender = await prisma.tender.findFirst({
    where: { id, userId: actor.id },
    select: { id: true },
  });
  if (!tender) return err("Tender not found", 404, "TENDER_NOT_FOUND");

  const overrideValue = typeof body.overrideValue === "string" ? body.overrideValue.trim() || null : null;
  const reason = typeof body.reason === "string" ? body.reason.trim() || null : null;
  const previousValue = typeof body.previousValue === "string" ? body.previousValue.trim() || null : null;

  // Upsert: update if exists, create if not.
  const upserted = await prisma.tenderMetadataOverride.upsert({
    where: { tenderId_field: { tenderId: id, field } },
    update: {
      fieldState,
      overrideValue,
      reason,
      previousValue,
      overriddenBy: actor.id,
      updatedAt: new Date(),
    },
    create: {
      tenderId: id,
      field,
      fieldState,
      overrideValue,
      reason,
      previousValue,
      overriddenBy: actor.id,
    },
  });

  await logAction({
    userId: actor.id,
    action: "TENDER_METADATA_OVERRIDE",
    entityType: "Tender",
    entityId: id,
    description: `Metadata field "${field}" set to ${fieldState}${reason ? `: ${reason}` : ""}`,
    metadata: { field, fieldState, overrideValue, reason, overrideId: upserted.id },
  });

  return NextResponse.json({ ok: true, override: upserted });
}
