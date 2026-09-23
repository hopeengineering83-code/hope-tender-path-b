// Defensive: nullify any stored tender metadata that fails the canonical
// validators BEFORE the engine pipeline / proposal generation reads it.
//
// WHY THIS LAYER EXISTS
// ─────────────────────
// PR #368 added validators to inferTenderMetadata so NEW extractions
// reject TOC fragments / non-whitelist countries / stop-word references
// / contact-fragment strings. Commit 7688111 made the Re-extract route
// overwrite previously-stored invalid values when the user clicks
// "Clean now".
//
// But many engine code paths read tender.{reference, clientName, country,
// clientContactName} DIRECTLY and concatenate them into AI prompts,
// theme-detection text, generated cover letters, and reference labels.
// If a tender is loaded BEFORE the user runs the cleanup banner, those
// downstream readers see the garbage values:
//
//   lib/engine/proposal-intelligence.ts:730
//     tenderText = textOf(tender.title, tender.reference, tender.clientName, …)
//     // garbage flows into theme detection
//   lib/engine/generate-elite.ts:2122
//     reference: tender.reference   // garbage in generated cover letter
//   lib/engine/proposal-intelligence-contract.ts:304
//     `Client: ${contract.tender.clientName}` // garbage in AI prompt
//
// FIX (defense in depth)
// ──────────────────────
// `sanitizeStoredMetadataForEngine(tender)` returns a NEW object with
// invalid fields replaced by `null`. Engine routes call this once before
// the pipeline so every downstream reader sees clean data — either a
// validated string or `null`, never a TOC fragment or stop-word.
//
// `computeStoredMetadataPatch(tender)` returns a partial prisma update
// payload listing only the invalid fields with `null` values. Engine
// routes optionally apply this patch to PERSIST the cleanup, so a
// second engine run sees the cleaned DB row directly.
//
// This is intentionally a SEPARATE concern from the Re-extract route,
// which tries to RECOVER a valid value from the stored PDF text.
// Sanitize-on-engine is more defensive: it never invents values, only
// nullifies invalid ones, so it's safe to run unconditionally.

import {
  isValidClientName,
  isValidReferenceNumber,
  isValidCountry,
  isValidClientContact,
  containsMetadataPlaceholder,
  containsMetadataScaffolding,
} from "./metadata-validators";

/**
 * Wraps a validator so any value containing an internal placeholder
 * ("Bid-Team to confirm", "TBC", "placeholder", …) is rejected even if
 * the validator would otherwise accept it. The screenshot regression
 * showed "Bid-Team to confirm" leaking from metadata into the generated
 * cover letter because the field passed the basic validator. This
 * defends against that.
 */
function withPlaceholderRejection(validator: (v: string | null | undefined) => boolean): (v: string | null | undefined) => boolean {
  return (value) => {
    if (containsMetadataPlaceholder(value) || containsMetadataScaffolding(value)) return false;
    return validator(value);
  };
}

export type StoredMetadataLike = {
  reference?: string | null;
  clientName?: string | null;
  country?: string | null;
  clientContactName?: string | null;
  procuringEntityName?: string | null;
  legalClientName?: string | null;
  donorAgency?: string | null;
  implementingAgency?: string | null;
  // Free-text location fields. They have no format validator -- an address is
  // whatever the tender says it is -- so they are checked ONLY for placeholders
  // and extractor scaffolding. See the note on ADDRESS_LIKE_FIELDS below.
  submissionAddress?: string | null;
  clientAddress?: string | null;
  clientCity?: string | null;
  preBidMeetingLocation?: string | null;
  preBidChannel?: string | null;
  submissionEmailSubject?: string | null;
  clientRepresentative?: string | null;
};

/**
 * Fields with no format validator, cleaned on contamination alone.
 *
 * THE DEFECT THIS FIXES. This module's whole purpose is "nullify any stored
 * tender metadata that fails the canonical validators", and
 * `containsMetadataScaffolding` is imported here and used here -- but only
 * through `withPlaceholderRejection`, which wraps the eight NAME-shaped fields.
 * Nothing address-shaped was covered.
 *
 * On the exact-head Preview (tender d2b85e2a) that was the entire reason the
 * ZIP was locked: "Submission address", "Client address" and "Pre-bid meeting
 * location" each held a multi-field extraction worksheet. The export gate
 * refused them, and this cleanup -- the one path that exists to clear exactly
 * that -- could not see them.
 *
 * An address has no shape to validate against, so these are judged ONLY by the
 * two contamination checks. A legitimate address is never touched; a worksheet
 * or a placeholder becomes null, which is MISSING_SOURCE and recoverable by
 * manual confirmation, as CLAUDE.md requires.
 */
const ADDRESS_LIKE_FIELDS = [
  "submissionAddress",
  "clientAddress",
  "clientCity",
  "preBidMeetingLocation",
  "preBidChannel",
  "submissionEmailSubject",
  "clientRepresentative",
] as const satisfies readonly (keyof StoredMetadataLike)[];

/** True when a free-text value is a placeholder or extractor scaffolding. */
export function isContaminatedFreeText(value: string | null | undefined): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  return containsMetadataPlaceholder(value) || containsMetadataScaffolding(value);
}

/**
 * Returns a clean view of the tender's metadata fields. Invalid values
 * (TOC fragments, stop-words, non-whitelist countries, contact
 * fragments) are replaced with `null`. Valid values are returned as-is.
 *
 * Caller can spread this over the tender object to get a "clean" tender:
 *
 *     const cleanTender = { ...tender, ...sanitizeStoredMetadataForEngine(tender) };
 */
export function sanitizeStoredMetadataForEngine<T extends StoredMetadataLike>(tender: T): StoredMetadataLike {
  return {
    reference: validOrNull(tender.reference, withPlaceholderRejection(isValidReferenceNumber)),
    clientName: validOrNull(tender.clientName, withPlaceholderRejection(isValidClientName)),
    country: validOrNull(tender.country, withPlaceholderRejection(isValidCountry)),
    clientContactName: validOrNull(tender.clientContactName, withPlaceholderRejection(isValidClientContact)),
    procuringEntityName: validOrNull(tender.procuringEntityName, withPlaceholderRejection(isValidClientName)),
    legalClientName: validOrNull(tender.legalClientName, withPlaceholderRejection(isValidClientName)),
    donorAgency: validOrNull(tender.donorAgency, withPlaceholderRejection(isValidClientName)),
    implementingAgency: validOrNull(tender.implementingAgency, withPlaceholderRejection(isValidClientName)),
    ...Object.fromEntries(
      ADDRESS_LIKE_FIELDS.map((field) => [field, isContaminatedFreeText(tender[field]) ? null : tender[field] ?? null]),
    ),
  };
}

/**
 * Returns a Prisma-update-shaped partial containing ONLY the fields
 * whose stored value is invalid. Caller can apply this with
 * `prisma.tender.update({ where, data: patch })` to persist the
 * nullification — only invalid fields are touched, valid ones are not
 * included in the payload at all.
 *
 * Returns an empty object when nothing needs cleaning; caller can skip
 * the DB write in that case.
 */
export function computeStoredMetadataPatch(tender: StoredMetadataLike): Partial<Record<keyof StoredMetadataLike, null>> {
  const patch: Partial<Record<keyof StoredMetadataLike, null>> = {};
  if (hasInvalidValue(tender.reference, withPlaceholderRejection(isValidReferenceNumber))) patch.reference = null;
  if (hasInvalidValue(tender.clientName, withPlaceholderRejection(isValidClientName))) patch.clientName = null;
  if (hasInvalidValue(tender.country, withPlaceholderRejection(isValidCountry))) patch.country = null;
  if (hasInvalidValue(tender.clientContactName, withPlaceholderRejection(isValidClientContact))) patch.clientContactName = null;
  if (hasInvalidValue(tender.procuringEntityName, withPlaceholderRejection(isValidClientName))) patch.procuringEntityName = null;
  if (hasInvalidValue(tender.legalClientName, withPlaceholderRejection(isValidClientName))) patch.legalClientName = null;
  if (hasInvalidValue(tender.donorAgency, withPlaceholderRejection(isValidClientName))) patch.donorAgency = null;
  if (hasInvalidValue(tender.implementingAgency, withPlaceholderRejection(isValidClientName))) patch.implementingAgency = null;
  for (const field of ADDRESS_LIKE_FIELDS) {
    if (isContaminatedFreeText(tender[field])) patch[field] = null;
  }
  return patch;
}

/**
 * Convenience: returns the list of field names that would be cleaned
 * for audit / logging purposes.
 */
export function listInvalidStoredFields(tender: StoredMetadataLike): string[] {
  const out: string[] = [];
  if (hasInvalidValue(tender.reference, withPlaceholderRejection(isValidReferenceNumber))) out.push("reference");
  if (hasInvalidValue(tender.clientName, withPlaceholderRejection(isValidClientName))) out.push("clientName");
  if (hasInvalidValue(tender.country, withPlaceholderRejection(isValidCountry))) out.push("country");
  if (hasInvalidValue(tender.clientContactName, withPlaceholderRejection(isValidClientContact))) out.push("clientContactName");
  if (hasInvalidValue(tender.procuringEntityName, withPlaceholderRejection(isValidClientName))) out.push("procuringEntityName");
  if (hasInvalidValue(tender.legalClientName, withPlaceholderRejection(isValidClientName))) out.push("legalClientName");
  if (hasInvalidValue(tender.donorAgency, withPlaceholderRejection(isValidClientName))) out.push("donorAgency");
  if (hasInvalidValue(tender.implementingAgency, withPlaceholderRejection(isValidClientName))) out.push("implementingAgency");
  // The address-like fields are cleaned by computeStoredMetadataPatch but were
  // never LISTED here, and both callers only apply the patch when this list is
  // non-empty. So a contaminated submission address on an otherwise-valid
  // tender was never cleaned: on 2026-09-23 Run Engine completed and every
  // downstream stage paused on "Field \"Submission address\": Value contains
  // extractor field-label scaffolding" — the very value this module exists to
  // clear. Listing and patching now name the same fields.
  for (const field of ADDRESS_LIKE_FIELDS) {
    if (isContaminatedFreeText(tender[field])) out.push(field);
  }
  return out;
}

// ─── Internals ──────────────────────────────────────────────────────

function validOrNull(value: string | null | undefined, validator: (v: string | null | undefined) => boolean): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return validator(trimmed) ? trimmed : null;
}

function hasInvalidValue(value: string | null | undefined, validator: (v: string | null | undefined) => boolean): boolean {
  if (value === null || value === undefined) return false; // null is fine
  const trimmed = value.trim();
  if (trimmed === "") return false; // empty string acts like null
  return !validator(trimmed);
}
