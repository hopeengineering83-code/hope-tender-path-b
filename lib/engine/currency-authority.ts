// Shared canonical currency authority helper.
//
// Per CHATGPT-M1 REVISION_REQUIRED (recheck 8):
//   1. Query errors must FAIL CLOSED — never silently remove the currency
//      blocker. If the authority lookup throws, return a
//      CURRENCY_AUTHORITY_UNAVAILABLE blocker.
//   2. Each source's query error must be distinguishable from "no decision"
//      and must block authority.
//   3. Timestamp ties need a deterministic tie-breaker (override > ledger).
//   4. CURRENT_FIELD_STATES must match the canonical resolver
//      (canonical-field-state.ts:68: USER_EDITED and USER_CONFIRMED).
//
// This helper is consumed by getFinalSubmissionReadiness. Pages and APIs
// that call getFinalSubmissionReadiness inherit the currency blocker
// automatically — they do NOT call this helper directly.

import type { PrismaClient } from "@prisma/client";

export type CurrencyAuthorityResult = {
  isNull: boolean;
  isVerified: boolean;
  isUnverified: boolean;
  /** True when the authority lookup itself failed (DB error, etc.). */
  isUnavailable: boolean;
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

const CURRENCY_UNAVAILABLE_BLOCKER = {
  category: "CURRENCY_AUTHORITY_UNAVAILABLE" as const,
  severity: "CRITICAL" as const,
  title: "Currency authority lookup failed — cannot verify currency provenance",
  recommendedAction:
    "The database query for currency override/ledger failed. Retry the operation or contact support if the error persists.",
};

// Matches canonical-field-state.ts:68:
//   if (override.fieldState !== "USER_EDITED" && override.fieldState !== "USER_CONFIRMED") return true;
// These are the only fieldState values that represent a CURRENT override.
const CURRENT_FIELD_STATES = new Set(["USER_EDITED", "USER_CONFIRMED"]);

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
} | null;

/**
 * Resolve the canonical currency authority for a tender.
 *
 * FAIL CLOSED: if either query throws, returns CURRENCY_AUTHORITY_UNAVAILABLE
 * (isUnavailable=true) which blocks authority. Never silently swallows errors.
 *
 * Cross-source precedence: the LATEST decision across both sources wins.
 * Timestamp ties are broken by source precedence: override > ledger.
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
      isUnavailable: false,
      display: "Not extracted",
      blockerCode: null,
      blocker: null,
    };
  }

  const upperCurrency = currency.toUpperCase().trim();

  // ── Query override (NO catch — fail closed on error) ──────────────
  let latestOverride: any = null;
  let overrideQueryFailed = false;
  try {
    latestOverride = await prisma.tenderMetadataOverride.findFirst({
      where: { tenderId, field: "currency" },
      select: {
        authorityClass: true,
        fieldState: true,
        overrideValue: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
    });
  } catch {
    overrideQueryFailed = true;
  }

  // ── Query ledger (NO catch — fail closed on error) ────────────────
  let latestLedgerFact: any = null;
  let ledgerQueryFailed = false;
  try {
    latestLedgerFact = await prisma.tenderFactsLedger.findFirst({
      where: { tenderId, semanticKey: "currency" },
      select: {
        authorityState: true,
        normalizedValue: true,
        sourceStatus: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
    });
  } catch {
    ledgerQueryFailed = true;
  }

  // ── Fail closed on query errors (item 1 + item 2) ─────────────────
  // If EITHER query failed, we cannot determine the latest decision
  // across both sources. The failed source may contain a newer
  // non-qualifying decision that would invalidate an older qualifying
  // one from the other source. Fail closed.
  if (overrideQueryFailed || ledgerQueryFailed) {
    return {
      isNull: false,
      isVerified: false,
      isUnverified: false,
      isUnavailable: true,
      display: "Authority unavailable",
      blockerCode: CURRENCY_UNAVAILABLE_BLOCKER.category,
      blocker: CURRENCY_UNAVAILABLE_BLOCKER,
    };
  }

  // ── Evaluate override decision ────────────────────────────────────
  const overrideDecision: ResolvedDecision = (() => {
    if (!latestOverride) return null;
    const authorityOk =
      latestOverride.authorityClass !== null &&
      QUALIFYING_OVERRIDE_CLASSES.has(latestOverride.authorityClass);
    // fieldState check matches canonical-field-state.ts:68
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
    };
  })();

  // ── Cross-source precedence (item 3: deterministic tie-breaker) ───
  // Sort by updatedAt desc. On equal timestamps, override > ledger
  // (override is a direct user action; ledger is derived).
  const allDecisions = [overrideDecision, ledgerDecision].filter(
    (d): d is NonNullable<typeof d> => d !== null,
  );

  if (allDecisions.length === 0) {
    return {
      isNull: false,
      isVerified: false,
      isUnverified: true,
      isUnavailable: false,
      display: "Unverified legacy value",
      blockerCode: CURRENCY_BLOCKER.category,
      blocker: CURRENCY_BLOCKER,
    };
  }

  allDecisions.sort((a, b) => {
    const timeDiff = b.updatedAt.getTime() - a.updatedAt.getTime();
    if (timeDiff !== 0) return timeDiff;
    // Tie-breaker: override (source "override") > ledger (source "ledger")
    if (a.source === "override" && b.source === "ledger") return -1;
    if (a.source === "ledger" && b.source === "override") return 1;
    return 0;
  });
  const latestDecision = allDecisions[0];

  if (latestDecision.qualifies) {
    return {
      isNull: false,
      isVerified: true,
      isUnverified: false,
      isUnavailable: false,
      display: currency,
      blockerCode: null,
      blocker: null,
    };
  }

  return {
    isNull: false,
    isVerified: false,
    isUnverified: true,
    isUnavailable: false,
    display: "Unverified legacy value",
    blockerCode: CURRENCY_BLOCKER.category,
    blocker: CURRENCY_BLOCKER,
  };
}

export const CURRENCY_UNVERIFIED_BLOCKER = CURRENCY_BLOCKER;
export const CURRENCY_AUTHORITY_UNAVAILABLE_BLOCKER = CURRENCY_UNAVAILABLE_BLOCKER;
