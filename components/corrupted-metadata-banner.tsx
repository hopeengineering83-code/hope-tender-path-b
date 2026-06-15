// Proactive banner — surfaces stored tender metadata that fails the
// canonical validators (corrupted from an extraction that pre-dates the
// validator rules) and offers a one-click re-extract to clean them.
//
// WHY THIS EXISTS
// ───────────────
// Without this banner, users had to KNOW to scroll down to the Tender
// Detail panel and click "Re-extract from PDF" — production screenshots
// kept showing the same corrupted values (reference="only",
// country="A ddis Ababa", clientName=TOC fragment, contact="s Contact
// Person") for weeks because the user simply didn't realise that
// button would fix them. (And until commit 7688111 the button used
// fill-empty-only semantics so even clicking it didn't help.)
//
// Server-side detection here means we ALWAYS surface the problem
// loudly at the top of the page when ANY of the four validated fields
// is in an invalid state. Once the user clicks "Clean now", the
// re-extract route overwrites the invalid values, the banner detects
// no remaining corruption on the next render, and disappears.

import {
  isValidClientName,
  isValidReferenceNumber,
  isValidCountry,
  isValidClientContact,
} from "../lib/engine/metadata/metadata-validators";
import { CleanCorruptedMetadataButton } from "./clean-corrupted-metadata-button";

type TenderShape = {
  id: string;
  reference: string | null;
  clientName: string | null;
  procuringEntityName?: string | null;
  country: string | null;
  clientContactName: string | null;
};

function badFieldsFor(tender: TenderShape): Array<{ field: string; label: string; stored: string }> {
  const bad: Array<{ field: string; label: string; stored: string }> = [];
  if (tender.reference && tender.reference.trim() !== "" && !isValidReferenceNumber(tender.reference)) {
    bad.push({ field: "reference", label: "Reference Number", stored: tender.reference });
  }
  const effectiveClientName = tender.clientName || tender.procuringEntityName || null;
  if (effectiveClientName && effectiveClientName.trim() !== "" && !isValidClientName(effectiveClientName)) {
    bad.push({ field: "clientName", label: "Client / Procuring Entity", stored: effectiveClientName });
  }
  if (tender.country && tender.country.trim() !== "" && !isValidCountry(tender.country)) {
    bad.push({ field: "country", label: "Country", stored: tender.country });
  }
  if (tender.clientContactName && tender.clientContactName.trim() !== "" && !isValidClientContact(tender.clientContactName)) {
    bad.push({ field: "clientContactName", label: "Client Contact", stored: tender.clientContactName });
  }
  return bad;
}

export function CorruptedMetadataBanner({ tender }: { tender: TenderShape }) {
  const bad = badFieldsFor(tender);
  if (bad.length === 0) return null;

  return (
    <section className="mb-4 rounded-2xl border border-red-300 bg-red-50 p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-red-700">Corrupted metadata detected</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">
            {bad.length} tender field{bad.length === 1 ? "" : "s"} stored an invalid value
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-700">
            These fields were extracted before the metadata validators landed. They fail the current validation rules
            (e.g. reference numbers must contain a digit, countries must be in the whitelist, client names must not
            be TOC/section fragments). Click <strong>Clean now</strong> to re-run the extractor — it will overwrite
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
        <CleanCorruptedMetadataButton tenderId={tender.id} badCount={bad.length} />
      </div>
    </section>
  );
}
