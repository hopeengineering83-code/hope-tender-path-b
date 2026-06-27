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

  let overrides;
  try {
    overrides = await prisma.tenderMetadataOverride.findMany({
      where: { tenderId: id },
      orderBy: { createdAt: "asc" },
    });
  } catch (lookupErr) {
    const code = (lookupErr as { code?: string })?.code;
    if (code === "P2021" || code === "P2010") {
      return NextResponse.json(
        { error: "Database migration required — TenderMetadataOverride table is not yet available.", code: "DB_MIGRATION_REQUIRED" },
        { status: 503 },
      );
    }
    throw lookupErr;
  }

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
  // NEVER trust client-supplied previousValue — compute it server-side.
  const previousValue = null; // Will be set from the existing override row below.

  // ─── SERVER-SIDE POLICY VALIDATION (P0) ──────────────────────────
  // The API must enforce policy. Hidden UI buttons are not security controls.

  // Load existing override to compute real prior value
  const existingOverride = await prisma.tenderMetadataOverride.findUnique({
    where: { tenderId_field: { tenderId: id, field } },
  }).catch(() => null);
  const realPriorValue = existingOverride?.overrideValue ?? null;

  // Load tender fields for validation context
  const tenderData = await prisma.tender.findFirst({
    where: { id, userId: actor.id },
    select: {
      id: true, title: true, reference: true, clientName: true,
      procuringEntityName: true, submissionMethod: true,
      submissionAddress: true, submissionEmails: true,
      deadline: true, submissionEmailSubject: true,
      bidBondAmount: true, bidBondCurrency: true,
    },
  });

  // Placeholder/generic value detection
  const PLACEHOLDER_PATTERNS = /^(n\/?a|na|tbd|tbc|nil|none|unknown|-|\.\.\.|bid[\s-]?team\s+to\s+confirm|to\s+be\s+(confirmed|determined|announced)|not\s+(available|specified|stated|determined))$/i;
  const GENERIC_LABEL_PATTERNS = /^(number|reference\s*(number)?|tender\s*(number|reference|title)?|title|client\s*name|date|deadline|address|email|subject|amount|currency|name|description|details|field|value)$/i;

  function isPlaceholderOrGeneric(value: string | null): boolean {
    if (!value) return true;
    const trimmed = value.trim();
    if (trimmed.length === 0) return true;
    if (PLACEHOLDER_PATTERNS.test(trimmed)) return true;
    if (GENERIC_LABEL_PATTERNS.test(trimmed)) return true;
    if (trimmed.length < 2) return true;
    return false;
  }

  // Always-critical fields that can NEVER be NOT_APPLICABLE
  const ALWAYS_CRITICAL_FIELDS = new Set([
    "clientName", "procuringEntityName", "title", "reference",
    "submissionMethod", "submissionEndpoint", "submissionEmails",
    "submissionAddress", "deadline", "requiredDocuments",
  ]);

  // ─── Validate by fieldState ──────────────────────────────────────
  if (fieldState === "USER_EDITED") {
    if (!overrideValue || isPlaceholderOrGeneric(overrideValue)) {
      return err(
        "Manual override value is empty, generic, or a placeholder. Provide a meaningful value.",
        400,
        "INVALID_OVERRIDE_VALUE",
      );
    }
    // Deadline-specific validation
    if (field === "deadline") {
      const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(overrideValue);
      const isoDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(overrideValue);
      if (!isoDate && !isoDateTime) {
        return err(
          "Deadline override must be YYYY-MM-DD or a complete ISO datetime with timezone.",
          400,
          "INVALID_DEADLINE_FORMAT",
        );
      }
      const parsed = new Date(overrideValue);
      if (isNaN(parsed.getTime())) {
        return err("Deadline override is not a valid date.", 400, "INVALID_DEADLINE");
      }
    }
    // Reference format validation
    if (field === "reference" && overrideValue.length < 3) {
      return err("Reference override is too short — must be a real tender reference.", 400, "INVALID_REFERENCE");
    }
  }

  if (fieldState === "USER_CONFIRMED") {
    // Confirmation requires a valid effective value
    const effectiveValue = overrideValue ?? tenderData?.[field as keyof typeof tenderData];
    const effectiveStr = effectiveValue instanceof Date
      ? effectiveValue.toISOString()
      : typeof effectiveValue === "string" ? effectiveValue : String(effectiveValue ?? "");
    if (!effectiveStr || isPlaceholderOrGeneric(effectiveStr)) {
      return err(
        "Cannot confirm an empty, generic, or placeholder value. Provide a valid value first.",
        400,
        "INVALID_CONFIRMATION_VALUE",
      );
    }
    // Require a meaningful audit reason for confirmation
    if (!reason || reason.trim().length < 5) {
      return err("Confirmation requires a meaningful audit reason (at least 5 characters).", 400, "REASON_REQUIRED");
    }
  }

  if (fieldState === "NOT_APPLICABLE") {
    if (ALWAYS_CRITICAL_FIELDS.has(field)) {
      return err(
        `Field "${field}" is always-critical and cannot be marked Not Applicable.`,
        400,
        "NOT_APPLICABLE_REJECTED",
      );
    }
    if (!reason || reason.trim().length < 5) {
      return err("Not Applicable requires a non-empty reason (at least 5 characters).", 400, "REASON_REQUIRED");
    }
  }

  if (fieldState === "IGNORED_WITH_REASON") {
    if (!reason || reason.trim().length < 5) {
      return err("Not stated / ignored requires a non-empty reason (at least 5 characters).", 400, "REASON_REQUIRED");
    }
    // For always-critical fields, this is an audited absence — does NOT unblock gates
    if (ALWAYS_CRITICAL_FIELDS.has(field)) {
      // Allow recording but it will not resolve the field for generation/export
      // The canonical resolver must enforce this.
    }
  }

  // ─── Required documents cannot be satisfied by a string override ───
  if (field === "requiredDocuments" && fieldState === "USER_EDITED") {
    return err(
      "Required documents cannot be satisfied by a metadata override. Use the requirement extraction or manual requirement entry flow.",
      400,
      "REQUIRED_DOCUMENTS_OVERRIDE_REJECTED",
    );
  }

  // Upsert: update if exists, create if not.
  // Guarded against P2021/P2010 in case the migration hasn't been applied yet.
  let upserted;
  try {
    upserted = await prisma.tenderMetadataOverride.upsert({
      where: { tenderId_field: { tenderId: id, field } },
      update: {
        fieldState,
        overrideValue,
        reason,
        // Use server-computed prior value, never client-supplied
        previousValue: realPriorValue,
        overriddenBy: actor.id,
        updatedAt: new Date(),
      },
      create: {
        tenderId: id,
        field,
        fieldState,
        overrideValue,
        reason,
        previousValue: realPriorValue,
        overriddenBy: actor.id,
      },
    });
  } catch (upsertErr) {
    const code = (upsertErr as { code?: string })?.code;
    if (code === "P2021" || code === "P2010") {
      return NextResponse.json(
        { error: "Database migration required — TenderMetadataOverride table is not yet available.", code: "DB_MIGRATION_REQUIRED" },
        { status: 503 },
      );
    }
    throw upsertErr;
  }

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
