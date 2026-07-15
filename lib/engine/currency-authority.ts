// Shared canonical currency authority helper.
//
// Per CHATGPT-M1 REVISION_REQUIRED (recheck 7): this helper must be
// integrated into getFinalSubmissionReadiness so every page/API consumes
// the same CURRENCY_UNVERIFIED blocker from the canonical server readiness
// object — not just the report page.
//
// Decision precedence (item 2): the LATEST decision across BOTH sources
// (override + ledger) wins. A newer non-authoritative decision invalidates
// an older authoritative one. We compare by updatedAt timestamp.
//
// fieldState (item 3): the override's fieldState is evaluated. Only
// USER_EDITED and USER_CONFIRMED are current; MISSING, NOT_APPLICABLE,
// IGNORED_WITH_REASON, and REJECTED are non-current and fail closed.
//
// Comment accuracy (item 4): this helper is consumed by
// getFinalSubmissionReadiness (the canonical server readiness object).
// Individual pages/APIs that call getFinalSubmissionReadiness inherit
// the currency blocker automatically — they do NOT call this helper
// directly.

import type { PrismaClient } from "@prisma/client";

export type CurrencyAuthorityResult = {
  isNull: boolean;
  isVerified: boolean;
  isUnverified: boolean;
  display: string;
  blockerCode: string | null;
  blocker: {
    category: string;
    severity: string;
    title: string;
    recommendedAction: string;
  } | null;
};

const CURRENCY_BLOCKER = {
  category: "CURRENCY_UNVERIFIED" as const,
  severity: "HIGH" as const,
  title: "Currency value lacks source provenance or explicit user confirmation",
  recommendedAction:
    "Confirm the currency via the metadata override panel with a source quote, or clear it to 'Not extracted'.",
};

// Only these fieldState values represent a CURRENT override decision.
// MISSING, NOT_APPLICABLE, IGNORED_WITH_REASON, and REJECTED are non-current.
const CURRENT_FIELD_STATES = new Set(["USER_EDITED", "USER_CONFIRMED"]);

// Only these authority classes/states represent confirmed authority.
const QUALIFYING_OVERRIDE_CLASSES = new Set([
  "SOURCE_GROUNDED_CONFIRMED",
  "HUMAN_CONFIRMED_OPERATIONAL",
]);
const QUALIFYING_LEDGER_STATES = new Set([
  "SOURCE_GROUNDED_CONFIRMED",
  "HUMAN_CONFIRMED_OPERATIONAL",
]);

type DecisionSource = "override" | "ledger";

type ResolvedDecision = {
  source: DecisionSource;
  updatedAt: Date;
  qualifies: boolean;
  valueMatches: boolean;
} | null;

/**
 * Resolve the canonical currency authority for a tender.
 *
 * Decision precedence: the LATEST decision across BOTH sources (override
 * + ledger) wins. A newer non-qualifying decision (e.g., REJECTED_CANDIDATE)
 * invalidates an older qualifying one — fail closed for currentness.
 *
 * This helper is consumed by getFinalSubmissionReadiness. Pages and APIs
 * that call getFinalSubmissionReadiness inherit the currency blocker
 * automatically.
 */
export async function resolveCurrencyAuthority(
  prisma: PrismaClient,
  tenderId: string,
  currency: string | null | undefined,
): Promise<CurrencyAuthorityResult> {
  if (!currency) {
    return {
      isNull: true,
      isVerified: false,
      isUnverified: false,
      display: "Not extracted",
      blockerCode: null,
      blocker: null,
    };
  }

  const upperCurrency = currency.toUpperCase().trim();

  // ── Resolve the LATEST override decision ──────────────────────────
  // Query ALL overrides (not just qualifying ones) so the latest
  // non-qualifying decision takes precedence over older qualifying ones.
  const latestOverride = await prisma.tenderMetadataOverride.findFirst({
    where: { tenderId, field: "currency" },
    select: {
      authorityClass: true,
      fieldState: true,
      overrideValue: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
  }).catch(() => null);

  // ── Resolve the LATEST ledger decision ────────────────────────────
  const latestLedgerFact = await prisma.tenderFactsLedger.findFirst({
    where: { tenderId, semanticKey: "currency" },
    select: {
      authorityState: true,
      normalizedValue: true,
      sourceStatus: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
  }).catch(() => null);

  // ── Evaluate override decision (item 3: fieldState) ──────────────
  // The override qualifies ONLY when:
  //   - authorityClass is in QUALIFYING_OVERRIDE_CLASSES
  //   - fieldState is in CURRENT_FIELD_STATES (not cleared/revoked/superseded)
  //   - overrideValue matches tender.currency (value-bound)
  const overrideDecision: ResolvedDecision = (() => {
    if (!latestOverride) return null;
    const authorityOk =
      latestOverride.authorityClass !== null &&
      QUALIFYING_OVERRIDE_CLASSES.has(latestOverride.authorityClass);
    const fieldStateOk =
      latestOverride.fieldState !== null &&
      CURRENT_FIELD_STATES.has(latestOverride.fieldState);
    const valueOk =
      latestOverride.overrideValue !== null &&
      latestOverride.overrideValue.toUpperCase().trim() === upperCurrency;
    return {
      source: "override" as DecisionSource,
      updatedAt: latestOverride.updatedAt,
      qualifies: authorityOk && fieldStateOk && valueOk,
      valueMatches: valueOk,
    };
  })();

  // ── Evaluate ledger decision ──────────────────────────────────────
  const ledgerDecision: ResolvedDecision = (() => {
    if (!latestLedgerFact) return null;
    const authorityOk =
      latestLedgerFact.authorityState !== null &&
      QUALIFYING_LEDGER_STATES.has(latestLedgerFact.authorityState);
    const sourceActive = latestLedgerFact.sourceStatus === "active";
    const valueOk =
      latestLedgerFact.normalizedValue !== null &&
      latestLedgerFact.normalizedValue.toUpperCase().trim() === upperCurrency;
    return {
      source: "ledger" as DecisionSource,
      updatedAt: latestLedgerFact.updatedAt,
      qualifies: authorityOk && sourceActive && valueOk,
      valueMatches: valueOk,
    };
  })();

  // ── Cross-source precedence (item 2) ──────────────────────────────
  // The LATEST decision across both sources wins. A newer non-qualifying
  // decision invalidates an older qualifying one.
  const allDecisions = [overrideDecision, ledgerDecision].filter(
    (d): d is NonNullable<typeof d> => d !== null,
  );

  if (allDecisions.length === 0) {
    // No decisions at all → unverified
    return {
      isNull: false,
      isVerified: false,
      isUnverified: true,
      display: "Unverified legacy value",
      blockerCode: CURRENCY_BLOCKER.category,
      blocker: CURRENCY_BLOCKER,
    };
  }

  // Sort by updatedAt desc — latest decision first
  allDecisions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const latestDecision = allDecisions[0];

  // The latest decision determines authority. If the latest is qualifying,
  // currency is verified. If the latest is non-qualifying (even if an older
  // decision was qualifying), currency is unverified — fail closed.
  if (latestDecision.qualifies) {
    return {
      isNull: false,
      isVerified: true,
      isUnverified: false,
      display: currency,
      blockerCode: null,
      blocker: null,
    };
  }

  return {
    isNull: false,
    isVerified: false,
    isUnverified: true,
    display: "Unverified legacy value",
    blockerCode: CURRENCY_BLOCKER.category,
    blocker: CURRENCY_BLOCKER,
  };
}

export const CURRENCY_UNVERIFIED_BLOCKER = CURRENCY_BLOCKER;
