// Shared canonical currency authority helper.
//
// Per CHATGPT-M1 REVISION_REQUIRED (recheck 6): the value-bound currency
// decision must live in ONE shared server helper, not reimplemented in each
// UI page. Every consumer (report page, export page, documents page, download
// API, export-readiness API) must call this helper and get the same
// CURRENCY_UNVERIFIED code.
//
// The helper:
//   1. Resolves the LATEST field decision for currency (override + ledger).
//      A newer cleared/revoked/superseding decision takes precedence over an
//      older qualifying row. Fails closed when the latest decision is no
//      longer current (per item 2).
//   2. Binds the authority value to the current tender.currency (value-bound,
//      per item 1 of recheck 5). A stale EUR authority cannot verify a later
//      USD value.
//   3. Accepts only SOURCE_GROUNDED_CONFIRMED and HUMAN_CONFIRMED_OPERATIONAL
//      (per item 2 of recheck 5). Bare SOURCE_GROUNDED is NOT enough.
//   4. Returns a canonical CurrencyAuthorityResult with a CURRENCY_UNVERIFIED
//      blocker code that all surfaces consume.

import type { PrismaClient } from "@prisma/client";

export type CurrencyAuthorityResult = {
  /** True when the tender.currency is null (not extracted) — not a blocker. */
  isNull: boolean;
  /** True when the currency is non-null AND has a value-bound confirmed authority. */
  isVerified: boolean;
  /** True when the currency is non-null but lacks value-bound confirmed authority. */
  isUnverified: boolean;
  /** The display string for the currency field. */
  display: string;
  /** The canonical blocker code, if unverified. Null when verified or null. */
  blockerCode: string | null;
  /** The canonical blocker object, if unverified. Null when verified or null. */
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

/**
 * Resolve the canonical currency authority for a tender.
 *
 * This is the SINGLE source of truth for whether a tender's currency is
 * verified, unverified, or not-extracted. All UI pages and API routes
 * must call this helper — do NOT reimplement the logic locally.
 *
 * @param prisma - Prisma client
 * @param tenderId - Tender ID
 * @param currency - The current tender.currency value (null = not extracted)
 * @returns CurrencyAuthorityResult
 */
export async function resolveCurrencyAuthority(
  prisma: PrismaClient,
  tenderId: string,
  currency: string | null | undefined,
): Promise<CurrencyAuthorityResult> {
  // Null currency → "Not extracted" — not a blocker, not unverified.
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

  // ── Resolve the LATEST override decision (item 2: currentness) ──────
  // Query ALL overrides for field='currency' ordered by updatedAt desc.
  // The LATEST row wins. If the latest row has a non-qualifying
  // authorityClass (e.g., REJECTED_CANDIDATE, NOT_STATED_IN_SOURCE),
  // the currency is unverified — even if an older qualifying row exists.
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

  // ── Resolve the LATEST ledger fact (item 3: ledger currentness) ─────
  // Query ALL ledger facts for semanticKey='currency' ordered by updatedAt desc.
  // The LATEST active fact wins. If the latest fact has a non-qualifying
  // authorityState, the currency is unverified.
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

  // ── Determine which (if any) latest decision qualifies ──────────────
  // Only SOURCE_GROUNDED_CONFIRMED and HUMAN_CONFIRMED_OPERATIONAL are
  // accepted (per recheck 5 item 2). Bare SOURCE_GROUNDED is NOT enough.
  const QUALIFYING_OVERRIDE_CLASSES = new Set([
    "SOURCE_GROUNDED_CONFIRMED",
    "HUMAN_CONFIRMED_OPERATIONAL",
  ]);
  const QUALIFYING_LEDGER_STATES = new Set([
    "SOURCE_GROUNDED_CONFIRMED",
    "HUMAN_CONFIRMED_OPERATIONAL",
  ]);

  const overrideQualifies =
    latestOverride !== null &&
    latestOverride.authorityClass !== null &&
    QUALIFYING_OVERRIDE_CLASSES.has(latestOverride.authorityClass);

  const ledgerQualifies =
    latestLedgerFact !== null &&
    latestLedgerFact.sourceStatus === "active" &&
    latestLedgerFact.authorityState !== null &&
    QUALIFYING_LEDGER_STATES.has(latestLedgerFact.authorityState);

  // ── Value-bound check (item 1 of recheck 5) ────────────────────────
  // The authority value must match the current tender.currency.
  // A stale EUR authority cannot verify a later USD value.
  const upperCurrency = currency.toUpperCase().trim();

  const overrideValueMatches = (() => {
    if (!overrideQualifies) return false;
    if (!latestOverride?.overrideValue) return false;
    return latestOverride.overrideValue.toUpperCase().trim() === upperCurrency;
  })();

  const ledgerValueMatches = (() => {
    if (!ledgerQualifies) return false;
    if (!latestLedgerFact?.normalizedValue) return false;
    return latestLedgerFact.normalizedValue.toUpperCase().trim() === upperCurrency;
  })();

  const isVerified = overrideValueMatches || ledgerValueMatches;

  if (isVerified) {
    return {
      isNull: false,
      isVerified: true,
      isUnverified: false,
      display: currency,
      blockerCode: null,
      blocker: null,
    };
  }

  // Unverified: non-null currency without a value-bound confirmed authority.
  return {
    isNull: false,
    isVerified: false,
    isUnverified: true,
    display: "Unverified legacy value",
    blockerCode: CURRENCY_BLOCKER.category,
    blocker: CURRENCY_BLOCKER,
  };
}

/**
 * The canonical CURRENCY_UNVERIFIED blocker object.
 * Consumers should use this directly when adding the blocker to a list.
 */
export const CURRENCY_UNVERIFIED_BLOCKER = CURRENCY_BLOCKER;
