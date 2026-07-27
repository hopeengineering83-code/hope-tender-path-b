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
import { enrichMetadataWithSourceEvidence, clearEvidenceForField } from "../../../../../lib/engine/metadata-source-enrichment";
import { assessExtractionQuality, assessExtractionQualityPerPage } from "../../../../../lib/extraction-quality";
import {
  isValidClientName,
  isValidReferenceNumber,
  isValidCountry,
  isValidClientContact,
  containsMetadataPlaceholder,
} from "../../../../../lib/engine/metadata-validators";
import { detectMetadataContamination } from "../../../../../lib/engine/tender-metadata-completeness";
import {
  isValidReferenceCandidate,
  isValidDeadlineCandidate,
  isParseableDeadlineValue,
  isValidTitleOrClientCandidate,
} from "../../../../../lib/engine/source-grounded-metadata-repair";
import { logAction } from "../../../../../lib/audit";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { invalidateTenderForSourceRevision } from "../../../../../lib/engine/source-revision-invalidation";

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
  // Reject placeholder/Bid-Team-to-confirm strings regardless of field
  if (typeof value === "string" && containsMetadataPlaceholder(value)) return false;
  // ── Use the SHARED source-grounded metadata repair service ──────
  // This ensures re-extract-metadata and repair-metadata use the SAME
  // validation logic — no disagreement for reference, client, deadline,
  // title, or evaluation criteria.
  if (field === "reference" && !isValidReferenceCandidate(String(value))) return false;
  if (field === "clientName" && !isValidTitleOrClientCandidate(String(value))) return false;
  if (field === "title" && !isValidTitleOrClientCandidate(String(value))) return false;
  // Stored deadlines use the STRUCTURAL check only: a historical (passed)
  // deadline is still the tender's real deadline and must not be flagged
  // invalid and churned. The 30-day recency rule applies to NEW extraction
  // candidates below, where a long-past date signals contamination.
  if (field === "deadline" && !isParseableDeadlineValue(value)) return false;
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

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireUser(); } catch { return unauthorizedResponse(); }
  if (!["ADMIN", "PROPOSAL_MANAGER"].includes(actor.role)) return forbiddenResponse();

  const rl = rateLimit(`re-extract-metadata:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const ocrProvider = typeof body.ocrProvider === "string" ? body.ocrProvider : null;

  if (ocrProvider) {
    return NextResponse.json({
      error: `OCR provider "${ocrProvider}" is not yet implemented. The re-extract endpoint re-runs regex/NLP-based metadata inference on the already-extracted text — it does not perform optical character recognition. To extract text from scanned PDFs, set PDF_OCR_ENABLED=true on Vercel and re-upload the document.`,
      code: "OCR_NOT_IMPLEMENTED",
      ocrProvider,
      hint: "To run OCR, re-upload the tender file with PDF_OCR_ENABLED=true enabled.",
    }, { status: 501 });
  }

  await prismaReady;
  const { id } = await params;

  const tender = await prisma.tender.findFirst({
    where: { id, userId: actor.id },
    // ACTIVE files only: a deleted file's text must never contribute extracted
    // values or ground source evidence.
    include: { files: { where: { deletionStatus: "ACTIVE" }, select: { id: true, originalFileName: true, extractedText: true, totalPages: true } } },
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
      // Stale-evidence prevention: when a critical field's scalar value
      // changes, the old file/page/quote evidence for the OLD value must
      // NOT survive \u2014 it would be stale evidence for a different value.
      // Clear the whole evidence tuple atomically here. The enrichment
      // step below may re-set it with PROVEN evidence for the NEW value.
      // This ensures a null/unproven page never makes the field grounded.
      const cleared = clearEvidenceForField(key as string);
      for (const [col, val] of Object.entries(cleared)) {
        (update as Record<string, unknown>)[col] = val;
      }
      // Reference evidence lives in contactDetailsSourceJson.procurementReferenceNumber.
      // When the reference scalar changes, clear that JSON entry so the old
      // fileId/page/quote for the OLD reference value cannot survive.
      if (key === "reference") {
        const existingJson = (tender as { contactDetailsSourceJson?: string | null }).contactDetailsSourceJson;
        if (existingJson) {
          try {
            const contactDetails = JSON.parse(existingJson) as Record<string, unknown>;
            if (contactDetails["procurementReferenceNumber"]) {
              delete contactDetails["procurementReferenceNumber"];
              (update as Record<string, unknown>).contactDetailsSourceJson =
                Object.keys(contactDetails).length > 0 ? JSON.stringify(contactDetails) : null;
            }
          } catch {
            // malformed JSON \u2014 nothing to clear
          }
        }
      }
    } else if (storedIsOverridable && isEmpty(extracted) && !isEmpty(stored)) {
      // The stored value is a placeholder/invalid AND the extractor found no
      // replacement value. Write null to clear the placeholder — do NOT keep
      // "Not", "N/A", "Unknown", etc. as stored values. This prevents the
      // corrupted-metadata banner from firing on placeholder values and
      // prevents readiness panels from seeing a non-null-but-invalid value.
      update[key as string] = null;
      fieldsAfter[key as string] = null;
      overwrittenInvalid.push(key as string);
      // Also clear stale evidence for the placeholder value
      const cleared = clearEvidenceForField(key as string);
      for (const [col, val] of Object.entries(cleared)) {
        (update as Record<string, unknown>)[col] = val;
      }
    } else {
      fieldsAfter[key as string] = stored;
    }
  };

  tryFill("title", metadata.title.startsWith("[REVIEW NEEDED]") ? null : metadata.title);
  tryFill("reference", metadata.reference);
  tryFill("clientName", metadata.clientName);
  // Sync procuringEntityName when clientName was (re-)extracted — keeps both
  // fields consistent without a separate extractor for procuringEntityName.
  if (update.clientName && !(tender as Record<string, unknown>).procuringEntityName) {
    (update as Record<string, unknown>).procuringEntityName = update.clientName;
  }
  // If a valid clientName was just (re-)extracted, re-evaluate contamination.
  // The extractor already runs isValidClientName(), so a stored update.clientName
  // has passed the validation gate. Clear metadataContaminated if it's clean.
  if (update.clientName && !detectMetadataContamination(String(update.clientName)).contaminated) {
    (update as Record<string, unknown>).metadataContaminated = false;
  }
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
  tryFill("evaluationMethodology", metadata.evaluationMethodology);
  tryFill("budget", metadata.budget);
  tryFill("currency", metadata.currency);
  tryFill("deadline", isValidDeadlineCandidate(metadata.deadline) ? metadata.deadline : null);
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

  // Refresh persisted page-level extraction diagnostics on every re-extract so
  // the Extraction Quality dashboard reflects the latest stored truth even when
  // no new metadata fields are discovered.
  // PAGE-PROVENANCE GUARD: the stored TenderFile.totalPages (set at upload
  // from the real PDF page count) is the AUTHORITATIVE page count. Do NOT
  // overwrite it with assessExtractionQualityPerPage().totalDetectedPages —
  // that is a diagnostic-derived heuristic, not proof of the real page count.
  // Overwriting totalPages with it would let a single-page boundaryless text
  // blob claim totalPages=1, which the page-provenance guard treats as proof
  // that page 1 is valid — ungrounding fields that should stay EXTRACTED_UNVERIFIED.
  const totalPagesByFileId = new Map<string, number | null>();
  for (const file of tender.files) {
    const quality = assessExtractionQuality(file.extractedText, file.originalFileName);
    const perPage = assessExtractionQualityPerPage(file.extractedText);
    // Use the STORED totalPages (authoritative), NOT the diagnostic-derived count.
    totalPagesByFileId.set(file.id, (file as { totalPages?: number | null }).totalPages ?? null);
    await prisma.tenderFile.update({
      where: { id: file.id },
      data: {
        // Do NOT overwrite totalPages — it is authoritative from upload.
        extractedPages: perPage.totalDetectedPages - perPage.failedPages.length,
        ocrPages: perPage.ocrPages.length,
        failedPages: perPage.failedPages.length,
        extractionScore: quality.score,
        pageStatusJson: JSON.stringify(perPage.pages),
      },
    });
  }

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

  // Enrich source evidence: locate each critical field value in the active
  // files' extracted text and persist the fileId + page + quote so the
  // canonical resolver can mark them as EXTRACTED_AND_GROUNDED. Without this,
  // re-extracted values stay EXTRACTED_UNVERIFIED forever. Only fields where
  // evidence is found are added; existing evidence is NOT overwritten.
  //
  // Wrapped in try/catch (best-effort, non-fatal): if enrichment throws
  // (e.g., a file with malformed text that defeats the normalized-index
  // builder), the re-extraction itself still succeeds — the scalar values
  // are persisted, just without source evidence. The field stays
  // EXTRACTED_UNVERIFIED until repair-metadata or AI Analyze is run.
  // This mirrors the try/catch pattern in metadata-override and ai-analyze.
  const enrichmentFiles = tender.files.map((f) => ({
    id: f.id,
    extractedText: f.extractedText,
    deletionStatus: "ACTIVE" as const,
    totalPages: totalPagesByFileId.get(f.id) ?? null,
  }));
  try {
    const enrichment = enrichMetadataWithSourceEvidence({
      title: update.title as string | undefined,
      reference: update.reference as string | undefined,
      clientName: update.clientName as string | undefined,
      deadline: update.deadline as Date | undefined,
      submissionMethod: update.submissionMethod as string | undefined,
      submissionAddress: update.submissionAddress as string | undefined,
      submissionEmails: update.submissionEmails as string | undefined,
      submissionEmailSubject: update.submissionEmailSubject as string | undefined,
      existingContactDetailsSourceJson: (tender as any).contactDetailsSourceJson ?? null,
    }, enrichmentFiles);
    Object.assign(update, enrichment);
  } catch {
    // Best-effort, non-fatal. The scalar values in `update` are still
    // persisted below; only the source-evidence columns are skipped.
  }

  // A metadata correction here can change the exact tender-identifying
  // values (client name, reference, deadline, submission details, ...)
  // that an already-generated document, confirmed BuildPlan, or in-flight
  // AI job baked in — those must not silently keep looking valid against
  // corrected data. Reusing the same invalidation the byte-level
  // re-extract/upload routes already run keeps every source-derived
  // artifact consistent regardless of whether the correction came from new
  // bytes or from re-running inference over the same bytes.
  await prisma.$transaction(async (tx) => {
    await tx.tender.update({ where: { id }, data: update });
    await invalidateTenderForSourceRevision(tx, id, "TENDER_METADATA_CORRECTED");
  });
  await logAction({
    userId: actor.id,
    action: "TENDER_UPDATE",
    entityType: "Tender",
    entityId: id,
    description: `${actor.email} re-extracted Tender Details on "${tender.title}" — auto-filled ${updatedCount} field(s)${overwrittenInvalid.length > 0 ? `; OVERWROTE ${overwrittenInvalid.length} invalid value(s): ${overwrittenInvalid.join(", ")}` : ""}`,
    metadata: { tenderId: id, updatedCount, fields: Object.keys(update), overwrittenInvalid, ...(ocrProvider ? { ocrProvider } : {}) },
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
    ...(ocrProvider ? { ocrProvider } : {}),
  });
}
