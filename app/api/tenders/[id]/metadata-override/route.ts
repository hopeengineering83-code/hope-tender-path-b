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
import { resolveCanonicalFieldState, canonicalToClientChip } from "../../../../../lib/engine/canonical-field-state";
import { isCriticalField, canBeNotApplicable } from "../../../../../lib/engine/tender-policy-registry";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

function err(message: string, status = 400, code = "METADATA_OVERRIDE_ERROR") {
  return NextResponse.json({ ok: false, error: message, code }, { status });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  await prismaReady;
  const { id } = await params;

  const tender = await prisma.tender.findFirst({
    where: { id, userId: actor.id },
    select: {
      id: true, title: true, reference: true, clientName: true, procuringEntityName: true,
      deadline: true, currency: true, country: true, submissionMethod: true,
      submissionAddress: true, submissionEmails: true, submissionEmailSubject: true,
      clientContactName: true, clientContactEmail: true, clientContactTitle: true,
      clientContactPhone: true, clientCity: true, clientAddress: true, clientWebsite: true,
      clientRepresentative: true, legalClientName: true, donorAgency: true, implementingAgency: true,
      preBidChannel: true, preBidMeetingDate: true, preBidMeetingLocation: true,
      evaluationMethodology: true, metadataContaminated: true,
      clientNameSourcePage: true, clientNameSourceQuote: true, clientNameSourceFileId: true,
      titleSourcePage: true, titleSourceQuote: true, titleSourceFileId: true,
      deadlineSourcePage: true, deadlineSourceQuote: true, deadlineSourceFileId: true,
      submissionMethodSourcePage: true, submissionMethodSourceQuote: true, submissionMethodSourceFileId: true,
      submissionAddressSourcePage: true, submissionAddressSourceQuote: true, submissionAddressSourceFileId: true,
      submissionEmailSourcePage: true, submissionEmailSourceFileId: true, submissionEmailSourceQuote: true, contactDetailsSourceJson: true,
      requirements: { select: { id: true }, take: 1 },
      files: { where: { deletionStatus: "ACTIVE" }, select: { id: true } },
    },
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

  // Server-derived canonical field states — the SINGLE source of truth for the
  // Client & Submission Details panel chips. The panel renders these directly
  // instead of recomputing status from raw values client-side.
  let fieldStates: Record<string, {
    status: string; isGrounded: boolean; criticality: string;
    sourcePage: number | null; sourceQuote: string | null; value: string | null;
  }> = {};
  try {
    const pbDate = tender.preBidMeetingDate instanceof Date
      ? tender.preBidMeetingDate.toISOString().split("T")[0]
      : (tender.preBidMeetingDate ?? null);
    const resolved = resolveCanonicalFieldState({
      tender: {
        id: tender.id, title: tender.title, reference: tender.reference,
        clientName: tender.clientName, procuringEntityName: tender.procuringEntityName,
        deadline: tender.deadline ?? null, currency: tender.currency, country: tender.country,
        submissionMethod: tender.submissionMethod, submissionAddress: tender.submissionAddress,
        submissionEmails: tender.submissionEmails, submissionEmailSubject: tender.submissionEmailSubject,
        clientContactName: tender.clientContactName, clientContactEmail: tender.clientContactEmail,
        metadataContaminated: tender.metadataContaminated === true,
        clientNameSourcePage: tender.clientNameSourcePage ?? null,
        clientNameSourceQuote: tender.clientNameSourceQuote ?? null,
        clientNameSourceFileId: tender.clientNameSourceFileId ?? null,
        submissionMethodSourcePage: tender.submissionMethodSourcePage ?? null,
        submissionMethodSourceQuote: tender.submissionMethodSourceQuote ?? null,
        submissionMethodSourceFileId: tender.submissionMethodSourceFileId ?? null,
        submissionAddressSourcePage: tender.submissionAddressSourcePage ?? null,
        submissionAddressSourceQuote: tender.submissionAddressSourceQuote ?? null,
        submissionAddressSourceFileId: tender.submissionAddressSourceFileId ?? null,
        submissionEmailSourcePage: tender.submissionEmailSourcePage ?? null,
        submissionEmailSourceQuote: (tender as any).submissionEmailSourceQuote ?? null,
        submissionEmailSourceFileId: tender.submissionEmailSourceFileId ?? null,
        titleSourcePage: (tender as any).titleSourcePage ?? null,
        titleSourceQuote: (tender as any).titleSourceQuote ?? null,
        titleSourceFileId: (tender as any).titleSourceFileId ?? null,
        deadlineSourcePage: (tender as any).deadlineSourcePage ?? null,
        deadlineSourceQuote: (tender as any).deadlineSourceQuote ?? null,
        deadlineSourceFileId: (tender as any).deadlineSourceFileId ?? null,
        contactDetailsSourceJson: tender.contactDetailsSourceJson ?? null,
        evaluationMethodology: tender.evaluationMethodology ?? null,
        legalClientName: tender.legalClientName ?? null, donorAgency: tender.donorAgency ?? null,
        implementingAgency: tender.implementingAgency ?? null,
        clientContactTitle: tender.clientContactTitle ?? null,
        clientContactPhone: tender.clientContactPhone ?? null,
        clientCity: tender.clientCity ?? null, clientAddress: tender.clientAddress ?? null,
        clientWebsite: tender.clientWebsite ?? null, clientRepresentative: tender.clientRepresentative ?? null,
        preBidChannel: tender.preBidChannel ?? null, preBidMeetingDate: pbDate,
        preBidMeetingLocation: tender.preBidMeetingLocation ?? null,
      },
      overrides: overrides.map((o) => ({
        field: o.field, fieldState: o.fieldState, overrideValue: o.overrideValue ?? null,
        reason: o.reason ?? null, overriddenBy: o.overriddenBy ?? null, createdAt: o.createdAt ?? null,
      })),
      hasExtractedRequirements: tender.requirements.length > 0,
      submissionMethodContext: tender.submissionMethod ?? undefined,
      // Same canonical active-file grounding rule as the gates, so the dashboard
      // panel chips can never disagree with generation/export.
      activeTenderFileIds: new Set((tender.files ?? []).filter((f: any) => (f.deletionStatus ?? "ACTIVE") === "ACTIVE").map((f) => f.id)),
    });
    for (const f of resolved.fields) {
      fieldStates[f.fieldKey] = {
        status: canonicalToClientChip(f),
        isGrounded: f.isGrounded,
        criticality: f.criticality,
        sourcePage: f.sourcePage,
        sourceQuote: f.sourceQuote,
        value: f.effectiveValue,
      };
    }
  } catch {
    // Resolver is best-effort for the panel; on any failure the panel falls
    // back to its local rendering. Never block the overrides response.
    fieldStates = {};
  }

  return NextResponse.json({ ok: true, overrides, fieldStates });
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

  // Criticality is decided by the canonical policy registry — NOT a local list
  // (single source of truth). A field is critical here exactly when the
  // generation/export gates treat it as critical, including method-conditional
  // fields (submissionAddress for physical methods, submissionEmails for email).
  // This keeps the override API's N/A rejection in lock-step with the gates: a
  // user cannot mark `reference` N/A here while the gates treat it as N/A-able,
  // and cannot mark `submissionEmails` N/A on an email tender.
  const policyCtx = { submissionMethod: tenderData?.submissionMethod ?? null };
  const isAlwaysOrConditionallyCritical = (f: string): boolean =>
    !canBeNotApplicable(f) || isCriticalField(f, policyCtx);

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
    if (isAlwaysOrConditionallyCritical(field)) {
      return err(
        `Field "${field}" is critical for this tender and cannot be marked Not Applicable. Provide a value or confirm it.`,
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
    // For critical fields IGNORED_WITH_REASON is an audited absence that is
    // recorded but does NOT unblock generation/export — the canonical resolver
    // enforces that (it produces NOT_STATED with a blockerReason for critical
    // fields). No special handling needed here.
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
