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
import { logAction } from "../../../../../lib/audit";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireUser(); } catch { return unauthorizedResponse(); }
  if (!["ADMIN", "PROPOSAL_MANAGER"].includes(actor.role)) return forbiddenResponse();

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

  // ─── Merge strategy: fill empty columns only ────────────────────────────
  // Never OVERWRITE a value the user has manually edited. The extractor
  // may improve over time and return better matches, but the user's
  // explicit edits are the source of truth.
  const isEmpty = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

  const update: Record<string, unknown> = {};
  const fieldsBefore: Record<string, unknown> = {};
  const fieldsAfter: Record<string, unknown> = {};

  // Helper: set field only if currently empty AND extractor has a value.
  const tryFill = <K extends keyof typeof tender>(key: K, extracted: unknown) => {
    fieldsBefore[key as string] = tender[key];
    if (isEmpty(tender[key]) && !isEmpty(extracted)) {
      update[key as string] = extracted;
      fieldsAfter[key as string] = extracted;
    } else {
      fieldsAfter[key as string] = tender[key];
    }
  };

  tryFill("title", metadata.title.startsWith("[REVIEW NEEDED]") ? null : metadata.title);
  tryFill("reference", metadata.reference);
  tryFill("clientName", metadata.clientName);
  tryFill("country", metadata.country);
  // category — only update when stored is "General" (the default)
  if (tender.category === "General" && metadata.category !== "General") {
    update.category = metadata.category;
    fieldsAfter.category = metadata.category;
  }
  fieldsBefore.category = tender.category;
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
  if (tender.mandatorySiteVisit === false && metadata.mandatorySiteVisit === true) {
    update.mandatorySiteVisit = true;
    fieldsAfter.mandatorySiteVisit = true;
  }
  fieldsBefore.mandatorySiteVisit = tender.mandatorySiteVisit;
  tryFill("numberOfCopiesRequired", metadata.numberOfCopiesRequired);
  tryFill("technicalWeight", metadata.technicalWeight);
  tryFill("financialWeight", metadata.financialWeight);

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
    description: `${actor.email} re-extracted metadata on "${tender.title}" — auto-filled ${updatedCount} field(s)`,
    metadata: { tenderId: id, updatedCount, fields: Object.keys(update) },
  });

  return NextResponse.json({
    success: true,
    updated: updatedCount,
    fields: Object.keys(update),
    fieldsBefore,
    fieldsAfter,
    message: `Auto-filled ${updatedCount} field(s) from the tender body. Refresh the page to see the changes.`,
  });
}
