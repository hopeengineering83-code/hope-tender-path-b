// Proactive banner — surfaces stored tender details that fail the
// canonical validators (corrupted from an extraction that pre-dates the
// validator rules). Repair is now automatic — no button needed.
//
// WHY THIS EXISTS
// ───────────────
// Without this banner, corrupted values (reference="only",
// country="A ddis Ababa", clientName=TOC fragment, contact="s Contact
// Person") could persist for weeks because the user simply didn't
// realise the extractor would fix them.
//
// Server-side detection here means we ALWAYS surface the problem
// loudly at the top of the page when ANY of the four validated fields
// is in an invalid state. The automatic repair workflow re-runs the
// extractor, overwrites the invalid values, and the banner detects
// no remaining corruption on the next render, and disappears.
//
// SCOPE RULE (source-driven model)
// ─────────────────────────────────
// This banner surfaces only GENUINELY CORRUPTED values — TOC fragments,
// portal text, OCR noise — not placeholder-ish short values like "Not",
// "TBD", "N/A", "Unknown". Those placeholder values are already hidden
// by the TenderIntakeDetailPanel's sanitizer (shown as "Not extracted")
// and do NOT block draft generation. Showing them here as "corrupted"
// would be misleading and would trigger automatic repair when
// the value is simply missing/placeholder, not corrupted.

import {
  isValidClientName,
  isValidReferenceNumber,
  isValidCountry,
  isValidClientContact,
  containsMetadataPlaceholder,
} from "../lib/engine/metadata-validators";
import { RepairTenderFactsButton } from "./clean-corrupted-metadata-button";

type TenderShape = {
  id: string;
  reference: string | null;
  clientName: string | null;
  procuringEntityName?: string | null;
  country: string | null;
  clientContactName: string | null;
};

/**
 * A value is "placeholder-ish" (not corrupted) when it is short AND
 * matches a placeholder/negative pattern. These values are hidden by
 * the Tender Detail panel's sanitizer as "Not extracted" and must NOT
 * trigger the corrupted-metadata banner.
 *
 * This function handles all common placeholder variants including
 * invisible whitespace (NBSP \u00A0), trailing/leading spaces, and
 * newlines. The banner should only fire for GENUINELY CORRUPTED values
 * (TOC fragments, portal text, OCR garbage) — not for placeholders.
 */
function isPlaceholderIsh(value: string): boolean {
  // Normalize whitespace: trim, replace NBSP, collapse internal whitespace
  const trimmed = value.replace(/\u00A0/g, " ").trim();
  if (trimmed.length === 0) return true;

  // Explicit placeholder patterns: "Not", "TBD", "N/A", "Unknown", etc.
  if (containsMetadataPlaceholder(trimmed)) return true;

  // Comprehensive placeholder string set — case-insensitive
  const lower = trimmed.toLowerCase();
  const PLACEHOLDER_STRINGS = new Set([
    "not", "not extracted", "not mentioned", "not stated", "not provided",
    "not specified", "not applicable", "n/a", "na", "tbd", "tbc", "tba",
    "unknown", "none", "null", "nil", "blank", "pending", "placeholder",
    "to be determined", "to be confirmed", "to be advised",
  ]);
  if (PLACEHOLDER_STRINGS.has(lower)) return true;

  // Short single-word values that are not real data (≤4 chars, no digits)
  if (trimmed.length <= 4 && !/\d/.test(trimmed)) return true;

  return false;
}

function badFieldsFor(tender: TenderShape): Array<{ field: string; label: string; stored: string }> {
  const bad: Array<{ field: string; label: string; stored: string }> = [];
  if (tender.reference && tender.reference.trim() !== "" && !isValidReferenceNumber(tender.reference) && !isPlaceholderIsh(tender.reference)) {
    bad.push({ field: "reference", label: "Reference Number", stored: tender.reference });
  }
  const effectiveClientName = tender.clientName || tender.procuringEntityName || null;
  if (effectiveClientName && effectiveClientName.trim() !== "" && !isValidClientName(effectiveClientName) && !isPlaceholderIsh(effectiveClientName)) {
    bad.push({ field: "clientName", label: "Client / Procuring Entity", stored: effectiveClientName });
  }
  if (tender.country && tender.country.trim() !== "" && !isValidCountry(tender.country) && !isPlaceholderIsh(tender.country)) {
    bad.push({ field: "country", label: "Country", stored: tender.country });
  }
  if (tender.clientContactName && tender.clientContactName.trim() !== "" && !isValidClientContact(tender.clientContactName) && !isPlaceholderIsh(tender.clientContactName)) {
    bad.push({ field: "clientContactName", label: "Client Contact", stored: tender.clientContactName });
  }
  return bad;
}

export function ClientEntityWarningBanner({ tender, canMutate = false }: { tender: TenderShape; canMutate?: boolean }) {
  const bad = badFieldsFor(tender);
  if (bad.length === 0) return null;

  return (
    <section className="mb-4 rounded-2xl border border-red-300 bg-red-50 p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-red-700">Corrupted Tender Details detected</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">
            {bad.length} tender field{bad.length === 1 ? "" : "s"} stored an invalid value
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-700">
            These fields were extracted before the metadata validators landed. They fail the current validation rules
            (e.g. reference numbers must contain a digit, countries must be in the whitelist, client names must not
            be TOC/section fragments). The automatic repair workflow will re-run the extractor and overwrite
            only the invalid values with whatever the new patterns capture from the stored PDF text. Valid manual
            edits are preserved.
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-red-800">
            {bad.map((item) => (
              <li key={item.field}>
                <span className="font-semibold">{item.label}:</span>{" "}
                <code className="rounded bg-white px-1.5 py-0.5 text-xs text-red-900">{item.stored.length > 90 ? `${item.stored.slice(0, 88)}…` : item.stored}</code>
              </li>
            ))}
          </ul>
        </div>
        {/* Gap 2: RepairTenderFactsButton removed from normal path. Repair is now automatic. */}
      </div>
    </section>
  );
}

// Backward-compat alias — use ClientEntityWarningBanner in new code.
export const CorruptedMetadataBanner = ClientEntityWarningBanner;
