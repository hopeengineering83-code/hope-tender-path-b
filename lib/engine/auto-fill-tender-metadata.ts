// Auto-fill missing tender metadata fields after engine pre-flight.
//
// Combines extracted text from all tender files, runs inferTenderMetadata,
// and writes back fields that are currently empty or placeholder-only.
// Never overwrites a real existing value.

import type { PrismaClient } from "@prisma/client";
import { inferTenderMetadata } from "./tender-metadata";
import { isValidClientName, isPlaceholderClientName } from "./metadata-validators";

type TenderFileForAutoFill = {
  extractedText?: string | null;
  originalFileName?: string | null;
  fileName?: string | null;
};

type TenderForAutoFill = {
  id: string;
  clientName?: string | null;
  reference?: string | null;
  category?: string | null;
  country?: string | null;
  deadline?: Date | null;
  submissionMethod?: string | null;
  submissionAddress?: string | null;
  submissionEmails?: string | null;
  clientContactName?: string | null;
  clientContactTitle?: string | null;
  clientContactEmail?: string | null;
  clientContactPhone?: string | null;
  validityDays?: number | null;
  pageLimit?: number | null;
  bidBondAmount?: number | null;
  bidBondCurrency?: string | null;
  numberOfCopiesRequired?: number | null;
  mandatorySiteVisit?: boolean | null;
  files: TenderFileForAutoFill[];
};

export type MetadataAutoFillResult = {
  filled: string[];
  skipped: string[];
};

function isEmptyOrPlaceholder(value: string | null | undefined): boolean {
  if (!value || value.trim() === "") return true;
  if (isPlaceholderClientName(value)) return true;
  return false;
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
    if (current != null && !isEmptyOrPlaceholder(current as unknown as string)) {
      skipped.push(field);
      return;
    }
    if (validate && !validate(inferred)) { skipped.push(field); return; }
    patch[field] = inferred;
    filled.push(field);
  }

  tryFill("clientName", tender.clientName, draft.clientName, isValidClientName);
  tryFill("reference", tender.reference, draft.reference);
  tryFill("country", tender.country, draft.country);
  tryFill("deadline", tender.deadline, draft.deadline);
  tryFill("submissionMethod", tender.submissionMethod, draft.submissionMethod);
  tryFill("submissionAddress", tender.submissionAddress, draft.submissionAddress);
  tryFill("clientContactName", tender.clientContactName, draft.clientContactName);
  tryFill("clientContactTitle", tender.clientContactTitle, draft.clientContactTitle);
  tryFill("clientContactEmail", tender.clientContactEmail, draft.clientContactEmail);
  tryFill("clientContactPhone", tender.clientContactPhone, draft.clientContactPhone);

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

  if (Object.keys(patch).length > 0) {
    await prisma.tender.update({ where: { id: tender.id }, data: patch });
  }

  return { filled, skipped };
}
