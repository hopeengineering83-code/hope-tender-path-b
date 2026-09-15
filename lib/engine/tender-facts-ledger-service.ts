// lib/engine/tender-facts-ledger-service.ts
//
// TenderFactsLedger runtime authority service.
//
// TenderFactsLedger is the durable source of tender facts, authority state,
// user override state, evidence, and review status. Tender scalar columns
// may remain for backward compatibility, but runtime logic must prefer the
// ledger when available.
//
// Authority resolution order (highest priority first):
//   1. SOURCE_GROUNDED_CONFIRMED  — ledger fact with verified source evidence
//   2. USER_CONFIRMED / USER_EDITED — ledger fact with valid audit basis
//   3. NOT_APPLICABLE              — ledger fact marked N/A with reason
//   4. CANDIDATE_NEEDS_REVIEW      — ledger fact awaiting review (draft warning only)
//   5. clean source-derived/scalar fallback — only when no ledger fact exists
//   6. MISSING                     — no fact available
//
// Do not treat raw Tender scalar columns as authoritative when a ledger fact
// exists.

import type { PrismaClient, TenderFactsLedger } from "@prisma/client";
import { prisma, prismaReady } from "../prisma";
import { logAction } from "../audit";
import { containsMetadataPlaceholder } from "./metadata-validators";
import { computeTenderMutationLockKey } from "./advisory-lock-key";
import { locateQuoteProvenPage } from "./page-provenance";
import { normalizeEmailList } from "./source-driven-tender-text-parser";

// ─── Authority states ────────────────────────────────────────────────────────
//
// The schema uses these existing states:
//   SOURCE_GROUNDED_CONFIRMED, SOURCE_GROUNDED_UNUSUAL_FORMAT,
//   HUMAN_CONFIRMED_OPERATIONAL, CANDIDATE_NEEDS_REVIEW,
//   NOT_STATED_IN_SOURCE, CONDITIONAL_OR_UNSCHEDULED, REJECTED_EXTRACTION
//
// We map the required spec states to the schema states centrally so the app
// never scatters string comparisons:

export const AUTHORITY_STATE = {
  SOURCE_GROUNDED_CONFIRMED: "SOURCE_GROUNDED_CONFIRMED",
  USER_CONFIRMED: "HUMAN_CONFIRMED_OPERATIONAL",
  USER_EDITED: "HUMAN_CONFIRMED_OPERATIONAL",
  NOT_APPLICABLE: "NOT_APPLICABLE",
  CANDIDATE_NEEDS_REVIEW: "CANDIDATE_NEEDS_REVIEW",
  REJECTED_INVALID: "REJECTED_EXTRACTION",
  MISSING: "MISSING",
  SUPERSEDED: "SUPERSEDED",
  // Existing schema states (kept for completeness)
  SOURCE_GROUNDED_UNUSUAL_FORMAT: "SOURCE_GROUNDED_UNUSUAL_FORMAT",
  NOT_STATED_IN_SOURCE: "NOT_STATED_IN_SOURCE",
  CONDITIONAL_OR_UNSCHEDULED: "CONDITIONAL_OR_UNSCHEDULED",
} as const;

export type AuthorityState = typeof AUTHORITY_STATE[keyof typeof AUTHORITY_STATE];

/**
 * Check whether an authority state is a "resolving" state — i.e., a state
 * that provides a usable value for the fact (not missing, not rejected,
 * not superseded).
 */
export function isResolvingAuthorityState(state: string | null | undefined): boolean {
  if (!state) return false;
  const s = state.toUpperCase();
  return s === AUTHORITY_STATE.SOURCE_GROUNDED_CONFIRMED
    || s === "HUMAN_CONFIRMED_OPERATIONAL" // USER_CONFIRMED / USER_EDITED
    || s === AUTHORITY_STATE.NOT_APPLICABLE;
}

/**
 * Check whether an authority state is valid for FINAL submission.
 * Final requires SOURCE_GROUNDED_CONFIRMED or HUMAN_CONFIRMED_OPERATIONAL
 * with valid audit basis. NOT_APPLICABLE is accepted only with a recorded
 * reason (checked separately).
 */
export function isFinalValidAuthorityState(state: string | null | undefined): boolean {
  if (!state) return false;
  const s = state.toUpperCase();
  return s === AUTHORITY_STATE.SOURCE_GROUNDED_CONFIRMED
    || s === "HUMAN_CONFIRMED_OPERATIONAL";
}

/**
 * Check whether an authority state is valid for DRAFT output.
 * Draft accepts SOURCE_GROUNDED_CONFIRMED, HUMAN_CONFIRMED_OPERATIONAL,
 * and CANDIDATE_NEEDS_REVIEW (as a warning). NOT_APPLICABLE facts are
 * omitted from draft output. REJECTED_INVALID and MISSING are never used.
 */
export function isDraftValidAuthorityState(state: string | null | undefined): boolean {
  if (!state) return false;
  const s = state.toUpperCase();
  return s === AUTHORITY_STATE.SOURCE_GROUNDED_CONFIRMED
    || s === "HUMAN_CONFIRMED_OPERATIONAL"
    || s === AUTHORITY_STATE.CANDIDATE_NEEDS_REVIEW;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type TenderFactSnapshot = {
  tenderId: string;
  facts: TenderFactEntry[];
  summary: TenderFactSummary;
};

export type TenderFactEntry = {
  semanticKey: string;
  displayLabel: string;
  category: string;
  valueType: string;
  normalizedValue: string | null;
  rawSourceValue: string | null;
  authorityState: string;
  confidence: number;
  relevance: string;
  applicability: string;
  hasSourceEvidence: boolean;
  sourceFileId: string | null;
  sourcePage: number | null;
  sourceQuote: string | null;
  reviewState: string;
  manuallyEntered: boolean;
  reason: string | null;
  confirmationBasis: string | null;
  createdBy: string;
  confirmedBy: string | null;
  updatedAt: Date;
  /** True when this is the winning fact for its semanticKey after resolution */
  isWinner: boolean;
};

export type TenderFactSummary = {
  total: number;
  grounded: number;
  userConfirmed: number;
  userEdited: number;
  notApplicable: number;
  candidateNeedsReview: number;
  rejectedInvalid: number;
  missingFinalRequired: number;
};

export type ResolvedTenderFact = {
  semanticKey: string;
  displayLabel: string;
  /** The resolved value (from ledger or scalar fallback) */
  value: string | null;
  /** The authority state of the resolved value */
  authorityState: string;
  /** True when the value came from the ledger (not scalar fallback) */
  fromLedger: boolean;
  /** True when the value has source evidence (file + page + quote) */
  hasSourceEvidence: boolean;
  /** Source evidence details */
  sourceFileId: string | null;
  sourcePage: number | null;
  sourceQuote: string | null;
  /** Confidence 0..1 */
  confidence: number;
  /** The ledger entry if fromLedger is true */
  ledgerEntry: TenderFactEntry | null;
};

export type GetSnapshotOptions = {
  /** When true, include superseded facts in the snapshot (default false) */
  includeSuperseded?: boolean;
};

// ─── Snapshot service ────────────────────────────────────────────────────────

/**
 * Get the full tender fact ledger snapshot for a tender.
 * Returns all non-superseded facts, plus a summary.
 */
export async function getTenderFactLedgerSnapshot(
  prismaClient: PrismaClient,
  tenderId: string,
  options: GetSnapshotOptions = {},
): Promise<TenderFactSnapshot> {
  const where: { tenderId: string; supersededById?: null } = { tenderId };
  if (!options.includeSuperseded) {
    where.supersededById = null;
  }
  const rows = await (prismaClient as any).tenderFactsLedger.findMany({
    where,
    orderBy: { updatedAt: "desc" },
  });

  const facts: TenderFactEntry[] = rows.map((row: TenderFactsLedger) => ({
    semanticKey: row.semanticKey,
    displayLabel: row.displayLabel,
    category: row.category,
    valueType: row.valueType,
    normalizedValue: row.normalizedValue,
    rawSourceValue: row.rawSourceValue,
    authorityState: row.authorityState,
    confidence: row.confidence,
    relevance: row.relevance,
    applicability: row.applicability,
    hasSourceEvidence: !!(row.sourceFileId && row.sourcePage !== null && row.sourceQuote),
    sourceFileId: row.sourceFileId,
    sourcePage: row.sourcePage,
    sourceQuote: row.sourceQuote,
    reviewState: row.reviewState,
    manuallyEntered: row.manuallyEntered,
    reason: row.reason,
    confirmationBasis: row.confirmationBasis,
    createdBy: row.createdBy,
    confirmedBy: row.confirmedBy,
    updatedAt: row.updatedAt,
    isWinner: true, // only non-superseded rows are returned
  }));

  return {
    tenderId,
    facts,
    summary: computeSummary(facts),
  };
}

function computeSummary(facts: TenderFactEntry[]): TenderFactSummary {
  let grounded = 0;
  let userConfirmed = 0;
  let userEdited = 0;
  let notApplicable = 0;
  let candidateNeedsReview = 0;
  let rejectedInvalid = 0;
  let missingFinalRequired = 0;

  for (const f of facts) {
    const s = f.authorityState.toUpperCase();
    if (s === AUTHORITY_STATE.SOURCE_GROUNDED_CONFIRMED) grounded++;
    else if (s === "HUMAN_CONFIRMED_OPERATIONAL") {
      if (f.manuallyEntered) userEdited++;
      else userConfirmed++;
    } else if (s === AUTHORITY_STATE.NOT_APPLICABLE) notApplicable++;
    else if (s === AUTHORITY_STATE.CANDIDATE_NEEDS_REVIEW) candidateNeedsReview++;
    else if (s === AUTHORITY_STATE.REJECTED_INVALID) rejectedInvalid++;
    // missingFinalRequired is computed by the caller using final-required keys
  }

  return {
    total: facts.length,
    grounded,
    userConfirmed,
    userEdited,
    notApplicable,
    candidateNeedsReview,
    rejectedInvalid,
    missingFinalRequired,
  };
}

// ─── Resolver ────────────────────────────────────────────────────────────────

/**
 * Resolve a single tender fact from the snapshot.
 * Authority resolution order:
 *   1. SOURCE_GROUNDED_CONFIRMED
 *   2. USER_CONFIRMED / USER_EDITED (HUMAN_CONFIRMED_OPERATIONAL)
 *   3. NOT_APPLICABLE
 *   4. CANDIDATE_NEEDS_REVIEW
 *   5. (scalar fallback handled by resolveTenderFactValue)
 *   6. MISSING
 */
export function resolveTenderFact(
  snapshot: TenderFactSnapshot,
  semanticKey: string,
): TenderFactEntry | null {
  const entries = snapshot.facts.filter((f) => f.semanticKey === semanticKey);
  if (entries.length === 0) return null;

  // Priority order
  const priority = (state: string): number => {
    const s = state.toUpperCase();
    if (s === AUTHORITY_STATE.SOURCE_GROUNDED_CONFIRMED) return 1;
    if (s === "HUMAN_CONFIRMED_OPERATIONAL") return 2;
    if (s === AUTHORITY_STATE.NOT_APPLICABLE) return 3;
    if (s === AUTHORITY_STATE.CANDIDATE_NEEDS_REVIEW) return 4;
    if (s === AUTHORITY_STATE.SOURCE_GROUNDED_UNUSUAL_FORMAT) return 5;
    if (s === AUTHORITY_STATE.CONDITIONAL_OR_UNSCHEDULED) return 6;
    if (s === AUTHORITY_STATE.NOT_STATED_IN_SOURCE) return 7;
    if (s === AUTHORITY_STATE.REJECTED_INVALID) return 8;
    if (s === AUTHORITY_STATE.SUPERSEDED) return 99;
    return 50;
  };

  entries.sort((a, b) => priority(a.authorityState) - priority(b.authorityState));
  return entries[0];
}

/**
 * Resolve a tender fact value, falling back to a scalar value when no ledger
 * fact exists. The scalar fallback is ONLY used when there is no ledger entry
 * for the semantic key.
 */
export function resolveTenderFactValue(
  snapshot: TenderFactSnapshot,
  semanticKey: string,
  scalarFallback?: string | null,
): ResolvedTenderFact {
  const entry = resolveTenderFact(snapshot, semanticKey);

  if (entry) {
    return {
      semanticKey,
      displayLabel: entry.displayLabel,
      value: entry.normalizedValue ?? entry.rawSourceValue,
      authorityState: entry.authorityState,
      fromLedger: true,
      hasSourceEvidence: entry.hasSourceEvidence,
      sourceFileId: entry.sourceFileId,
      sourcePage: entry.sourcePage,
      sourceQuote: entry.sourceQuote,
      confidence: entry.confidence,
      ledgerEntry: entry,
    };
  }

  // Scalar fallback — only when no ledger fact exists
  return {
    semanticKey,
    displayLabel: semanticKey,
    value: scalarFallback ?? null,
    authorityState: scalarFallback ? AUTHORITY_STATE.CANDIDATE_NEEDS_REVIEW : AUTHORITY_STATE.MISSING,
    fromLedger: false,
    hasSourceEvidence: false,
    sourceFileId: null,
    sourcePage: null,
    sourceQuote: null,
    confidence: 0,
    ledgerEntry: null,
  };
}

// ─── Mutation helpers ────────────────────────────────────────────────────────

export type UpsertFromSourceInput = {
  tenderId: string;
  semanticKey: string;
  displayLabel: string;
  category: string;
  valueType: string;
  normalizedValue: string | null;
  rawSourceValue: string | null;
  sourceFileId?: string | null;
  sourcePage?: number | null;
  sourceQuote?: string | null;
  sourceContentHash?: string | null;
  confidence?: number;
  relevance?: string;
  userId: string;
};

export type UpsertFromManualOverrideInput = {
  tenderId: string;
  semanticKey: string;
  displayLabel: string;
  category: string;
  valueType: string;
  normalizedValue: string;
  reason: string;
  confirmationBasis: string;
  userId: string;
  /** "USER_CONFIRMED" or "USER_EDITED" (both map to HUMAN_CONFIRMED_OPERATIONAL) */
  action?: "USER_CONFIRMED" | "USER_EDITED";
};

export type MarkNotApplicableInput = {
  tenderId: string;
  semanticKey: string;
  displayLabel: string;
  category: string;
  reason: string;
  userId: string;
};

export type RejectInvalidInput = {
  tenderId: string;
  semanticKey: string;
  displayLabel: string;
  category: string;
  reason: string;
  userId: string;
};

export type SupersedeInput = {
  tenderId: string;
  semanticKey: string;
  reason: string;
  userId: string;
};

/**
 * Upsert a tender fact from source extraction. If the fact already exists
 * and is SOURCE_GROUNDED_CONFIRMED with the same value, it is kept. If the
 * new fact has stronger evidence, the old fact is superseded.
 */
export async function upsertTenderFactFromSource(
  prismaClient: PrismaClient,
  input: UpsertFromSourceInput,
): Promise<TenderFactsLedger> {
  const hasEvidence = !!(input.sourceFileId && input.sourcePage !== null && input.sourceQuote);
  const authorityState = hasEvidence
    ? AUTHORITY_STATE.SOURCE_GROUNDED_CONFIRMED
    : AUTHORITY_STATE.CANDIDATE_NEEDS_REVIEW;

  const result = await (prismaClient as any).tenderFactsLedger.upsert({
    where: {
      tenderId_semanticKey: { tenderId: input.tenderId, semanticKey: input.semanticKey },
    },
    create: {
      tenderId: input.tenderId,
      semanticKey: input.semanticKey,
      displayLabel: input.displayLabel,
      category: input.category,
      valueType: input.valueType,
      normalizedValue: input.normalizedValue,
      rawSourceValue: input.rawSourceValue,
      authorityState,
      confidence: input.confidence ?? (hasEvidence ? 0.9 : 0.5),
      relevance: input.relevance ?? "informational",
      applicability: "applies",
      sourceFileId: input.sourceFileId ?? null,
      sourcePage: input.sourcePage ?? null,
      sourceQuote: input.sourceQuote ?? null,
      sourceContentHash: input.sourceContentHash ?? null,
      reviewState: "pending",
      manuallyEntered: false,
      createdBy: input.userId,
    },
    update: {
      // Only update if the new fact has stronger evidence OR same state
      ...(hasEvidence ? {
        normalizedValue: input.normalizedValue,
        rawSourceValue: input.rawSourceValue,
        authorityState,
        sourceFileId: input.sourceFileId ?? null,
        sourcePage: input.sourcePage ?? null,
        sourceQuote: input.sourceQuote ?? null,
        confidence: input.confidence ?? 0.9,
      } : {}),
    },
  });

  await auditLedgerMutation(input.tenderId, input.semanticKey, "UPSERT_FROM_SOURCE", input.userId, {
    authorityState,
    hasEvidence,
    normalizedValue: input.normalizedValue,
  });

  return result;
}

/**
 * Upsert a tender fact from a manual user override (edit or confirm).
 */
export async function upsertTenderFactFromManualOverride(
  prismaClient: PrismaClient,
  input: UpsertFromManualOverrideInput,
): Promise<TenderFactsLedger> {
  const result = await (prismaClient as any).tenderFactsLedger.upsert({
    where: {
      tenderId_semanticKey: { tenderId: input.tenderId, semanticKey: input.semanticKey },
    },
    create: {
      tenderId: input.tenderId,
      semanticKey: input.semanticKey,
      displayLabel: input.displayLabel,
      category: input.category,
      valueType: input.valueType,
      normalizedValue: input.normalizedValue,
      rawSourceValue: input.normalizedValue,
      authorityState: AUTHORITY_STATE.USER_CONFIRMED, // HUMAN_CONFIRMED_OPERATIONAL
      confidence: 1.0,
      relevance: "critical",
      applicability: "applies",
      reviewState: "approved",
      manuallyEntered: input.action === "USER_EDITED",
      reason: input.reason,
      confirmationBasis: input.confirmationBasis,
      createdBy: input.userId,
      confirmedBy: input.userId,
      confirmedAt: new Date(),
    },
    update: {
      normalizedValue: input.normalizedValue,
      rawSourceValue: input.normalizedValue,
      authorityState: AUTHORITY_STATE.USER_CONFIRMED,
      confidence: 1.0,
      reviewState: "approved",
      manuallyEntered: input.action === "USER_EDITED",
      reason: input.reason,
      confirmationBasis: input.confirmationBasis,
      confirmedBy: input.userId,
      confirmedAt: new Date(),
    },
  });

  await auditLedgerMutation(input.tenderId, input.semanticKey, "MANUAL_OVERRIDE", input.userId, {
    authorityState: AUTHORITY_STATE.USER_CONFIRMED,
    action: input.action ?? "USER_CONFIRMED",
    normalizedValue: input.normalizedValue,
    reason: input.reason,
    confirmationBasis: input.confirmationBasis,
  });

  return result;
}

/**
 * Mark a tender fact as NOT_APPLICABLE with a recorded reason.
 */
export async function markTenderFactNotApplicable(
  prismaClient: PrismaClient,
  input: MarkNotApplicableInput,
): Promise<TenderFactsLedger> {
  const result = await (prismaClient as any).tenderFactsLedger.upsert({
    where: {
      tenderId_semanticKey: { tenderId: input.tenderId, semanticKey: input.semanticKey },
    },
    create: {
      tenderId: input.tenderId,
      semanticKey: input.semanticKey,
      displayLabel: input.displayLabel,
      category: input.category,
      valueType: "TEXT",
      normalizedValue: null,
      rawSourceValue: null,
      authorityState: AUTHORITY_STATE.NOT_APPLICABLE,
      confidence: 1.0,
      relevance: "informational",
      applicability: "not_applicable",
      reviewState: "approved",
      manuallyEntered: true,
      reason: input.reason,
      createdBy: input.userId,
      confirmedBy: input.userId,
      confirmedAt: new Date(),
    },
    update: {
      authorityState: AUTHORITY_STATE.NOT_APPLICABLE,
      applicability: "not_applicable",
      reviewState: "approved",
      manuallyEntered: true,
      reason: input.reason,
      normalizedValue: null,
      rawSourceValue: null,
      confirmedBy: input.userId,
      confirmedAt: new Date(),
    },
  });

  await auditLedgerMutation(input.tenderId, input.semanticKey, "MARK_NOT_APPLICABLE", input.userId, {
    authorityState: AUTHORITY_STATE.NOT_APPLICABLE,
    reason: input.reason,
  });

  return result;
}

/**
 * Reject an invalid tender fact (e.g., placeholder value, contaminated text).
 */
export async function rejectInvalidTenderFact(
  prismaClient: PrismaClient,
  input: RejectInvalidInput,
): Promise<TenderFactsLedger> {
  const result = await (prismaClient as any).tenderFactsLedger.upsert({
    where: {
      tenderId_semanticKey: { tenderId: input.tenderId, semanticKey: input.semanticKey },
    },
    create: {
      tenderId: input.tenderId,
      semanticKey: input.semanticKey,
      displayLabel: input.displayLabel,
      category: input.category,
      valueType: "TEXT",
      normalizedValue: null,
      rawSourceValue: null,
      authorityState: AUTHORITY_STATE.REJECTED_INVALID,
      confidence: 0,
      relevance: "informational",
      applicability: "applies",
      reviewState: "rejected",
      manuallyEntered: true,
      reason: input.reason,
      createdBy: input.userId,
    },
    update: {
      authorityState: AUTHORITY_STATE.REJECTED_INVALID,
      reviewState: "rejected",
      reason: input.reason,
      normalizedValue: null,
      rawSourceValue: null,
    },
  });

  await auditLedgerMutation(input.tenderId, input.semanticKey, "REJECT_INVALID", input.userId, {
    authorityState: AUTHORITY_STATE.REJECTED_INVALID,
    reason: input.reason,
  });

  return result;
}

/**
 * Supersede a tender fact — mark it as replaced by a newer fact.
 */
export async function supersedeTenderFact(
  prismaClient: PrismaClient,
  input: SupersedeInput,
): Promise<{ supersededCount: number }> {
  // Mark all existing non-superseded facts for this semanticKey as superseded
  const result = await (prismaClient as any).tenderFactsLedger.updateMany({
    where: {
      tenderId: input.tenderId,
      semanticKey: input.semanticKey,
      supersededById: null,
    },
    data: {
      authorityState: AUTHORITY_STATE.SUPERSEDED,
      reason: input.reason,
    },
  });

  await auditLedgerMutation(input.tenderId, input.semanticKey, "SUPERSEDE", input.userId, {
    authorityState: AUTHORITY_STATE.SUPERSEDED,
    reason: input.reason,
    supersededCount: result.count,
  });

  return { supersededCount: result.count };
}

// ─── Backfill helper ─────────────────────────────────────────────────────────

export type BackfillOptions = {
  /** When true, actually write rows. Default false (dry-run). */
  apply?: boolean;
  /** Limit to a specific tender ID */
  tenderId?: string;
  /** Limit the number of tenders to process */
  limit?: number;
  /** Filter tenders updated after this date */
  updatedAfter?: Date;
};

export type BackfillResult = {
  totalTenders: number;
  processedTenders: number;
  totalCandidates: number;
  totalSkipped: number;
  totalGrounded: number;
  totalCandidate: number;
  totalRejected: number;
  skippedReasons: Array<{ tenderId: string; semanticKey: string; reason: string }>;
};

/**
 * Backfill TenderFactsLedger from legacy Tender scalar columns.
 * Dry-run by default. Refuses --apply in production.
 * Idempotent: skips semanticKeys that already exist for a tender.
 * Does NOT modify Tender scalar columns.
 * Does NOT mark unverified data as SOURCE_GROUNDED_CONFIRMED.
 */
export async function backfillTenderFactsForTender(
  prismaClient: PrismaClient,
  options: BackfillOptions = {},
): Promise<BackfillResult> {
  const isApply = options.apply ?? false;
  const isProduction = process.env.NODE_ENV === "production";

  if (isApply && isProduction) {
    throw new Error("--apply is not allowed in NODE_ENV=production. Run in staging/dev.");
  }

  const where: { userId?: string; updatedAt?: { gt: Date } } = {};
  if (options.tenderId) {
    (where as any).id = options.tenderId;
  }
  if (options.updatedAfter) {
    where.updatedAt = { gt: options.updatedAfter };
  }

  const tenders = await (prismaClient as any).tender.findMany({
    where,
    select: {
      id: true, title: true, reference: true, clientName: true, procuringEntityName: true,
      deadline: true, submissionMethod: true, submissionEmails: true, submissionAddress: true,
      country: true, category: true, userId: true,
      clientNameSourceFileId: true, clientNameSourcePage: true, clientNameSourceQuote: true,
      deadlineSourceFileId: true, deadlineSourcePage: true, deadlineSourceQuote: true,
      titleSourceFileId: true, titleSourcePage: true, titleSourceQuote: true,
      referenceSourceFileId: true, referenceSourcePage: true, referenceSourceQuote: true,
      submissionMethodSourceFileId: true, submissionMethodSourcePage: true, submissionMethodSourceQuote: true,
      // Client / procuring-entity detail. These must be selected explicitly:
      // buildBackfillCandidates reads them off the row, and an unselected column
      // arrives as undefined, which would silently skip every one of them.
      legalClientName: true, donorAgency: true, implementingAgency: true,
      clientAddress: true, clientCity: true, clientContactName: true, clientContactTitle: true,
      clientContactEmail: true, clientContactPhone: true, clientWebsite: true,
      preBidChannel: true, clientRepresentative: true,
      // Per-field source evidence for those client details. finalizeJob already
      // resolves {fileId, page, quote} for every contactDetailsSource entry
      // (attributeMetadataSourceFileId + locateQuoteProvenPage) and persists it
      // here. Without selecting it the ledger cannot see provenance that the
      // database already holds, and every client field would stay ungrounded.
      contactDetailsSourceJson: true,
    },
    ...(options.limit ? { take: options.limit } : {}),
  });

  let totalCandidates = 0;
  let totalSkipped = 0;
  let totalGrounded = 0;
  let totalCandidate = 0;
  let totalRejected = 0;
  const skippedReasons: Array<{ tenderId: string; semanticKey: string; reason: string }> = [];

  for (const tender of tenders) {
    // Check existing ledger entries for this tender
    const existing = await (prismaClient as any).tenderFactsLedger.findMany({
      where: { tenderId: tender.id },
      select: { semanticKey: true },
    });
    const existingKeys = new Set(existing.map((e: any) => e.semanticKey));

    // Build candidate entries from scalar columns
    const candidates = buildBackfillCandidates(tender);

    for (const c of candidates) {
      // Skip if already exists (idempotent)
      if (existingKeys.has(c.semanticKey)) {
        totalSkipped++;
        skippedReasons.push({ tenderId: tender.id, semanticKey: c.semanticKey, reason: "Already exists in ledger" });
        continue;
      }

      // Reject placeholder-ish values
      if (isPlaceholderIsh(c.normalizedValue)) {
        totalRejected++;
        skippedReasons.push({ tenderId: tender.id, semanticKey: c.semanticKey, reason: `Placeholder/invalid value: "${c.normalizedValue}"` });
        continue;
      }

      // Determine authority state
      const hasEvidence = !!(c.sourceFileId && c.sourcePage !== null && c.sourceQuote);
      const authorityState = hasEvidence
        ? AUTHORITY_STATE.SOURCE_GROUNDED_CONFIRMED
        : AUTHORITY_STATE.CANDIDATE_NEEDS_REVIEW;

      if (hasEvidence) totalGrounded++;
      else totalCandidate++;
      totalCandidates++;

      if (isApply) {
        await (prismaClient as any).tenderFactsLedger.create({
          data: {
            tenderId: tender.id,
            semanticKey: c.semanticKey,
            displayLabel: c.displayLabel,
            category: c.category,
            valueType: c.valueType,
            normalizedValue: c.normalizedValue,
            rawSourceValue: c.rawSourceValue,
            authorityState,
            confidence: hasEvidence ? 0.9 : 0.5,
            relevance: c.relevance,
            applicability: "applies",
            sourceFileId: c.sourceFileId ?? null,
            sourcePage: c.sourcePage ?? null,
            sourceQuote: c.sourceQuote ?? null,
            reviewState: "pending",
            manuallyEntered: false,
            createdBy: tender.userId,
          },
        });
      }
    }
  }

  return {
    totalTenders: tenders.length,
    processedTenders: tenders.length,
    totalCandidates,
    totalSkipped,
    totalGrounded,
    totalCandidate,
    totalRejected,
    skippedReasons,
  };
}

type BackfillCandidate = {
  semanticKey: string;
  displayLabel: string;
  category: string;
  valueType: string;
  normalizedValue: string | null;
  rawSourceValue: string | null;
  relevance: string;
  sourceFileId: string | null;
  sourcePage: number | null;
  sourceQuote: string | null;
};

/**
 * Read the per-field client-detail source evidence that promotion persisted on
 * `Tender.contactDetailsSourceJson`.
 *
 * Fail-closed by construction: an entry is returned ONLY when it carries the
 * complete triple — a source file id, a positive integer page, and a quote of
 * meaningful length. `locateQuoteProvenPage` (used when this JSON is written)
 * returns null whenever the quote cannot be located in the file, or when
 * multiple occurrences resolve to different pages, so a non-null page here means
 * the quote was actually found in that file. Anything partial or malformed is
 * dropped, leaving the fact to land as CANDIDATE_NEEDS_REVIEW.
 *
 * This never invents provenance: it only surfaces evidence the database already
 * holds.
 */
function parseContactDetailsSourceEvidence(
  raw: string | null,
): Map<string, { fileId: string; page: number; quote: string }> {
  const out = new Map<string, { fileId: string; page: number; quote: string }>();
  if (!raw) return out;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return out;

  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const entry = value as { fileId?: unknown; page?: unknown; quote?: unknown };

    const fileId = typeof entry.fileId === "string" ? entry.fileId.trim() : "";
    const page = typeof entry.page === "number" ? entry.page : NaN;
    const quote = typeof entry.quote === "string" ? entry.quote.trim() : "";

    if (!fileId) continue;
    if (!Number.isInteger(page) || page < 1) continue;
    // Matches the minimum meaningful-quote length the Build Plan gate enforces.
    if (quote.length < 10) continue;

    out.set(key, { fileId, page, quote });
  }

  return out;
}

function buildBackfillCandidates(tender: any): BackfillCandidate[] {
  const candidates: BackfillCandidate[] = [];

  // Title
  if (tender.title) {
    candidates.push({
      semanticKey: "title",
      displayLabel: "Tender Title",
      category: "tender-identity",
      valueType: "TEXT",
      normalizedValue: tender.title,
      rawSourceValue: tender.title,
      relevance: "mandatory",
      sourceFileId: tender.titleSourceFileId ?? null,
      sourcePage: tender.titleSourcePage ?? null,
      sourceQuote: tender.titleSourceQuote ?? null,
    });
  }

  // Client name
  const clientName = tender.clientName || tender.procuringEntityName;
  if (clientName) {
    candidates.push({
      semanticKey: "clientName",
      displayLabel: "Client / Procuring Entity",
      category: "procuring-entity",
      valueType: "TEXT",
      normalizedValue: clientName,
      rawSourceValue: clientName,
      relevance: "mandatory",
      sourceFileId: tender.clientNameSourceFileId ?? null,
      sourcePage: tender.clientNameSourcePage ?? null,
      sourceQuote: tender.clientNameSourceQuote ?? null,
    });
  }

  // ── Remaining client / procuring-entity detail ────────────────────────────
  //
  // CLAUDE.md requires a source page and source quote for EVERY extracted
  // client field. These twelve were extracted and stored as Tender scalars but
  // never given a ledger row, so they were invisible to every ledger consumer —
  // readiness, gates, and the review surfaces — and no reviewer could trace them
  // to a page and quote.
  //
  // They have no xSourceFileId/xSourcePage/xSourceQuote companions on Tender,
  // but that does NOT mean they have no provenance: promotion resolves a
  // {fileId, page, quote} triple for each of them into
  // `Tender.contactDetailsSourceJson`, keyed by these same semanticKeys. That
  // evidence is now read below, so a client field the AI genuinely traced to a
  // page and quote can reach SOURCE_GROUNDED_CONFIRMED instead of being pinned
  // to CANDIDATE_NEEDS_REVIEW forever.
  //
  // A field with no complete, defensible triple still carries null provenance,
  // and that remains the point:
  // upsertTenderFactFromSource derives SOURCE_GROUNDED_CONFIRMED only when the
  // full triple is present and CANDIDATE_NEEDS_REVIEW otherwise, so these land
  // as candidates needing review rather than as grounded facts. A field with a
  // value but no traceable source must look exactly like that — visible, and
  // visibly ungrounded — instead of being absent and therefore unnoticed.
  const clientDetailFields: Array<{
    value: unknown;
    semanticKey: string;
    displayLabel: string;
    category: string;
    valueType: string;
    relevance: string;
  }> = [
    { value: tender.legalClientName, semanticKey: "legalClientName", displayLabel: "Full Legal Client Name", category: "procuring-entity", valueType: "TEXT", relevance: "advisory" },
    { value: tender.donorAgency, semanticKey: "donorAgency", displayLabel: "Donor / Funding Agency", category: "procuring-entity", valueType: "TEXT", relevance: "advisory" },
    { value: tender.implementingAgency, semanticKey: "implementingAgency", displayLabel: "Implementing Agency / Project Owner", category: "procuring-entity", valueType: "TEXT", relevance: "advisory" },
    { value: tender.clientAddress, semanticKey: "clientAddress", displayLabel: "Client Address", category: "procuring-entity", valueType: "ADDRESS", relevance: "advisory" },
    // CLAUDE.md item 9, "City / project location". AI Analyze extracts it and
    // asks the provider for its page and quote alongside the other contact
    // fields, and the tender detail panel displays it — the ledger was the only
    // consumer that could not see it, which is precisely the surface a reviewer
    // uses to ask whether a displayed value is traceable.
    { value: tender.clientCity, semanticKey: "clientCity", displayLabel: "City / Project Location", category: "procuring-entity", valueType: "TEXT", relevance: "advisory" },
    { value: tender.clientContactName, semanticKey: "clientContactName", displayLabel: "Client Contact Name", category: "procuring-entity", valueType: "TEXT", relevance: "advisory" },
    { value: tender.clientContactTitle, semanticKey: "clientContactTitle", displayLabel: "Client Contact Title / Role", category: "procuring-entity", valueType: "TEXT", relevance: "informational" },
    { value: tender.clientContactEmail, semanticKey: "clientContactEmail", displayLabel: "Client Contact Email", category: "procuring-entity", valueType: "EMAIL_LIST", relevance: "advisory" },
    { value: tender.clientContactPhone, semanticKey: "clientContactPhone", displayLabel: "Client Contact Phone", category: "procuring-entity", valueType: "TEXT", relevance: "informational" },
    { value: tender.clientWebsite, semanticKey: "clientWebsite", displayLabel: "Client Website / Portal", category: "procuring-entity", valueType: "URL", relevance: "informational" },
    { value: tender.preBidChannel, semanticKey: "preBidChannel", displayLabel: "Pre-Bid / Contact Channel", category: "pre-bid", valueType: "TEXT", relevance: "advisory" },
    { value: tender.clientRepresentative, semanticKey: "clientRepresentative", displayLabel: "Client Representative / Authorized Officer", category: "procuring-entity", valueType: "TEXT", relevance: "informational" },
  ];

  // Per-field source evidence resolved during promotion. finalizeJob binds each
  // contactDetailsSource entry to a real ACTIVE TenderFile via
  // attributeMetadataSourceFileId and proves the page via locateQuoteProvenPage,
  // which returns null when the quote cannot be located. The keys used there are
  // the same semanticKeys used below.
  const contactSourceEvidence = parseContactDetailsSourceEvidence(
    (tender as { contactDetailsSourceJson?: string | null }).contactDetailsSourceJson ?? null,
  );

  for (const field of clientDetailFields) {
    const raw = typeof field.value === "string" ? field.value.trim() : "";
    if (!raw) continue;
    // Only a COMPLETE, defensible triple counts. A partial entry (quote without
    // a proven page, or a page with no file) stays null so the fact lands as
    // CANDIDATE_NEEDS_REVIEW. Never invent a page or a quote.
    const evidence = contactSourceEvidence.get(field.semanticKey) ?? null;
    candidates.push({
      semanticKey: field.semanticKey,
      displayLabel: field.displayLabel,
      category: field.category,
      valueType: field.valueType,
      normalizedValue: raw,
      rawSourceValue: raw,
      relevance: field.relevance,
      sourceFileId: evidence?.fileId ?? null,
      sourcePage: evidence?.page ?? null,
      sourceQuote: evidence?.quote ?? null,
    });
  }

  // Reference
  if (tender.reference) {
    candidates.push({
      semanticKey: "reference",
      displayLabel: "Reference Number",
      category: "tender-identity",
      valueType: "TEXT",
      normalizedValue: tender.reference,
      rawSourceValue: tender.reference,
      relevance: "informational",
      sourceFileId: tender.referenceSourceFileId ?? null,
      sourcePage: tender.referenceSourcePage ?? null,
      sourceQuote: tender.referenceSourceQuote ?? null,
    });
  }

  // Deadline
  if (tender.deadline) {
    const d = tender.deadline instanceof Date ? tender.deadline.toISOString() : String(tender.deadline);
    candidates.push({
      semanticKey: "deadline",
      displayLabel: "Submission Deadline",
      category: "submission",
      valueType: "DATETIME",
      normalizedValue: d,
      rawSourceValue: d,
      relevance: "mandatory",
      sourceFileId: tender.deadlineSourceFileId ?? null,
      sourcePage: tender.deadlineSourcePage ?? null,
      sourceQuote: tender.deadlineSourceQuote ?? null,
    });
  }

  // Submission method
  if (tender.submissionMethod) {
    candidates.push({
      semanticKey: "submissionMethod",
      displayLabel: "Submission Method",
      category: "submission",
      valueType: "TEXT",
      normalizedValue: tender.submissionMethod,
      rawSourceValue: tender.submissionMethod,
      relevance: "critical",
      sourceFileId: tender.submissionMethodSourceFileId ?? null,
      sourcePage: tender.submissionMethodSourcePage ?? null,
      sourceQuote: tender.submissionMethodSourceQuote ?? null,
    });
  }

  // Submission emails — normalize with robust splitter
  if (tender.submissionEmails) {
    const emails = normalizeEmailList(tender.submissionEmails);
    if (emails.length > 0) {
      candidates.push({
        semanticKey: "submissionEmails",
        displayLabel: "Submission Emails",
        category: "submission",
        valueType: "EMAIL_LIST",
        normalizedValue: emails.join(", "),
        rawSourceValue: tender.submissionEmails,
        relevance: "critical",
        sourceFileId: null,
        sourcePage: null,
        sourceQuote: null,
      });
    }
  }

  // Submission address
  if (tender.submissionAddress) {
    candidates.push({
      semanticKey: "submissionAddress",
      displayLabel: "Submission Address",
      category: "submission",
      valueType: "ADDRESS",
      normalizedValue: tender.submissionAddress,
      rawSourceValue: tender.submissionAddress,
      relevance: "critical",
      sourceFileId: null,
      sourcePage: null,
      sourceQuote: null,
    });
  }

  // Country
  if (tender.country) {
    candidates.push({
      semanticKey: "country",
      displayLabel: "Country",
      category: "site-location",
      valueType: "TEXT",
      normalizedValue: tender.country,
      rawSourceValue: tender.country,
      relevance: "informational",
      sourceFileId: null,
      sourcePage: null,
      sourceQuote: null,
    });
  }

  return candidates;
}

export type PersistedTenderFactSyncResult = {
  synced: number;
  grounded: number;
  candidates: number;
  skipped: number;
};

/**
 * Persist the canonical scalar/source-evidence projection into the durable
 * ledger after a successful analysis promotion or source enrichment.
 *
 * This is deliberately stricter than the legacy backfill:
 * - it verifies ownership and ACTIVE source-file membership;
 * - a quote must resolve to the stored page in the stored file text;
 * - human-confirmed and not-applicable facts are never overwritten;
 * - a grounded fact is never downgraded to an ungrounded candidate;
 * - the tender mutation advisory lock serializes it with AI promotion.
 */
export async function syncPersistedTenderFactsToLedger(
  prismaClient: PrismaClient,
  tenderId: string,
  userId: string,
  options: { beforeRead?: (tx: any) => Promise<void> } = {},
): Promise<PersistedTenderFactSyncResult> {
  const result = await prismaClient.$transaction(async (tx) => {
    const mutationLock = computeTenderMutationLockKey(tenderId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${mutationLock})`;
    await options.beforeRead?.(tx);

    const tender = await tx.tender.findFirst({
      where: { id: tenderId, userId },
      select: {
        id: true,
        title: true,
        reference: true,
        clientName: true,
        procuringEntityName: true,
        deadline: true,
        submissionMethod: true,
        submissionEmails: true,
        submissionAddress: true,
        submissionEmailSubject: true,
        country: true,
        titleSourceFileId: true,
        titleSourcePage: true,
        titleSourceQuote: true,
        clientNameSourceFileId: true,
        clientNameSourcePage: true,
        clientNameSourceQuote: true,
        referenceSourceFileId: true,
        referenceSourcePage: true,
        referenceSourceQuote: true,
        deadlineSourceFileId: true,
        deadlineSourcePage: true,
        deadlineSourceQuote: true,
        submissionMethodSourceFileId: true,
        submissionMethodSourcePage: true,
        submissionMethodSourceQuote: true,
        submissionEmailSourceFileId: true,
        submissionEmailSourcePage: true,
        submissionEmailSourceQuote: true,
        submissionAddressSourceFileId: true,
        submissionAddressSourcePage: true,
        submissionAddressSourceQuote: true,
        submissionEmailSubjectSourceFileId: true,
        submissionEmailSubjectSourcePage: true,
        submissionEmailSubjectSourceQuote: true,
        contactDetailsSourceJson: true,
        // Client / procuring-entity detail. The backfill select carries these
        // with an explicit warning that "an unselected column arrives as
        // undefined, which would silently skip every one of them" — but this
        // LIVE sync path (the one finalizeJob calls after every promotion) did
        // not select them. buildBackfillCandidates skips a candidate whose value
        // is falsy, so all eleven client fields silently received no ledger row
        // at all on the live path, while the backfill script produced them. Only
        // the backfilled tenders had these facts; freshly analyzed ones did not.
        legalClientName: true, donorAgency: true, implementingAgency: true,
        clientAddress: true, clientContactName: true, clientContactTitle: true,
        clientContactEmail: true, clientContactPhone: true, clientWebsite: true,
        preBidChannel: true, clientRepresentative: true,
        files: {
          where: { deletionStatus: "ACTIVE" },
          select: {
            id: true,
            extractedText: true,
            totalPages: true,
            contentSha256: true,
            contentHash: true,
          },
        },
      },
    });
    if (!tender) throw new Error("TENDER_FACT_SYNC_OWNERSHIP_MISMATCH");

    type ReferenceFallback = { fileId?: string | null; page?: number | null; quote?: string | null };
    let referenceFallback: ReferenceFallback | null = null;
    if (tender.contactDetailsSourceJson) {
      try {
        const parsed = JSON.parse(tender.contactDetailsSourceJson) as Record<string, unknown>;
        const candidate = parsed.procurementReferenceNumber;
        if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
          referenceFallback = candidate as ReferenceFallback;
        }
      } catch {
        referenceFallback = null;
      }
    }

    const candidates = buildBackfillCandidates({
      ...tender,
      referenceSourceFileId: tender.referenceSourceFileId ?? referenceFallback?.fileId ?? null,
      referenceSourcePage: tender.referenceSourcePage ?? referenceFallback?.page ?? null,
      referenceSourceQuote: tender.referenceSourceQuote ?? referenceFallback?.quote ?? null,
    });
    const emailCandidate = candidates.find((candidate) => candidate.semanticKey === "submissionEmails");
    if (emailCandidate) {
      emailCandidate.sourceFileId = tender.submissionEmailSourceFileId;
      emailCandidate.sourcePage = tender.submissionEmailSourcePage;
      emailCandidate.sourceQuote = tender.submissionEmailSourceQuote;
    }
    const addressCandidate = candidates.find((candidate) => candidate.semanticKey === "submissionAddress");
    if (addressCandidate) {
      addressCandidate.sourceFileId = tender.submissionAddressSourceFileId;
      addressCandidate.sourcePage = tender.submissionAddressSourcePage;
      addressCandidate.sourceQuote = tender.submissionAddressSourceQuote;
    }
    if (tender.submissionEmailSubject) {
      candidates.push({
        semanticKey: "submissionEmailSubject",
        displayLabel: "Submission Email Subject",
        category: "submission",
        valueType: "TEXT",
        normalizedValue: tender.submissionEmailSubject,
        rawSourceValue: tender.submissionEmailSubject,
        relevance: "critical",
        sourceFileId: tender.submissionEmailSubjectSourceFileId,
        sourcePage: tender.submissionEmailSubjectSourcePage,
        sourceQuote: tender.submissionEmailSubjectSourceQuote,
      });
    }

    const activeFiles = new Map(tender.files.map((file) => [file.id, file]));
    let synced = 0;
    let grounded = 0;
    let ungroundedCandidates = 0;
    let skipped = 0;

    for (const candidate of candidates) {
      if (isPlaceholderIsh(candidate.normalizedValue)) {
        skipped++;
        continue;
      }

      const existing = await tx.tenderFactsLedger.findUnique({
        where: { tenderId_semanticKey: { tenderId, semanticKey: candidate.semanticKey } },
        select: { authorityState: true },
      });
      const existingState = existing?.authorityState.toUpperCase() ?? null;
      if (
        existingState === AUTHORITY_STATE.USER_CONFIRMED ||
        existingState === AUTHORITY_STATE.NOT_APPLICABLE
      ) {
        skipped++;
        continue;
      }

      const file = candidate.sourceFileId ? activeFiles.get(candidate.sourceFileId) : null;
      const provenPage = file && candidate.sourceQuote
        ? locateQuoteProvenPage(file.extractedText ?? "", candidate.sourceQuote, file.totalPages)
        : null;
      const hasEvidence =
        Boolean(file) &&
        candidate.sourcePage !== null &&
        candidate.sourcePage !== undefined &&
        provenPage === candidate.sourcePage;
      if (existingState === AUTHORITY_STATE.SOURCE_GROUNDED_CONFIRMED && !hasEvidence) {
        skipped++;
        continue;
      }

      const authorityState = hasEvidence
        ? AUTHORITY_STATE.SOURCE_GROUNDED_CONFIRMED
        : AUTHORITY_STATE.CANDIDATE_NEEDS_REVIEW;
      await tx.tenderFactsLedger.upsert({
        where: { tenderId_semanticKey: { tenderId, semanticKey: candidate.semanticKey } },
        create: {
          tenderId,
          semanticKey: candidate.semanticKey,
          displayLabel: candidate.displayLabel,
          category: candidate.category,
          valueType: candidate.valueType,
          normalizedValue: candidate.normalizedValue,
          rawSourceValue: candidate.rawSourceValue,
          authorityState,
          confidence: hasEvidence ? 0.9 : 0.5,
          relevance: candidate.relevance,
          applicability: "applies",
          sourceFileId: hasEvidence ? candidate.sourceFileId : null,
          sourcePage: hasEvidence ? candidate.sourcePage : null,
          sourceQuote: hasEvidence ? candidate.sourceQuote : null,
          sourceContentHash: hasEvidence ? file?.contentSha256 ?? file?.contentHash ?? null : null,
          reviewState: "pending",
          manuallyEntered: false,
          createdBy: userId,
        },
        update: {
          displayLabel: candidate.displayLabel,
          category: candidate.category,
          valueType: candidate.valueType,
          normalizedValue: candidate.normalizedValue,
          rawSourceValue: candidate.rawSourceValue,
          authorityState,
          confidence: hasEvidence ? 0.9 : 0.5,
          relevance: candidate.relevance,
          sourceFileId: hasEvidence ? candidate.sourceFileId : null,
          sourcePage: hasEvidence ? candidate.sourcePage : null,
          sourceQuote: hasEvidence ? candidate.sourceQuote : null,
          sourceContentHash: hasEvidence ? file?.contentSha256 ?? file?.contentHash ?? null : null,
        },
      });
      synced++;
      if (hasEvidence) grounded++;
      else ungroundedCandidates++;
    }

    return { synced, grounded, candidates: ungroundedCandidates, skipped };
  }, { isolationLevel: "Serializable", timeout: 10_000 });

  await logAction({
    userId,
    action: "TENDER_FACT_LEDGER_SYNC",
    entityType: "Tender",
    entityId: tenderId,
    description: "Synchronized persisted tender facts into the canonical authority ledger",
    metadata: result,
  }).catch(() => {});
  return result;
}

/**
 * Check if a value is placeholder-ish (Not, N/A, Unknown, TBD, etc.)
 */
function isPlaceholderIsh(value: string | null | undefined): boolean {
  if (!value || typeof value !== "string") return true;
  const trimmed = value.trim();
  if (trimmed.length === 0) return true;
  // Check placeholder patterns via the shared validator
  if (containsMetadataPlaceholder(trimmed)) return true;
  // Short single-word values with no digits
  if (trimmed.length <= 4 && !/\d/.test(trimmed)) return true;
  // Common placeholder strings
  const lower = trimmed.toLowerCase();
  const placeholders = ["not", "n/a", "na", "tbd", "tbc", "tba", "unknown", "none", "null",
    "not available", "not provided", "not specified", "not stated", "not mentioned",
    "not applicable", "nil", "blank", "pending", "placeholder"];
  if (placeholders.includes(lower)) return true;
  return false;
}

// ─── Audit helper ────────────────────────────────────────────────────────────

async function auditLedgerMutation(
  tenderId: string,
  semanticKey: string,
  action: string,
  userId: string,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await logAction({
      userId,
      action: "TENDER_METADATA_OVERRIDE",
      entityType: "TenderFactsLedger",
      entityId: `${tenderId}:${semanticKey}`,
      description: `Ledger ${action} for ${semanticKey} on tender ${tenderId}`,
      metadata: {
        tenderId,
        semanticKey,
        action,
        ...details,
      },
    });
  } catch {
    // Audit is best-effort — don't fail the mutation if audit fails
  }
}

// ─── Sync effective facts to ledger ──────────────────────────────────────────

export type SyncEffectiveFactsOptions = {
  /** When true, overwrite existing CANDIDATE_NEEDS_REVIEW facts. Default false. */
  overwriteCandidates?: boolean;
  /** User ID for audit logging */
  userId: string;
};

export type SyncEffectiveFactsResult = {
  synced: number;
  skipped: number;
  errors: string[];
};

/**
 * Sync parser-derived effective facts to the TenderFactsLedger.
 *
 * Rules:
 *   • Do NOT overwrite USER_CONFIRMED / USER_EDITED / NOT_APPLICABLE facts
 *   • Do NOT write placeholder values
 *   • Write parser-derived facts as CANDIDATE_NEEDS_REVIEW if no evidence
 *   • Write parser-derived facts as SOURCE_GROUNDED_CONFIRMED only when
 *     source file + page + quote evidence exists
 *   • Idempotent: upsert by (tenderId, semanticKey)
 */
export async function syncEffectiveFactsToLedger(
  prismaClient: PrismaClient,
  tenderId: string,
  effectiveFacts: { facts: Array<{ key: string; label: string; value: string | string[] | null; status: string; source: string; sourceFileId?: string | null; sourcePage?: number | null; sourceQuote?: string | null; }> },
  options: SyncEffectiveFactsOptions,
): Promise<SyncEffectiveFactsResult> {
  const { overwriteCandidates = false, userId } = options;
  let synced = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const fact of effectiveFacts.facts) {
    // Only sync facts resolved from source text (parser)
    if (fact.source !== "parser" || fact.status !== "resolved_from_source_text") continue;

    const value = Array.isArray(fact.value) ? fact.value.join(", ") : fact.value;
    if (!value || typeof value !== "string" || isPlaceholderIsh(value)) {
      skipped++;
      continue;
    }

    // Check existing ledger entry — skip if user-confirmed/edited/NA
    try {
      const existing = await (prismaClient as any).tenderFactsLedger.findUnique({
        where: { tenderId_semanticKey: { tenderId, semanticKey: fact.key } },
        select: { authorityState: true },
      });

      if (existing) {
        const ls = String(existing.authorityState).toUpperCase();
        // Never overwrite user-confirmed, user-edited, or not-applicable
        if (
          ls === "HUMAN_CONFIRMED_OPERATIONAL" ||
          ls === AUTHORITY_STATE.NOT_APPLICABLE ||
          ls === AUTHORITY_STATE.SOURCE_GROUNDED_CONFIRMED
        ) {
          skipped++;
          continue;
        }
        // Skip existing CANDIDATE_NEEDS_REVIEW unless overwrite is requested
        if (ls === AUTHORITY_STATE.CANDIDATE_NEEDS_REVIEW && !overwriteCandidates) {
          skipped++;
          continue;
        }
      }

      // Determine authority state: SOURCE_GROUNDED_CONFIRMED if evidence exists,
      // otherwise CANDIDATE_NEEDS_REVIEW
      const hasEvidence = !!(
        fact.sourceFileId &&
        fact.sourcePage !== null &&
        fact.sourcePage !== undefined &&
        fact.sourceQuote
      );
      const authorityState = hasEvidence
        ? AUTHORITY_STATE.SOURCE_GROUNDED_CONFIRMED
        : AUTHORITY_STATE.CANDIDATE_NEEDS_REVIEW;

      await (prismaClient as any).tenderFactsLedger.upsert({
        where: { tenderId_semanticKey: { tenderId, semanticKey: fact.key } },
        create: {
          tenderId,
          semanticKey: fact.key,
          displayLabel: fact.label,
          category: "procuring-entity", // Default; can be refined
          valueType: "TEXT",
          normalizedValue: value,
          rawSourceValue: value,
          authorityState,
          confidence: hasEvidence ? 0.9 : 0.5,
          relevance: "informational",
          applicability: "applies",
          sourceFileId: hasEvidence ? fact.sourceFileId : null,
          sourcePage: hasEvidence ? fact.sourcePage ?? null : null,
          sourceQuote: hasEvidence ? fact.sourceQuote ?? null : null,
          reviewState: "pending",
          manuallyEntered: false,
          createdBy: userId,
        },
        update: {
          normalizedValue: value,
          rawSourceValue: value,
          authorityState,
          confidence: hasEvidence ? 0.9 : 0.5,
          ...(hasEvidence ? { sourceFileId: fact.sourceFileId } : {}),
          ...(fact.sourcePage !== null && fact.sourcePage !== undefined ? { sourcePage: fact.sourcePage } : {}),
          ...(fact.sourceQuote ? { sourceQuote: fact.sourceQuote } : {}),
        },
      });

      synced++;
    } catch (err) {
      errors.push(`Failed to sync ${fact.key}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { synced, skipped, errors };
}

// Re-export for convenience
export { prisma, prismaReady };
