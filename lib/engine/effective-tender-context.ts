/**
 * Effective Tender Context Resolver
 *
 * The single server-side function that merges:
 * - source-grounded facts (from TenderFactsLedger);
 * - human-confirmed operational facts (from TenderMetadataOverride);
 * - tender requirements;
 * - document rules;
 * - submission facts (normalized method, effective endpoints);
 * - effective deadlines;
 * - company matching context.
 *
 * All downstream consumers MUST use this one context view:
 * - UI panels;
 * - readiness gates;
 * - BuildPlan builder;
 * - document generation;
 * - cover letters;
 * - document headers;
 * - filenames;
 * - proposal titles;
 * - submission instructions;
 * - final ZIP manifest.
 *
 * This function does NOT write to the database. It returns a read-only
 * merged view that consumers use for rendering and decision-making.
 */

import type { TenderMetadataOverride } from "@prisma/client";
import { normalizeSubmissionMethod, type NormalizedSubmissionMethod } from "./submission-method-policy";
import { resolveEffectiveTenderFacts, type EffectiveTenderFacts } from "./effective-tender-facts";

// ─── Types ──────────────────────────────────────────────────────────────────

export type TenderFactCategory =
  | "tender-identity" | "procuring-entity" | "submission" | "financial"
  | "eligibility" | "technical" | "personnel" | "experience" | "evaluation"
  | "document-requirement" | "annex" | "contract" | "site-location" | "pre-bid"
  | "procurement-process" | "legal-compliance" | "custom";

export type TenderFactAuthorityState =
  | "SOURCE_GROUNDED_CONFIRMED"
  | "SOURCE_GROUNDED_UNUSUAL_FORMAT"
  | "HUMAN_CONFIRMED_OPERATIONAL"
  | "CANDIDATE_NEEDS_REVIEW"
  | "NOT_STATED_IN_SOURCE"
  | "CONDITIONAL_OR_UNSCHEDULED"
  | "REJECTED_EXTRACTION";

export type TenderFactValueType =
  | "TEXT" | "LONG_TEXT" | "DATE" | "DATETIME" | "EMAIL_LIST" | "URL"
  | "ADDRESS" | "MONEY" | "NUMBER" | "BOOLEAN" | "ENUM" | "LIST" | "JSON"
  | "DOCUMENT_RULE" | "CONDITIONAL_NOTE";

export type EffectiveTenderContext = {
  /** The effective tender facts (merged source-grounded + overrides). */
  facts: EffectiveTenderFacts;
  /** The normalized submission method. */
  normalizedSubmissionMethod: NormalizedSubmissionMethod;
  /** The effective submission method value. */
  effectiveSubmissionMethod: string | null;
  /** The effective deadline (as a Date if parseable). */
  effectiveDeadline: Date | null;
  /** The effective client name. */
  effectiveClientName: string | null;
  /** The effective title. */
  effectiveTitle: string | null;
  /** The effective reference number. */
  effectiveReference: string | null;
  /** The effective submission emails (as an array, split on pipe). */
  effectiveSubmissionEmails: string[];
  /** The effective submission address. */
  effectiveSubmissionAddress: string | null;
  /** The effective submission email subject. */
  effectiveSubmissionEmailSubject: string | null;
  /** Whether the tender has extracted requirements. */
  hasRequirements: boolean;
  /** The number of requirements. */
  requirementCount: number;
  /** The number of mandatory requirements. */
  mandatoryRequirementCount: number;
  /** The number of source-grounded requirements. */
  groundedRequirementCount: number;
  /** The facts ledger entries (if loaded). */
  ledgerFacts: TenderFactsLedgerEntry[];
  /** The snapshot revision (for UI consistency). */
  snapshotRevision: string | null;
};

export type TenderFactsLedgerEntry = {
  id: string;
  semanticKey: string;
  displayLabel: string;
  category: TenderFactCategory;
  valueType: TenderFactValueType;
  normalizedValue: string | null;
  rawSourceValue: string | null;
  structuredValueJson: string | null;
  authorityState: TenderFactAuthorityState;
  confidence: number;
  sourceFileId: string | null;
  sourcePage: number | null;
  sourceQuote: string | null;
  reviewState: string;
  manuallyEntered: boolean;
  reason: string | null;
  confirmationBasis: string | null;
};

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Resolve the effective tender context — the single function all downstream
 * consumers should use to get the complete effective view of a tender.
 *
 * Merges:
 * - source-grounded Tender scalar values
 * - active metadata overrides (USER_EDITED, USER_CONFIRMED)
 * - human-confirmed operational values with audit context
 * - tender requirements count + grounding
 * - facts ledger entries (if provided)
 * - normalized submission-method context
 *
 * @param tender - The raw tender object with scalar columns.
 * @param overrides - The active TenderMetadataOverride rows for this tender.
 * @param requirements - The tender requirements (optional, for counts).
 * @param ledgerFacts - The TenderFactsLedger entries (optional).
 * @returns The effective tender context.
 */
export function resolveEffectiveTenderContext(
  tender: Record<string, unknown>,
  overrides: TenderMetadataOverride[],
  requirements?: Array<{ priority?: string | null; sourceTenderFileId?: string | null; sourcePageNumber?: number | null }>,
  ledgerFacts?: TenderFactsLedgerEntry[],
): EffectiveTenderContext {
  // Resolve effective facts (merges source-grounded + overrides)
  const facts = resolveEffectiveTenderFacts(tender, overrides);

  // Count requirements
  const allReqs = requirements ?? [];
  const mandatoryReqs = allReqs.filter((r) => (r.priority ?? "").toUpperCase() === "MANDATORY");
  const groundedReqs = allReqs.filter((r) => r.sourceTenderFileId && r.sourcePageNumber);

  return {
    facts,
    normalizedSubmissionMethod: facts.normalizedSubmissionMethod,
    effectiveSubmissionMethod: facts.effectiveSubmissionMethod,
    effectiveDeadline: facts.effectiveDeadline,
    effectiveClientName: facts.effectiveClientName,
    effectiveTitle: facts.effectiveTitle,
    effectiveReference: facts.effectiveReference,
    effectiveSubmissionEmails: facts.effectiveSubmissionEmails,
    effectiveSubmissionAddress: facts.effectiveSubmissionAddress,
    effectiveSubmissionEmailSubject: facts.effectiveSubmissionEmailSubject,
    hasRequirements: allReqs.length > 0,
    requirementCount: allReqs.length,
    mandatoryRequirementCount: mandatoryReqs.length,
    groundedRequirementCount: groundedReqs.length,
    ledgerFacts: ledgerFacts ?? [],
    snapshotRevision: null, // Set by the snapshot builder
  };
}
