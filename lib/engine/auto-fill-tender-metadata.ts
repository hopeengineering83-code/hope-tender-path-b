import type { PrismaClient } from "@prisma/client";
import { inferTenderMetadata } from "./tender-metadata";

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

function isPlaceholderClientName(value: unknown): boolean {
  if (typeof value !== "string") return true;
  const text = value.trim();
  return !text || /^(the client|client|unknown|n\/a|na|none|-)$/i.test(text);
}

function validClientName(value: string | null | undefined): value is string {
  if (!value) return false;
  const text = value.trim();
  if (text.length < 3) return false;
  if (/^(the client|client|unknown|n\/a|na|none|-)$/i.test(text)) return false;
  if (/\b(technical approach|methodology|financial proposal|terms of reference|table of contents|appendix|annex)\b/i.test(text)) return false;
  return true;
}

export type AutoFillTenderMetadataResult = {
  updated: boolean;
  fields: string[];
  extractedClientName: string | null;
  message: string;
};

export async function autoFillTenderMetadataFromFiles(
  client: PrismaClient,
  userId: string,
  tenderId: string,
): Promise<AutoFillTenderMetadataResult> {
  const tender = await client.tender.findFirst({
    where: { id: tenderId, userId },
    include: {
      files: {
        select: { originalFileName: true, extractedText: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!tender || tender.files.length === 0) {
    return { updated: false, fields: [], extractedClientName: null, message: "No tender files available for metadata extraction." };
  }

  const combinedText = tender.files
    .filter((file) => file.extractedText && file.extractedText.trim().length > 0)
    .map((file) => `FILE: ${file.originalFileName}\n${file.extractedText}`)
    .join("\n\n--- NEXT TENDER FILE ---\n\n");

  if (combinedText.trim().length < 500) {
    return { updated: false, fields: [], extractedClientName: null, message: "Tender text is too short for reliable client-name extraction." };
  }

  const fallbackName = tender.files[0]?.originalFileName ?? "uploaded-tender";
  const metadata = inferTenderMetadata(combinedText, fallbackName);
  const update: Record<string, unknown> = {};

  if (isPlaceholderClientName(tender.clientName) && validClientName(metadata.clientName)) update.clientName = metadata.clientName.trim();
  if (isEmpty(tender.reference) && !isEmpty(metadata.reference)) update.reference = metadata.reference;
  if (tender.category === "General" && metadata.category !== "General") update.category = metadata.category;
  if (isEmpty(tender.country) && !isEmpty(metadata.country)) update.country = metadata.country;
  if (isEmpty(tender.deadline) && metadata.deadline) update.deadline = metadata.deadline;
  if (isEmpty(tender.submissionMethod) && !isEmpty(metadata.submissionMethod)) update.submissionMethod = metadata.submissionMethod;
  if (isEmpty(tender.submissionAddress) && !isEmpty(metadata.submissionAddress)) update.submissionAddress = metadata.submissionAddress;
  if (isEmpty(tender.clientContactName) && !isEmpty(metadata.clientContactName)) update.clientContactName = metadata.clientContactName;
  if (isEmpty(tender.clientContactEmail) && !isEmpty(metadata.clientContactEmail)) update.clientContactEmail = metadata.clientContactEmail;
  if (isEmpty(tender.clientContactPhone) && !isEmpty(metadata.clientContactPhone)) update.clientContactPhone = metadata.clientContactPhone;
  if (isEmpty(tender.clientAddress) && !isEmpty(metadata.clientAddress)) update.clientAddress = metadata.clientAddress;

  const fields = Object.keys(update);
  if (fields.length === 0) {
    return {
      updated: false,
      fields: [],
      extractedClientName: metadata.clientName,
      message: metadata.clientName ? `Client name detected as ${metadata.clientName}, but stored tender metadata was not overwritten.` : "No reliable client name detected.",
    };
  }

  await client.tender.update({ where: { id: tenderId }, data: update });
  return {
    updated: true,
    fields,
    extractedClientName: typeof update.clientName === "string" ? update.clientName : metadata.clientName,
    message: fields.includes("clientName") ? `Client name auto-filled as ${update.clientName}.` : `Auto-filled ${fields.length} tender metadata field(s).`,
  };
}
