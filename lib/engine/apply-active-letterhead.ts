import { prisma } from "../prisma";
import { forbidsBranding } from "./scope-policy";
import { applyUploadedDocxLetterheadTemplate } from "./docx-letterhead-template";

function looksLikeDocx(buffer: Buffer): boolean {
  return buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

/**
 * Applies the active uploaded Word letterhead asset to every generated DOCX for
 * a tender after normal document generation completes.
 *
 * Do not rely only on filenames ending in .docx. Some tender-required filenames
 * have no extension even though the generated fileContent is a DOCX buffer.
 */
export async function applyActiveUploadedLetterheadToTenderDocuments(tenderId: string, userId: string): Promise<number> {
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: {
      requirements: true,
      generatedDocuments: {
        where: { generationStatus: "GENERATED" },
        select: { id: true, fileContent: true, contentSummary: true },
      },
    },
  });

  if (!tender) throw new Error("Tender not found");
  if (forbidsBranding(tender.requirements)) return 0;

  const company = await prisma.company.findUnique({
    where: { userId },
    include: {
      assets: {
        where: { assetType: "LETTERHEAD", isActive: true },
        select: { fileContent: true, originalFileName: true, mimeType: true },
        take: 1,
      },
    },
  });

  const letterhead = company?.assets?.[0];
  if (!letterhead?.fileContent) return 0;
  if (!/wordprocessingml\.document|msword|octet-stream/i.test(letterhead.mimeType)) return 0;

  const templateBuffer = Buffer.from(letterhead.fileContent, "base64");
  if (!looksLikeDocx(templateBuffer)) return 0;

  let updated = 0;
  for (const doc of tender.generatedDocuments) {
    if (!doc.fileContent) continue;
    const generatedBuffer = Buffer.from(doc.fileContent, "base64");
    if (!looksLikeDocx(generatedBuffer)) continue;

    const applied = await applyUploadedDocxLetterheadTemplate(generatedBuffer, templateBuffer);
    if (applied.equals(generatedBuffer)) continue;

    const summary = doc.contentSummary ?? "Generated document";
    await prisma.generatedDocument.update({
      where: { id: doc.id },
      data: {
        fileContent: applied.toString("base64"),
        contentSummary: /uploaded Word letterhead applied/i.test(summary) ? summary : `${summary} | uploaded Word letterhead applied: ${letterhead.originalFileName}`,
        updatedAt: new Date(),
      },
    });
    updated += 1;
  }

  return updated;
}
