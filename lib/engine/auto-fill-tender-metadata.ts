// Auto-fill missing tender metadata fields after engine pre-flight.
//
// Combines extracted text from all tender files, runs inferTenderMetadata,
// and writes back fields that are currently empty or placeholder-only.
// Never overwrites a real existing value.

import type { PrismaClient } from "@prisma/client";
import { inferTenderMetadata } from "./tender-metadata";
import { isValidClientName, isPlaceholderClientName } from "./metadata-validators";
import {
  extractReference,
  extractDeadline,
  extractSubmissionEmails,
  extractSubmissionMethod,
  extractPageLimit,
  extractValidityDays,
  extractBidBondAmount,
  extractNumberOfCopies,
  extractMandatorySiteVisit,
} from "./tender-field-extractors";
import { extractEvaluationMethodologyFromSource } from "./evaluation-methodology-source-extractor";

type TenderFileForAutoFill = {
  extractedText?: string | null;
  originalFileName?: string | null;
  fileName?: string | null;
  totalPages?: number | null;
};

type TenderForAutoFill = {
  id: string;
  title?: string | null;
  description?: string | null;
  intakeSummary?: string | null;
  clientName?: string | null;
  procuringEntityName?: string | null;
  donorAgency?: string | null;
  implementingAgency?: string | null;
  clientWebsite?: string | null;
  submissionEmailSubject?: string | null;
  reference?: string | null;
  category?: string | null;
  country?: string | null;
  budget?: number | null;
  currency?: string | null;
  deadline?: Date | null;
  submissionMethod?: string | null;
  submissionAddress?: string | null;
  submissionEmails?: string | null;
  clientContactName?: string | null;
  clientContactTitle?: string | null;
  clientContactEmail?: string | null;
  clientContactPhone?: string | null;
  clientAddress?: string | null;
  preBidMeetingDate?: Date | null;
  preBidMeetingLocation?: string | null;
  validityDays?: number | null;
  pageLimit?: number | null;
  bidBondAmount?: number | null;
  bidBondCurrency?: string | null;
  numberOfCopiesRequired?: number | null;
  mandatorySiteVisit?: boolean | null;
  evaluationMethodology?: string | null;
  technicalWeight?: number | null;
  financialWeight?: number | null;
  files: TenderFileForAutoFill[];
};

export type MetadataAutoFillResult = {
  filled: string[];
  skipped: string[];
};

function isEmptyOrPlaceholder(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== "string") return false;
  if (value.trim() === "") return true;
  return isPlaceholderClientName(value);
}

function combineExtractedText(files: TenderFileForAutoFill[]): string {
  return files
    .map((f) => f.extractedText ?? "")
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 250_000);
}

function primaryFileName(files: TenderFileForAutoFill[]): string {
  return files[0]?.originalFileName ?? files[0]?.fileName ?? "tender";
}

export async function autoFillTenderMetadata(
  tender: TenderForAutoFill,
  prisma: PrismaClient,
): Promise<MetadataAutoFillResult> {
  const combinedText = combineExtractedText(tender.files);
  if (combinedText.trim().length < 500) {
    return { filled: [], skipped: ["text_too_short"] };
  }

  const draft = inferTenderMetadata(combinedText, primaryFileName(tender.files));

  const patch: Record<string, unknown> = {};
  const filled: string[] = [];
  const skipped: string[] = [];

  function tryFill<T>(
    field: string,
    current: T | null | undefined,
    inferred: T | null | undefined,
    validate?: (v: T) => boolean,
  ): void {
    if (inferred == null) { skipped.push(field); return; }
    if (current != null && !isEmptyOrPlaceholder(current)) {
      skipped.push(field);
      return;
    }
    if (validate && !validate(inferred)) { skipped.push(field); return; }
    patch[field] = inferred;
    filled.push(field);
  }

  if (
    draft.title &&
    (!tender.title || tender.title.trim() === "" || tender.title.startsWith("[REVIEW NEEDED]"))
  ) {
    patch.title = draft.title;
    filled.push("title");
  } else {
    skipped.push("title");
  }
  tryFill("description", tender.description, draft.description);
  tryFill("intakeSummary", tender.intakeSummary, draft.intakeSummary);
  tryFill("clientName", tender.clientName, draft.clientName, isValidClientName);
  tryFill("procuringEntityName", tender.procuringEntityName, draft.procuringEntityName);
  tryFill("donorAgency", tender.donorAgency, draft.donorAgency);
  tryFill("implementingAgency", tender.implementingAgency, draft.implementingAgency);
  tryFill("clientWebsite", tender.clientWebsite, draft.clientWebsite);
  tryFill("submissionEmailSubject", tender.submissionEmailSubject, draft.submissionEmailSubject);
  tryFill("reference", tender.reference, draft.reference);
  tryFill("country", tender.country, draft.country);
  tryFill("budget", tender.budget, draft.budget);
  tryFill("currency", tender.currency, draft.currency);
  tryFill("deadline", tender.deadline, draft.deadline);
  tryFill("submissionMethod", tender.submissionMethod, draft.submissionMethod);
  tryFill("submissionAddress", tender.submissionAddress, draft.submissionAddress);
  tryFill("clientContactName", tender.clientContactName, draft.clientContactName);
  tryFill("clientContactTitle", tender.clientContactTitle, draft.clientContactTitle);
  tryFill("clientContactEmail", tender.clientContactEmail, draft.clientContactEmail);
  tryFill("clientContactPhone", tender.clientContactPhone, draft.clientContactPhone);
  tryFill("clientAddress", tender.clientAddress, draft.clientAddress);
  // Auto-fill pre-bid meeting date and location when extracted from the tender document
  if ((tender.preBidMeetingDate === null || tender.preBidMeetingDate === undefined) && draft.preBidMeetingDate) {
    patch["preBidMeetingDate"] = draft.preBidMeetingDate;
    filled.push("preBidMeetingDate");
  } else {
    skipped.push("preBidMeetingDate");
  }
  tryFill("preBidMeetingLocation", tender.preBidMeetingLocation, draft.preBidMeetingLocation);

  // The fields below are inferred by inferTenderMetadata but were not being
  // patched — they were the source of "Bid-Team to confirm" placeholders the
  // user was being asked to fill manually even though the tender file plainly
  // carried them. tryFill only sets when the current DB value is empty, so
  // human edits are never overwritten.
  const submissionEmailsJoined = (draft.submissionEmails ?? []).join(", ").trim();
  tryFill("submissionEmails", tender.submissionEmails, submissionEmailsJoined.length > 0 ? submissionEmailsJoined : null);
  tryFill("validityDays", tender.validityDays, draft.validityDays);
  tryFill("pageLimit", tender.pageLimit, draft.pageLimit);
  tryFill("bidBondAmount", tender.bidBondAmount, draft.bidBondAmount);
  tryFill("bidBondCurrency", tender.bidBondCurrency, draft.bidBondCurrency);
  tryFill("numberOfCopiesRequired", tender.numberOfCopiesRequired, draft.numberOfCopiesRequired);
  tryFill("technicalWeight", tender.technicalWeight, draft.technicalWeight);
  tryFill("financialWeight", tender.financialWeight, draft.financialWeight);
  // mandatorySiteVisit is a boolean — write only when the current DB value is null
  // (booleans bypass isEmptyOrPlaceholder, which is string-only).
  if (tender.mandatorySiteVisit === null || tender.mandatorySiteVisit === undefined) {
    if (draft.mandatorySiteVisit !== null && draft.mandatorySiteVisit !== undefined) {
      patch["mandatorySiteVisit"] = draft.mandatorySiteVisit;
      filled.push("mandatorySiteVisit");
    } else {
      skipped.push("mandatorySiteVisit");
    }
  } else {
    skipped.push("mandatorySiteVisit");
  }

  // Category: only promote from the default "General" to something specific.
  if (
    draft.category &&
    draft.category !== "General" &&
    (!tender.category || tender.category === "General")
  ) {
    patch["category"] = draft.category;
    filled.push("category");
  }

  // ── Second pass — strong source-grounded extractors. ───────────────────────
  // inferTenderMetadata is conservative and frequently leaves fields null even
  // when the tender file plainly contains them. The user-facing pain: "the app
  // tells me to fill metadata even though I uploaded the tender file". After
  // the first pass we run the stronger per-file extractors from #523 for any
  // field still empty (and not yet patched). Each extractor never invents —
  // it returns {found:false} when no plausible match is in the source.
  // The extractors take a per-file input shape.
  const filesInput = {
    files: tender.files.map((f) => ({ fileName: f.fileName ?? f.originalFileName ?? null, extractedText: f.extractedText ?? null, totalPages: f.totalPages ?? null })),
  };
  function shouldFillScalar<T>(field: string, current: T | null | undefined): boolean {
    if (filled.includes(field)) return false;
    if (typeof current === "string") return isEmptyOrPlaceholder(current);
    return current === null || current === undefined;
  }
  function trySecondPassScalar<T>(field: string, current: T | null | undefined, extracted: T | null | undefined): void {
    if (!shouldFillScalar(field, current)) return;
    if (extracted === null || extracted === undefined) return;
    patch[field] = extracted as unknown;
    filled.push(field);
  }

  if (shouldFillScalar("reference", tender.reference)) {
    const r = extractReference(filesInput);
    if (r.found) trySecondPassScalar("reference", tender.reference, r.value);
  }
  if (shouldFillScalar("deadline", tender.deadline)) {
    const r = extractDeadline(filesInput);
    if (r.found) trySecondPassScalar("deadline", tender.deadline, r.value);
  }
  if (shouldFillScalar("submissionEmails", tender.submissionEmails)) {
    const r = extractSubmissionEmails(filesInput);
    if (r.found) trySecondPassScalar("submissionEmails", tender.submissionEmails, r.value.join(", "));
  }
  if (shouldFillScalar("submissionMethod", tender.submissionMethod)) {
    const r = extractSubmissionMethod(filesInput);
    if (r.found) trySecondPassScalar("submissionMethod", tender.submissionMethod, r.value);
  }
  if (shouldFillScalar("pageLimit", tender.pageLimit)) {
    const r = extractPageLimit(filesInput);
    if (r.found) trySecondPassScalar("pageLimit", tender.pageLimit, r.value);
  }
  if (shouldFillScalar("validityDays", tender.validityDays)) {
    const r = extractValidityDays(filesInput);
    if (r.found) trySecondPassScalar("validityDays", tender.validityDays, r.value);
  }
  if (shouldFillScalar("bidBondAmount", tender.bidBondAmount)) {
    const r = extractBidBondAmount(filesInput);
    // Skip PERCENT-only bonds — we don't invent an absolute amount.
    if (r.found && r.value.amount > 0 && r.value.currency !== "PERCENT") {
      trySecondPassScalar("bidBondAmount", tender.bidBondAmount, r.value.amount);
      if (r.value.currency && shouldFillScalar("bidBondCurrency", tender.bidBondCurrency)) {
        trySecondPassScalar("bidBondCurrency", tender.bidBondCurrency, r.value.currency);
      }
    }
  }
  if (shouldFillScalar("numberOfCopiesRequired", tender.numberOfCopiesRequired)) {
    const r = extractNumberOfCopies(filesInput);
    if (r.found) trySecondPassScalar("numberOfCopiesRequired", tender.numberOfCopiesRequired, r.value);
  }
  // mandatorySiteVisit is a boolean — check the null branch directly.
  if ((tender.mandatorySiteVisit === null || tender.mandatorySiteVisit === undefined) && !filled.includes("mandatorySiteVisit")) {
    const r = extractMandatorySiteVisit(filesInput);
    if (r.found) {
      patch["mandatorySiteVisit"] = r.value;
      filled.push("mandatorySiteVisit");
    }
  }
  // evaluationMethodology — separate, higher-confidence section extractor.
  if (shouldFillScalar("evaluationMethodology", tender.evaluationMethodology)) {
    const r = extractEvaluationMethodologyFromSource(filesInput);
    if (r.found) trySecondPassScalar("evaluationMethodology", tender.evaluationMethodology, r.methodologyText);
  }

  if (Object.keys(patch).length > 0) {
    await prisma.tender.update({ where: { id: tender.id }, data: patch });
  }

  return { filled, skipped };
}
