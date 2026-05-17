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
} from "./metadata-validators";

export type StoredMetadataLike = {
  reference?: string | null;
  clientName?: string | null;
  country?: string | null;
  clientContactName?: string | null;
};

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
    reference: validOrNull(tender.reference, isValidReferenceNumber),
    clientName: validOrNull(tender.clientName, isValidClientName),
    country: validOrNull(tender.country, isValidCountry),
    clientContactName: validOrNull(tender.clientContactName, isValidClientContact),
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
export function computeStoredMetadataPatch(tender: StoredMetadataLike): {
  reference?: null;
  clientName?: null;
  country?: null;
  clientContactName?: null;
} {
  const patch: Record<string, null> = {};
  if (hasInvalidValue(tender.reference, isValidReferenceNumber)) patch.reference = null;
  if (hasInvalidValue(tender.clientName, isValidClientName)) patch.clientName = null;
  if (hasInvalidValue(tender.country, isValidCountry)) patch.country = null;
  if (hasInvalidValue(tender.clientContactName, isValidClientContact)) patch.clientContactName = null;
  return patch;
}

/**
 * Convenience: returns the list of field names that would be cleaned
 * for audit / logging purposes.
 */
export function listInvalidStoredFields(tender: StoredMetadataLike): string[] {
  const out: string[] = [];
  if (hasInvalidValue(tender.reference, isValidReferenceNumber)) out.push("reference");
  if (hasInvalidValue(tender.clientName, isValidClientName)) out.push("clientName");
  if (hasInvalidValue(tender.country, isValidCountry)) out.push("country");
  if (hasInvalidValue(tender.clientContactName, isValidClientContact)) out.push("clientContactName");
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
