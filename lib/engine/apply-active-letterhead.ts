import { prisma } from "../prisma";
import { forbidsBranding } from "./scope-policy";
import { applyUploadedDocxLetterheadTemplate } from "./docx-letterhead-template";
import { inspectActualFileBytes } from "./persisted-byte-integrity";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

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
        select: { id: true, name: true, exactFileName: true, fileContent: true, contentSummary: true, storagePath: true },
      },
    },
  });

  if (!tender) throw new Error("Tender not found");
  if (forbidsBranding(tender.requirements)) return 0;

  const company = await prisma.company.findUnique({
    where: { userId },
    include: {
      settings: { select: { allowBrandingDefault: true } },
      assets: {
        where: { assetType: "LETTERHEAD", isActive: true },
        select: { fileContent: true, originalFileName: true, mimeType: true },
        take: 1,
      },
    },
  });

  // Honour the user's global AppSettings preference. The previous
  // implementation only checked tender-level prohibitions, so a user who had
  // turned branding off in settings still got letterhead applied. The default
  // when no AppSettings row exists is `true`, preserving prior behaviour.
  if (company?.settings && company.settings.allowBrandingDefault === false) return 0;

  const letterhead = company?.assets?.[0];
  if (!letterhead?.fileContent) return 0;
  if (!/wordprocessingml\.document|msword|octet-stream/i.test(letterhead.mimeType)) return 0;

  const templateBuffer = Buffer.from(letterhead.fileContent, "base64");
  if (!looksLikeDocx(templateBuffer)) return 0;

  let updated = 0;
  for (const doc of tender.generatedDocuments) {
    if (!doc.fileContent) continue;
    // Storage-backed rows: readers serve the storage object first, so the
    // inline copy may be stale. Branding it and making it canonical could
    // replace authoritative bytes — skip instead of guessing.
    if (doc.storagePath) continue;
    const generatedBuffer = Buffer.from(doc.fileContent, "base64");
    if (!looksLikeDocx(generatedBuffer)) continue;

    const applied = await applyUploadedDocxLetterheadTemplate(generatedBuffer, templateBuffer);
    if (applied.equals(generatedBuffer)) continue;

    // Re-pin persisted integrity from the LETTERHEADED bytes. Overwriting
    // fileContent while the stored digests still describe the pre-letterhead
    // bytes makes every verified-integrity read (final ZIP, download) fail
    // with a mismatch. Letterhead is cosmetic: if the branded bytes cannot
    // verify, keep the original document intact rather than degrade it.
    const integrity = inspectActualFileBytes({
      bytes: applied,
      filename: doc.exactFileName ?? `${doc.name}.docx`,
      claimedMimeType: DOCX_MIME,
    });
    if (integrity.integrityStatus !== "VERIFIED") continue;

    const summary = doc.contentSummary ?? "Generated document";
    await prisma.generatedDocument.update({
      where: { id: doc.id },
      data: {
        fileContent: applied.toString("base64"),
        ...integrity,
        // Legacy final-ZIP digest columns must describe the same bytes.
        sha256: integrity.contentSha256,
        byteSize: integrity.contentByteLength,
        contentSummary: /uploaded Word letterhead applied/i.test(summary) ? summary : `${summary} | uploaded Word letterhead applied: ${letterhead.originalFileName}`,
        updatedAt: new Date(),
      },
    });
    updated += 1;
  }

  return updated;
}
