// POST /api/tenders/[id]/re-extract-metadata
//
// Re-runs inferTenderMetadata() on the tender's existing extractedText
// (no re-upload needed) and updates the structured columns. Useful when:
//   1. The extractor has been improved since the tender was uploaded
//   2. A field was missed and the user wants to retry without manual entry
//   3. The original upload used an older extractor version
//
// Body: {} (empty — operates on the tender's existing files)
// Returns: { updated: number, fieldsBefore: {...}, fieldsAfter: {...} }
//
// The route is idempotent: re-running with no extractor changes produces
// the same result and zero columns are updated. Fields the user has
// manually edited are preserved when the extractor returns null (the
// "fill-empty-only" semantics also applied by mergeFactsIntoCompany).

import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../../lib/auth";
import { inferTenderMetadata } from "../../../../../lib/engine/tender-metadata";
import {
  isValidClientName,
  isValidReferenceNumber,
  isValidCountry,
  isValidClientContact,
} from "../../../../../lib/engine/metadata-validators";
import { logAction } from "../../../../../lib/audit";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../../lib/rate-limit";

// ─── Root-cause fix for "Re-extract from PDF" doesn't clean corruption ──
// PRIOR BUG: tryFill used "fill-empty-only" semantics, treating any
// non-empty stored value as a manual edit to preserve. That correctly
// protected user edits but ALSO protected corrupted extractions from a
// previous run. Production showed:
//   • reference = "only"                  (regex captured a stop-word)
//   • country = "A ddis Ababa"            (OCR fragment, not a country)
//   • clientName = "references (where..." (TOC fragment, not an entity)
//   • clientContactName = "s Contact Person" (apostrophe leak)
// Re-extract preserved every one of these because they aren't empty.
// User clicked "Re-extract from PDF" → 0 fields updated → corruption
// persisted forever.
//
// FIX: a stored value is considered "overridable" when EITHER:
//   (a) it's empty, OR
//   (b) it fails the canonical validator for that field
// The new validators are the SAME ones inferTenderMetadata uses on
// extraction, so this is round-trip consistent — if the validator
// rejects the extractor output, it ALSO rejects the stored value of the
// same shape, and re-extract gets to overwrite.

/**
 * Per-field validator. Returns true when the stored value is a valid
 * exemplar of that field's expected shape — meaning we should PRESERVE
 * it (treat as user edit). Returns false when the stored value is empty
 * or invalid — meaning we should OVERWRITE it from the new extraction.
 *
 * Fields not listed here use the legacy isEmpty-only check (no shape
 * validator available, e.g. budget numbers, dates, free-text addresses).
 */
function isValidStoredValue(field: string, value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  switch (field) {
    case "clientName":         return isValidClientName(String(value));
    case "reference":          return isValidReferenceNumber(String(value));
    case "country":            return isValidCountry(String(value));
    case "clientContactName":  return isValidClientContact(String(value));
    default:                   return true; // No validator → treat non-empty as valid.
  }
}

export const maxDuration = 30;
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireUser(); } catch { return unauthorizedResponse(); }
  if (!["ADMIN", "PROPOSAL_MANAGER"].includes(actor.role)) return forbiddenResponse();

  const rl = rateLimit(`re-extract-metadata:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });

  await prismaReady;
  const { id } = await params;

  const tender = await prisma.tender.findFirst({
    where: { id, userId: actor.id },
    include: { files: { select: { id: true, originalFileName: true, extractedText: true } } },
  });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });
  if (tender.files.length === 0) {
    return NextResponse.json({ error: "Tender has no uploaded files to re-extract from. Upload tender documents first." }, { status: 400 });
  }

  // Combine extracted text from every file (skip files without text).
  const combinedText = tender.files
    .filter((f) => f.extractedText && f.extractedText.trim().length > 0)
    .map((f) => `FILE: ${f.originalFileName}\n${f.extractedText}`)
    .join("\n\n--- NEXT TENDER FILE ---\n\n");

  if (combinedText.length < 100) {
    return NextResponse.json({
      error: "No extractable text in tender files. Re-upload with PDF_OCR_ENABLED=true if these are scanned PDFs.",
      hint: "Set PDF_OCR_ENABLED=true on Vercel and re-upload — the vision OCR layer will extract text from scanned PDFs.",
    }, { status: 400 });
  }

  const fallbackName = tender.files[0]?.originalFileName ?? "uploaded-tender";
  const metadata = inferTenderMetadata(combinedText, fallbackName);

  // ─── Merge strategy: fill empty OR overwrite invalid ────────────────────
  // Pre-fix: pure fill-empty-only. Manual edits were preserved (good) but
  // corrupted extractions were ALSO preserved (bad — see big comment at
  // top of file).
  // Post-fix: a stored value is overridable when it's empty OR fails the
  // canonical validator for that field. Manual edits that are VALID are
  // still preserved.
  const isEmpty = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

  const update: Record<string, unknown> = {};
  const fieldsBefore: Record<string, unknown> = {};
  const fieldsAfter: Record<string, unknown> = {};
  // Audit-log shape: which fields were OVERWRITTEN because the stored
  // value failed validation (vs filled-because-empty). Helps the user
  // see why corrupted DB rows finally got cleaned.
  const overwrittenInvalid: string[] = [];

  const tryFill = <K extends keyof typeof tender>(key: K, extracted: unknown) => {
    fieldsBefore[key as string] = tender[key];
    const stored = tender[key];
    const storedIsOverridable = isEmpty(stored) || !isValidStoredValue(key as string, stored);
    if (storedIsOverridable && !isEmpty(extracted)) {
      update[key as string] = extracted;
      fieldsAfter[key as string] = extracted;
      if (!isEmpty(stored)) overwrittenInvalid.push(key as string);
    } else {
      fieldsAfter[key as string] = stored;
    }
  };

  tryFill("title", metadata.title.startsWith("[REVIEW NEEDED]") ? null : metadata.title);
  tryFill("reference", metadata.reference);
  tryFill("clientName", metadata.clientName);
  tryFill("country", metadata.country);
  // category — only update when stored is "General" (the default)
  fieldsBefore.category = tender.category;
  if (tender.category === "General" && metadata.category !== "General") {
    update.category = metadata.category;
    fieldsAfter.category = metadata.category;
  } else {
    // Always populate fieldsAfter so the audit log never shows undefined.
    fieldsAfter.category = tender.category;
  }
  tryFill("budget", metadata.budget);
  tryFill("currency", metadata.currency);
  tryFill("deadline", metadata.deadline);
  tryFill("submissionMethod", metadata.submissionMethod);
  tryFill("submissionAddress", metadata.submissionAddress);
  tryFill("pageLimit", metadata.pageLimit);
  tryFill("clientContactName", metadata.clientContactName);
  tryFill("clientContactTitle", metadata.clientContactTitle);
  tryFill("clientContactEmail", metadata.clientContactEmail);
  tryFill("clientContactPhone", metadata.clientContactPhone);
  tryFill("clientAddress", metadata.clientAddress);
  tryFill("submissionEmails", metadata.submissionEmails.length > 0 ? metadata.submissionEmails.join("|") : null);
  tryFill("validityDays", metadata.validityDays);
  tryFill("bidBondAmount", metadata.bidBondAmount);
  tryFill("bidBondCurrency", metadata.bidBondCurrency);
  tryFill("preBidMeetingDate", metadata.preBidMeetingDate);
  tryFill("preBidMeetingLocation", metadata.preBidMeetingLocation);
  // mandatorySiteVisit — only flip false→true (user may want to manually clear)
  fieldsBefore.mandatorySiteVisit = tender.mandatorySiteVisit;
  if (tender.mandatorySiteVisit === false && metadata.mandatorySiteVisit === true) {
    update.mandatorySiteVisit = true;
    fieldsAfter.mandatorySiteVisit = true;
  } else {
    // Always populate fieldsAfter so the audit log never shows undefined.
    fieldsAfter.mandatorySiteVisit = tender.mandatorySiteVisit;
  }
  tryFill("numberOfCopiesRequired", metadata.numberOfCopiesRequired);
  tryFill("technicalWeight", metadata.technicalWeight);
  tryFill("financialWeight", metadata.financialWeight);
  tryFill("description", metadata.description);
  tryFill("intakeSummary", metadata.intakeSummary);

  const updatedCount = Object.keys(update).length;
  if (updatedCount === 0) {
    return NextResponse.json({
      success: true,
      updated: 0,
      message: "No new fields extracted — every field is either already populated or the extractor found no pattern.",
      fieldsBefore,
      fieldsAfter,
    });
  }

  await prisma.tender.update({ where: { id }, data: update });
  await logAction({
    userId: actor.id,
    action: "TENDER_UPDATE",
    entityType: "Tender",
    entityId: id,
    description: `${actor.email} re-extracted metadata on "${tender.title}" — auto-filled ${updatedCount} field(s)${overwrittenInvalid.length > 0 ? `; OVERWROTE ${overwrittenInvalid.length} invalid value(s): ${overwrittenInvalid.join(", ")}` : ""}`,
    metadata: { tenderId: id, updatedCount, fields: Object.keys(update), overwrittenInvalid },
  });

  const overwriteSuffix = overwrittenInvalid.length > 0
    ? ` Cleaned ${overwrittenInvalid.length} previously corrupted field(s): ${overwrittenInvalid.join(", ")}.`
    : "";
  return NextResponse.json({
    success: true,
    updated: updatedCount,
    fields: Object.keys(update),
    overwrittenInvalid,
    fieldsBefore,
    fieldsAfter,
    message: `Auto-filled ${updatedCount} field(s) from the tender body.${overwriteSuffix} Refresh the page to see the changes.`,
  });
}
