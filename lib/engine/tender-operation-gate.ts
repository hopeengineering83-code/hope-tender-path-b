// lib/engine/tender-operation-gate.ts
//
// Operation-aware tender gate resolver. Replaces the rigid combined
// final-export gate with a per-operation gate that applies only the
// rules relevant to each operation.
//
// Operations:
//   ANALYSIS                 — AI Analyze / Run Engine (never blocked by metadata)
//   DRAFT_GENERATION         — Generate draft proposal (never blocked by optional metadata)
//   SUPPORT_PACKAGE_GENERATION — Generate support/missing-plan files (never blocked by optional metadata)
//   REVIEW_EXPORT            — Export for review (never blocked by optional metadata)
//   FINAL_SUBMISSION_READY   — Final ZIP submission (strict: all required facts grounded, BuildPlan confirmed)
//
// Key rules:
//   • Missing optional metadata NEVER blocks analysis, draft, support, or review.
//   • Optional placeholders (TBD, N/A, Unknown, Not specified, Bid-Team to confirm)
//     become warnings and are omitted from generated output. They do NOT block.
//   • Missing deadline or extracted requirements allows draft/support/review
//     but blocks FINAL_SUBMISSION_READY.
//   • Portal tender: portal URL is a valid endpoint; no email/address required.
//   • Email tender: email required only when email is required.
//   • Physical tender: address required only when physical delivery is required.
//   • Hybrid tender: only endpoints explicitly required.
//   • Anonymous tender: client identity, branding, signature, stamp cannot block
//     where tender/template rules prohibit them.
//   • Final submission remains strict: source-grounded or authorized human-confirmed
//     required facts, confirmed BuildPlan, exact filenames/formats, byte/signature
//     validation, tenant isolation, RBAC.

import { normalizeSubmissionMethod } from "./submission-method-policy";
import { containsMetadataPlaceholder } from "./metadata-validators";
import { MIN_CRITICAL_REASON_LENGTH } from "./tender-fact-authority";

export type TenderOperation =
  | "ANALYSIS"
  | "DRAFT_GENERATION"
  | "SUPPORT_PACKAGE_GENERATION"
  | "REVIEW_EXPORT"
  | "FINAL_SUBMISSION_READY";

export type OperationGateInput = {
  tender: {
    id: string;
    title: string | null;
    reference: string | null;
    clientName: string | null;
    deadline: Date | null;
    submissionMethod: string | null;
    submissionEmails: string | null;
    submissionAddress: string | null;
    country: string | null;
    metadataContaminated: boolean | null;
    analysisExtractionStatus: string | null;
    [key: string]: unknown;
  };
  requirements?: Array<{ priority?: string | null; sourceTenderFileId?: string | null }>;
  overrides?: Array<{
    field: string;
    fieldState: string;
    overrideValue?: string | null;
    /** Audit reason — required for USER_CONFIRMED/USER_EDITED on critical fields */
    reason?: string | null;
    /** Confirmation basis — required for USER_CONFIRMED/USER_EDITED on critical fields */
    confirmationBasis?: string | null;
  }>;
  buildPlan?: { ok: boolean; items?: unknown[] } | null;
  operation: TenderOperation;
};

export type OperationGateResult = {
  ok: boolean;
  operation: TenderOperation;
  blockers: string[];
  warnings: string[];
  placeholderFields: string[];
};

// Fields that are optional and NEVER block non-final operations
const OPTIONAL_FIELDS = [
  "reference", "country", "clientContactName", "clientContactEmail",
  "clientContactPhone", "clientAddress", "clientCity", "clientWebsite",
  "preBidMeetingDate", "preBidMeetingLocation", "bidBondAmount",
  "pageLimit", "validityDays", "mandatorySiteVisit", "numberOfCopiesRequired",
  "evaluationMethodology", "budget", "category",
];

// Fields that are critical for FINAL_SUBMISSION_READY
const CRITICAL_FINAL_FIELDS = ["title", "clientName", "deadline", "submissionMethod"];

// Placeholder values that become warnings, not blockers
const PLACEHOLDER_VALUES = new Set([
  "tbd", "n/a", "unknown", "not specified", "not provided",
  "bid-team to confirm", "to be determined", "to be confirmed",
  "pending", "placeholder", "",
]);

function isPlaceholder(value: string | null | undefined): boolean {
  if (!value) return false;
  const lower = value.trim().toLowerCase();
  return PLACEHOLDER_VALUES.has(lower) || containsMetadataPlaceholder(value);
}

// A resolving override must actually supply a value via USER_CONFIRMED/USER_EDITED.
// IGNORED_WITH_REASON and NOT_APPLICABLE are audited absences, not values, and must
// never satisfy a submission-endpoint requirement (matches canonical-field-state.ts,
// which keeps critical fields BLOCKED under IGNORED_WITH_REASON/NOT_APPLICABLE).
function hasOverride(overrides: OperationGateInput["overrides"], field: string): boolean {
  return !!(
    overrides &&
    overrides.some(
      (o) =>
        o.field === field &&
        (o.fieldState === "USER_CONFIRMED" || o.fieldState === "USER_EDITED") &&
        !!o.overrideValue &&
        o.overrideValue.trim().length > 0
    )
  );
}

function getOverrideValue(overrides: OperationGateInput["overrides"], field: string): string | null {
  const ov = overrides?.find((o) => o.field === field);
  return ov?.overrideValue ?? null;
}

export function resolveTenderOperationGate(input: OperationGateInput): OperationGateResult {
  const { tender, requirements = [], overrides = [], buildPlan, operation } = input;
  const blockers: string[] = [];
  const warnings: string[] = [];
  const placeholderFields: string[] = [];

  // ── Contamination check (applies to all operations) ──────────────
  if (tender.metadataContaminated) {
    if (operation === "FINAL_SUBMISSION_READY") {
      blockers.push("Tender metadata is contaminated — repair the client name / procuring entity before final submission.");
    } else {
      warnings.push("Tender metadata is contaminated — repair before final submission.");
    }
  }

  // ── Analysis extraction status (applies to all operations) ───────
  const extractionStatus = tender.analysisExtractionStatus ?? null;
  if (extractionStatus === "OCR_REQUIRED") {
    if (operation === "FINAL_SUBMISSION_READY") {
      blockers.push("Extraction was corrupted and AI Analyze was skipped — upload a clearer, text-based copy before final submission.");
    } else {
      warnings.push("Extraction was corrupted — AI Analyze was skipped. Upload a clearer, text-based copy for better results.");
    }
  } else if (extractionStatus === "REGEX_FALLBACK_FROM_WEAK_EXTRACTION") {
    if (operation === "FINAL_SUBMISSION_READY") {
      blockers.push("Analysis fell back to regex from weak extraction — re-run AI Analyze before final submission.");
    } else {
      warnings.push("Analysis used regex fallback — re-run AI Analyze for better results.");
    }
  }

  // ── Detect placeholders in optional fields → warnings, not blockers ──
  for (const field of OPTIONAL_FIELDS) {
    const value = (tender as Record<string, unknown>)[field];
    if (typeof value === "string" && isPlaceholder(value)) {
      placeholderFields.push(field);
      warnings.push(`Optional field "${field}" contains a placeholder value — it will be omitted from generated output.`);
    }
  }

  // ── For non-final operations, we're done — no metadata blockers ──
  if (operation !== "FINAL_SUBMISSION_READY") {
    return { ok: blockers.length === 0, operation, blockers, warnings, placeholderFields };
  }

  // ═══════════════════════════════════════════════════════════════════
  // FINAL_SUBMISSION_READY — strict gate
  // ═══════════════════════════════════════════════════════════════════

  // ── 1. Critical fields must be present and non-placeholder ───────
  // For USER_CONFIRMED / USER_EDITED overrides, also require audit
  // sufficiency (reason + confirmationBasis) — matches the authority
  // model in canonical-field-state.ts. Without this check, a user could
  // mark a missing clientName as "confirmed" with no audit trail and
  // bypass the final-submission gate.
  for (const field of CRITICAL_FINAL_FIELDS) {
    const rawValue = (tender as Record<string, unknown>)[field] as string | null;
    const override = overrides?.find((o) => o.field === field);
    const hasResolvingOverride = !!(override && override.fieldState !== "NOT_APPLICABLE");
    const effectiveValue = hasResolvingOverride ? (override?.overrideValue ?? rawValue) : rawValue;
    if (!effectiveValue || (typeof effectiveValue === "string" && isPlaceholder(effectiveValue))) {
      blockers.push(`Critical field "${field}" is missing or contains a placeholder — final submission requires a real value.`);
      continue;
    }
    // Audit sufficiency for manual overrides on critical fields
    if (override && (override.fieldState === "USER_CONFIRMED" || override.fieldState === "USER_EDITED")) {
      const hasReason = !!(override.reason && override.reason.trim().length >= MIN_CRITICAL_REASON_LENGTH);
      const hasConfirmationBasis = !!(override.confirmationBasis && override.confirmationBasis.trim());
      if (!hasReason || !hasConfirmationBasis) {
        blockers.push(`Critical field "${field}" has a manual override but the audit is incomplete — final submission requires both a meaningful reason and a confirmation basis.`);
      }
    }
  }

  // ── 2. Requirements must be extracted ────────────────────────────
  if (requirements.length === 0) {
    blockers.push("No extracted requirements — run AI Analyze before final submission.");
  }

  // ── 3. Confirmed BuildPlan required ──────────────────────────────
  if (!buildPlan || !buildPlan.ok) {
    blockers.push("No current source-verified Build Plan — Run Engine creates and verifies it automatically before final submission processing.");
  }

  // ── 4. Submission endpoint validation (operation-specific) ───────
  const submissionMethod = tender.submissionMethod ?? null;
  const normalized = normalizeSubmissionMethod(submissionMethod);
  const submissionEmails = tender.submissionEmails ?? null;
  const submissionAddress = tender.submissionAddress ?? null;

  if (normalized === "EMAIL") {
    // Email tender: require email only when email is required
    if (!submissionEmails && !hasOverride(overrides, "submissionEmails")) {
      blockers.push("Email submission method requires at least one submission email endpoint.");
    }
  } else if (normalized === "PHYSICAL") {
    // Physical tender: require address only when physical delivery is required
    if (!submissionAddress && !hasOverride(overrides, "submissionAddress")) {
      blockers.push("Physical submission method requires a submission address endpoint.");
    }
  } else if (normalized === "PORTAL") {
    // Portal tender: portal URL is a valid endpoint — no email/address required
    // The portal URL is stored in submissionAddress or a dedicated field.
    // If neither is present, warn (don't block — the portal URL may be in the tender text).
    if (!submissionAddress && !submissionEmails) {
      warnings.push("Portal submission method — verify the portal URL is available in the tender source.");
    }
  } else if (normalized === "HYBRID") {
    // Hybrid tender: require only endpoints explicitly required
    // Check that at least one endpoint is present, honoring a resolving
    // override on either endpoint (consistent with the EMAIL/PHYSICAL checks above).
    if (
      !submissionEmails &&
      !submissionAddress &&
      !hasOverride(overrides, "submissionEmails") &&
      !hasOverride(overrides, "submissionAddress")
    ) {
      blockers.push("Hybrid submission method requires at least one submission endpoint (email or address).");
    }
  } else {
    // UNKNOWN submission method — warn, don't block (the tender may not specify a method)
    warnings.push("Submission method is unknown — verify the tender specifies how to submit.");
  }

  return { ok: blockers.length === 0, operation, blockers, warnings, placeholderFields };
}
