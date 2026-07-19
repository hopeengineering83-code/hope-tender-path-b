// Tender Metadata Override endpoint.
import { logger } from "../../../../../lib/observability";
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
import { isCriticalField, canBeNotApplicable, type TenderPolicyContext } from "../../../../../lib/engine/tender-policy-registry";
import { enrichMetadataWithSourceEvidence } from "../../../../../lib/engine/metadata-source-enrichment";
import {
  isMeaningfulReason,
  isValidConfirmationBasis,
  isSubmissionCriticalField,
  isConditionallySubmissionCritical,
  MIN_CRITICAL_REASON_LENGTH,
  type HumanConfirmedAudit,
} from "../../../../../lib/engine/tender-fact-authority";
import {
  upsertTenderFactFromManualOverride,
  markTenderFactNotApplicable,
} from "../../../../../lib/engine/tender-facts-ledger-service";

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
      // Reference source evidence — dedicated columns read first by the
      // canonical resolver's getSourceEvidence for fieldKey="reference".
      referenceSourcePage: true, referenceSourceQuote: true, referenceSourceFileId: true,
      submissionMethodSourcePage: true, submissionMethodSourceQuote: true, submissionMethodSourceFileId: true,
      submissionAddressSourcePage: true, submissionAddressSourceQuote: true, submissionAddressSourceFileId: true,
      submissionEmailSourcePage: true, submissionEmailSourceFileId: true, submissionEmailSourceQuote: true, contactDetailsSourceJson: true,
      requirements: { select: { id: true }, take: 1 },
      // extractedText + totalPages let the resolver apply the FULL grounding
      // rule (quote containment + page bounds) — same as the gates.
      files: { where: { deletionStatus: "ACTIVE" }, select: { id: true, extractedText: true, totalPages: true } },
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
        // Forward reference source-evidence columns to the resolver so the
        // dedicated-column path in getSourceEvidence is taken (not just the
        // contactDetailsSourceJson fallback). Matches the strict BuildPlan
        // validator's view of the reference field.
        referenceSourcePage: (tender as any).referenceSourcePage ?? null,
        referenceSourceQuote: (tender as any).referenceSourceQuote ?? null,
        referenceSourceFileId: (tender as any).referenceSourceFileId ?? null,
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
      overrides: (overrides as any[]).map((o) => ({
        field: o.field, fieldState: o.fieldState, overrideValue: o.overrideValue ?? null,
        reason: o.reason ?? null, overriddenBy: o.overriddenBy ?? null, createdAt: o.createdAt ?? null,
      })),
      hasExtractedRequirements: tender.requirements.length > 0,
      submissionMethodContext: tender.submissionMethod ?? undefined,
      // Same canonical active-file grounding rule as the gates, so the dashboard
      // panel chips can never disagree with generation/export.
      activeTenderFileIds: new Set((tender.files ?? []).filter((f: any) => (f.deletionStatus ?? "ACTIVE") === "ACTIVE").map((f) => f.id)),
      // Full active-file rows enable the STRONGEST shared grounding check
      // (quote containment + page <= totalPages) — same rule as the gates.
      activeFiles: (tender.files ?? [])
        .filter((f: any) => (f.deletionStatus ?? "ACTIVE") === "ACTIVE")
        .map((f: any) => ({ id: f.id, extractedText: f.extractedText ?? null, totalPages: f.totalPages ?? null })),
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
    confirmationBasis?: string | null;
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
  // ─── Validate by fieldState ──────────────────────────────────────
  // Compute the policy context + submission-criticality for the authority model.
  // Use the EFFECTIVE submission method (override value if field is submissionMethod,
  // else the stored tender value) so conditional-criticality is correct.
  const effectiveSubmissionMethod = overrideValue && field === "submissionMethod"
    ? overrideValue
    : (tenderData?.submissionMethod ?? null);
  const policyCtx: TenderPolicyContext = {
    submissionMethod: effectiveSubmissionMethod,
    requiresEmailSubjectExplicitlyStated: false,
  };
  const isAlwaysOrConditionallyCritical = (f: string): boolean =>
    !canBeNotApplicable(f) || isCriticalField(f, policyCtx);
  const isAlwaysCritical = isSubmissionCriticalField(field);
  const isCondCritical = isConditionallySubmissionCritical(field, policyCtx);
  const isCriticalForAuthority = isAlwaysCritical || isCondCritical;

  if (fieldState === "USER_EDITED") {
    if (!overrideValue || isPlaceholderOrGeneric(overrideValue)) {
      return err(
        "Manual override value is empty, generic, or a placeholder. Provide a meaningful value.",
        400,
        "INVALID_OVERRIDE_VALUE",
      );
    }
    // Deadline-specific validation
    // Accept: ISO (YYYY-MM-DD), ISO datetime, long-form ("25 August 2026"),
    // DMY slash/dot/dash ("25/08/2026", "25.08.2026", "25-08-2026"),
    // and long-form with time ("25 August 2026, 5:00 PM EAT").
    // Ambiguous dates (05/06/2026) are accepted but flagged as AMBIGUOUS_DATE
    // by the canonical resolver.
    if (field === "deadline") {
      const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(overrideValue);
      const isoDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(overrideValue);
      const longForm = /^\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}(.*)$/i.test(overrideValue);
      const dmySlash = /^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}$/.test(overrideValue);
      const dmyDash = /^\d{1,2}-\d{1,2}-\d{4}$/.test(overrideValue);
      if (!isoDate && !isoDateTime && !longForm && !dmySlash && !dmyDash) {
        // Try native Date parsing as a last resort
        const nativeParsed = new Date(overrideValue);
        if (isNaN(nativeParsed.getTime())) {
          return err(
            "Deadline must be a valid date. Accepted formats: YYYY-MM-DD, 25 August 2026, 25/08/2026, 25.08.2026, or ISO datetime.",
            400,
            "INVALID_DEADLINE_FORMAT",
          );
        }
      }
      // Validate the date is parseable. For long-form, use the extraction
      // parser. For ISO, use native. For DMY, use the extraction parser.
      let parsed: Date;
      if (isoDate || isoDateTime) {
        parsed = new Date(overrideValue);
      } else {
        // Use the same parseDateValue helper the extraction pipeline uses
        const { parseDateValue } = await import("../../../../../lib/engine/tender-metadata");
        parsed = parseDateValue(overrideValue) ?? new Date(overrideValue);
      }
      if (isNaN(parsed.getTime())) {
        return err("Deadline override is not a valid date.", 400, "INVALID_DEADLINE");
      }
    }
    // Reference format validation
    if (field === "reference" && overrideValue.length < 3) {
      return err("Reference override is too short — must be a real tender reference.", 400, "INVALID_REFERENCE");
    }
    // ─── Authority model: audit reason + confirmation basis for critical fields ──
    // Submission-critical fields require a MEANINGFUL reason (not boilerplate)
    // + a confirmation basis when the value is manually entered. This satisfies
    // the mission's "audit reason and confirmation basis" requirement for
    // HUMAN_CONFIRMED_OPERATIONAL values on final-submission fields.
    if (isCriticalForAuthority) {
      if (!isMeaningfulReason(reason, MIN_CRITICAL_REASON_LENGTH)) {
        return err(
          `Manual entry on submission-critical field "${field}" requires a meaningful audit reason (at least ${MIN_CRITICAL_REASON_LENGTH} characters, not a boilerplate string).`,
          400,
          "MEANINGFUL_REASON_REQUIRED",
        );
      }
      const confirmationBasisRaw = typeof body.confirmationBasis === "string" ? body.confirmationBasis.trim() : null;
      if (!confirmationBasisRaw || !isValidConfirmationBasis(confirmationBasisRaw)) {
        return err(
          `Manual entry on submission-critical field "${field}" requires a confirmation basis (where you learned the value). Must be one of: PROCUREMENT_NOTICE, EMAIL_INVITATION, PORTAL_LISTING, PHONE_CALL_WITH_CLIENT, CLIENT_INSTRUCTION, PRE_BID_MEETING, CLARIFICATION_DOCUMENT, PRIOR_KNOWLEDGE_OF_CLIENT, PUBLIC_REGISTRY, OTHER_DOCUMENTED_SOURCE.`,
          400,
          "CONFIRMATION_BASIS_REQUIRED",
        );
      }
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
    if (!isMeaningfulReason(reason, isCriticalForAuthority ? MIN_CRITICAL_REASON_LENGTH : 5)) {
      return err(
        `Confirmation requires a meaningful audit reason (at least ${isCriticalForAuthority ? MIN_CRITICAL_REASON_LENGTH : 5} characters, not a boilerplate string).`,
        400,
        "REASON_REQUIRED",
      );
    }
    // ─── Authority model: confirmation basis for critical fields ──
    if (isCriticalForAuthority) {
      const confirmationBasisRaw = typeof body.confirmationBasis === "string" ? body.confirmationBasis.trim() : null;
      if (!confirmationBasisRaw || !isValidConfirmationBasis(confirmationBasisRaw)) {
        return err(
          `Confirmation of submission-critical field "${field}" requires a confirmation basis. Must be one of: PROCUREMENT_NOTICE, EMAIL_INVITATION, PORTAL_LISTING, PHONE_CALL_WITH_CLIENT, CLIENT_INSTRUCTION, PRE_BID_MEETING, CLARIFICATION_DOCUMENT, PRIOR_KNOWLEDGE_OF_CLIENT, PUBLIC_REGISTRY, OTHER_DOCUMENTED_SOURCE.`,
          400,
          "CONFIRMATION_BASIS_REQUIRED",
        );
      }
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

  // ─── Compute authority class + audit context ──────────────────────
  // The authority class is computed at write time using the same pure
  // classifier the resolver uses. For USER_EDITED/USER_CONFIRMED on
  // submission-critical fields, the audit (reason + confirmationBasis)
  // was already validated above. For other fieldStates the authority
  // is computed without audit.
  const confirmationBasisRaw = typeof body.confirmationBasis === "string" ? body.confirmationBasis.trim() : null;
  const confirmationBasis = confirmationBasisRaw && isValidConfirmationBasis(confirmationBasisRaw) ? confirmationBasisRaw : null;
  const confirmedAt = (fieldState === "USER_EDITED" || fieldState === "USER_CONFIRMED") ? new Date() : null;

  // Classify the authority (without source-grounding info — that's computed
  // by the canonical resolver at read time. Here we compute the WRITE-TIME
  // authority, which is HUMAN_CONFIRMED_OPERATIONAL for USER_EDITED/USER_CONFIRMED
  // without grounding, or NOT_STATED_IN_SOURCE for NOT_APPLICABLE/IGNORED_WITH_REASON).
  let authorityClass: string | null = null;
  if (fieldState === "USER_EDITED" || fieldState === "USER_CONFIRMED") {
    authorityClass = "HUMAN_CONFIRMED_OPERATIONAL";
  } else if (fieldState === "NOT_APPLICABLE" || fieldState === "IGNORED_WITH_REASON") {
    authorityClass = "NOT_STATED_IN_SOURCE";
  }

  const audit: HumanConfirmedAudit | null = authorityClass === "HUMAN_CONFIRMED_OPERATIONAL" && reason && confirmationBasis
    ? { reason, confirmationBasis: confirmationBasis as HumanConfirmedAudit["confirmationBasis"], confirmedBy: actor.id, confirmedAt: confirmedAt ?? new Date() }
    : null;

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
        // Authority model columns (additive — null on pre-migration DBs is fine)
        authorityClass,
        confirmationBasis,
        confirmedAt,
      },
      create: {
        tenderId: id,
        field,
        fieldState,
        overrideValue,
        reason,
        previousValue: realPriorValue,
        overriddenBy: actor.id,
        authorityClass,
        confirmationBasis,
        confirmedAt,
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

  // ─── TenderFactsLedger mutation (durable authority) ──────────────────────
  // The metadata-override route now writes to TenderFactsLedger as the
  // primary authority. The legacy TenderMetadataOverride row above is kept
  // for backward compatibility with existing readers, but the ledger is the
  // durable source of truth. Runtime resolvers (canonical-field-state) prefer
  // the ledger over scalar columns when both exist.
  //
  // Ledger mutations are best-effort: if the ledger table is not yet migrated,
  // the override still succeeds via the legacy path. The ledger mutation is
  // wrapped in try/catch so a ledger failure never blocks the override.
  try {
    const displayLabel = field; // The field key is used as the display label; UI resolves a human label separately
    const category = "procuring-entity"; // Default category; can be refined later
    const valueType = "TEXT";

    if (fieldState === "USER_EDITED" || fieldState === "USER_CONFIRMED") {
      // User confirmed or edited a value — write USER_CONFIRMED/USER_EDITED ledger fact
      if (overrideValue && reason && confirmationBasis) {
        await upsertTenderFactFromManualOverride(prisma, {
          tenderId: id,
          semanticKey: field,
          displayLabel,
          category,
          valueType,
          normalizedValue: overrideValue,
          reason,
          confirmationBasis,
          userId: actor.id,
          action: fieldState === "USER_EDITED" ? "USER_EDITED" : "USER_CONFIRMED",
        });
      }
    } else if (fieldState === "NOT_APPLICABLE") {
      // User marked as not applicable — write NOT_APPLICABLE ledger fact
      await markTenderFactNotApplicable(prisma, {
        tenderId: id,
        semanticKey: field,
        displayLabel,
        category,
        reason: reason ?? "Marked not applicable by user",
        userId: actor.id,
      });
    } else if (fieldState === "IGNORED_WITH_REASON") {
      // User ignored with reason — treat as NOT_APPLICABLE in the ledger
      // (the ledger doesn't have a separate IGNORED state; IGNORED is an
      // audited absence, which maps to NOT_APPLICABLE with a reason)
      await markTenderFactNotApplicable(prisma, {
        tenderId: id,
        semanticKey: field,
        displayLabel,
        category,
        reason: reason ?? "Ignored with reason by user",
        userId: actor.id,
      });
    }
    // MISSING fieldState is used for "retry on next AI Analyze" — no ledger
    // mutation needed; the fact will be re-extracted.
  } catch (ledgerErr) {
    // Ledger mutation failed — log but don't fail the override. The legacy
    // TenderMetadataOverride row is already written and is the fallback.
    logger.error("[metadata-override] ledger mutation failed (non-blocking)", { detail: ledgerErr instanceof Error ? ledgerErr.message : String(ledgerErr) });
  }

  // ─── Post-override source-evidence enrichment (INFORMATIONAL ONLY) ────────
  // The enrichment locates the effective value in an active tender file's
  // extracted text and persists the source-evidence columns (fileId + page +
  // quote) so the UI can DISPLAY where the value was found.
  //
  // IMPORTANT — authority model (mission rules D + E):
  //   - A manual value must NEVER automatically become source-grounded merely
  //     because it was entered (rule D). The override's authorityClass stays
  //     HUMAN_CONFIRMED_OPERATIONAL even when enrichment finds the value in
  //     the source. The canonical resolver will re-classify at read time.
  //   - A manual value must NEVER be discarded simply because the extractor
  //     cannot find it in the tender text (rule E). Enrichment failure does
  //     NOT clear the override.
  //   - The override value is NOT promoted into the tender scalar. The tender
  //     scalar is the EXTRACTOR's territory; the override is the USER's
  //     territory. They are kept separate so the audit trail is clear.
  //
  // The enrichment still runs (best-effort, non-fatal) so that source-
  // evidence columns are populated for the UI's "View source page & quote"
  // affordance. When enrichment finds the value, the canonical resolver at
  // read time will see the evidence and may classify the field as
  // SOURCE_GROUNDED (if the override value matches the evidence) — but the
  // override row itself retains its HUMAN_CONFIRMED_OPERATIONAL authority
  // and audit context.
  if (fieldState === "USER_CONFIRMED" || fieldState === "USER_EDITED") {
    try {
      const ENRICHMENT_FIELD_MAP: Record<string, "clientName" | "title" | "reference" | "deadline" | "submissionMethod" | "submissionAddress" | "submissionEmails" | "submissionEmailSubject"> = {
        clientName: "clientName",
        title: "title",
        reference: "reference",
        deadline: "deadline",
        submissionMethod: "submissionMethod",
        submissionAddress: "submissionAddress",
        submissionEmails: "submissionEmails",
        submissionEmailSubject: "submissionEmailSubject",
      };
      const enrichmentKey = ENRICHMENT_FIELD_MAP[field];
      if (enrichmentKey) {
        // Resolve the effective value: overrideValue if provided, else the
        // existing tender scalar (the USER_CONFIRMED-without-override case).
        const existingScalar = (tenderData as any)?.[field];
        let effectiveValue: string | Date | null = overrideValue ?? existingScalar ?? null;
        // Convert deadline strings to Date for the enrichment module.
        if (enrichmentKey === "deadline" && typeof effectiveValue === "string") {
          const d = new Date(effectiveValue);
          if (!isNaN(d.getTime())) effectiveValue = d;
          else effectiveValue = null;
        }
        if (effectiveValue) {
          const files = await prisma.tenderFile.findMany({
            where: { tenderId: id, deletionStatus: "ACTIVE" },
            select: { id: true, extractedText: true, totalPages: true, deletionStatus: true },
          });
          // Load existing contactDetailsSourceJson for the reference merge.
          const existingContactDetails = await prisma.tender.findUnique({
            where: { id },
            select: { contactDetailsSourceJson: true },
          });
          const enrichmentInput: Record<string, unknown> = {
            [enrichmentKey]: effectiveValue,
            existingContactDetailsSourceJson: existingContactDetails?.contactDetailsSourceJson ?? null,
          };
          const enrichment = enrichMetadataWithSourceEvidence(
            enrichmentInput as any,
            files.map((f) => ({
              id: f.id,
              extractedText: f.extractedText ?? "",
              totalPages: f.totalPages ?? null,
              deletionStatus: f.deletionStatus ?? "ACTIVE",
            })),
          );
          // Only update the source-evidence columns (NOT the tender scalar,
          // NOT the override). This is purely informational — the UI uses
          // these columns to show "Page N: 'quote'" when the user clicks
          // "View source page & quote".
          if (Object.keys(enrichment).length > 0) {
            await prisma.tender.update({ where: { id }, data: enrichment as Record<string, unknown> });
          }
        }
      }
    } catch {
      // Best-effort, non-fatal. The override itself already succeeded.
      // The override's authorityClass is already persisted; enrichment
      // failure does NOT clear it. The field stays HUMAN_CONFIRMED_OPERATIONAL.
    }
  }

  return NextResponse.json({ ok: true, override: upserted, authorityClass, audit });
}
