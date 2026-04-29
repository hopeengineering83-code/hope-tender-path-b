import { prisma } from "../prisma";
import { forbidsBranding } from "./scope-policy";
import { applyUploadedDocxLetterheadTemplate } from "./docx-letterhead-template";

function isDocxFile(fileName: string | null | undefined): boolean {
  return Boolean(fileName && /\.docx$/i.test(fileName));
}

/**
 * Applies the active uploaded Word letterhead asset to every generated DOCX for
 * a tender after normal document generation completes.
 *
 * This is intentionally separate from the core generator so Claude/other tools
 * can keep changing proposal logic without breaking the letterhead overlay.
 */
export async function applyActiveUploadedLetterheadToTenderDocuments(tenderId: string, userId: string): Promise<number> {
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: {
      requirements: true,
      generatedDocuments: {
        where: { generationStatus: "GENERATED" },
        select: { id: true, exactFileName: true, name: true, fileContent: true, contentSummary: true },
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
  let updated = 0;

  for (const doc of tender.generatedDocuments) {
    const fileName = doc.exactFileName || doc.name;
    if (!doc.fileContent || !isDocxFile(fileName)) continue;

    const generatedBuffer = Buffer.from(doc.fileContent, "base64");
    const applied = await applyUploadedDocxLetterheadTemplate(generatedBuffer, templateBuffer);

    if (!applied.equals(generatedBuffer)) {
      await prisma.generatedDocument.update({
        where: { id: doc.id },
        data: {
          fileContent: applied.toString("base64"),
          contentSummary: `${doc.contentSummary ?? "Generated document"} | uploaded Word letterhead applied: ${letterhead.originalFileName}`,
          updatedAt: new Date(),
        },
      });
      updated += 1;
    }
  }

  return updated;
}
