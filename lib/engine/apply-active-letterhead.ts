import { prisma } from "../prisma";
import { getStorageAdapter } from "../storage";
import { forbidsBranding } from "./scope-policy";
import { applyUploadedDocxLetterheadTemplateWithReason } from "./docx-letterhead-template";
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
/**
 * Why letterhead reached the documents it reached.
 *
 * `applied` is the count the callers already reported. `reason` explains a
 * zero. Reproduced defect: this function returns 0 through SEVEN distinct
 * exits and every surface showed only the number, so an owner whose branding
 * silently never appeared had nothing to act on — and diagnosing one real case
 * took a full session of hosted runs to rule the exits out one at a time.
 * No behaviour changes here: the same documents are branded or skipped as
 * before.
 */
export type LetterheadApplicationResult = {
  applied: number;
  /** Null when letterhead was applied to at least one document. */
  reason: string | null;
};

export async function applyActiveUploadedLetterheadToTenderDocuments(
  tenderId: string,
  userId: string,
): Promise<LetterheadApplicationResult> {
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
  if (forbidsBranding(tender.requirements)) {
    return { applied: 0, reason: "The tender prohibits company branding, so letterhead was deliberately not applied." };
  }

  const company = await prisma.company.findUnique({
    where: { userId },
    include: {
      settings: { select: { allowBrandingDefault: true } },
      assets: {
        where: { assetType: "LETTERHEAD", isActive: true },
        // storagePath belongs here. Brand assets are not always inline: the
        // upload path can persist the bytes to private storage and leave
        // fileContent null, and selecting only fileContent made a
        // storage-backed letterhead indistinguishable from no letterhead.
        select: { fileContent: true, storagePath: true, originalFileName: true, mimeType: true },
        take: 1,
      },
    },
  });

  // Honour the user's global AppSettings preference. The previous
  // implementation only checked tender-level prohibitions, so a user who had
  // turned branding off in settings still got letterhead applied. The default
  // when no AppSettings row exists is `true`, preserving prior behaviour.
  if (company?.settings && company.settings.allowBrandingDefault === false) {
    return { applied: 0, reason: "Company branding is turned off in Settings (allowBrandingDefault), so letterhead was deliberately not applied." };
  }

  const letterhead = company?.assets?.[0];
  if (!letterhead) {
    return { applied: 0, reason: "No active LETTERHEAD asset was found in the Company Vault." };
  }

  // Reproduced defect (live Preview, tender 50940b8b, 2026-09-11). The
  // delivered 37-page PDF contained ZERO embedded images, and the generation
  // job explained itself:
  //
  //   letterhead applied to 0 file(s) — No active LETTERHEAD asset with
  //   stored bytes was found in the Company Vault.
  //
  // The Company Vault held it all along:
  //
  //   LETTERHEAD LetterHead_repaired.docx 126,100 B active VERIFIED
  //              inline=False storage=True
  //
  // All three brand assets were storage-backed, none inline. This function
  // read `fileContent` and nothing else, so "no stored bytes" was reported
  // about an asset whose bytes were stored — just not inline. The owner is
  // then told their vault is missing something it is not missing, which sends
  // them to re-upload a file that was never the problem.
  //
  // Storage-backed content is normal here and the codebase already has one way
  // to read it: getStorageAdapter().getFile(), as checkDocxHygieneReadiness
  // does for generated documents. This uses that same path rather than
  // inventing a second one.
  let letterheadBase64 = letterhead.fileContent ?? null;
  if (!letterheadBase64 && letterhead.storagePath) {
    try {
      const bytes = await getStorageAdapter().getFile({
        storagePath: letterhead.storagePath,
        fileContent: null,
        fileName: letterhead.originalFileName ?? "letterhead.docx",
      });
      letterheadBase64 = bytes.toString("base64");
    } catch (error) {
      // Naming the failure beats reporting it as an absent asset: one is a
      // storage problem to investigate, the other sends the owner to re-upload.
      const detail = error instanceof Error ? error.message : String(error);
      return {
        applied: 0,
        reason: `The active letterhead "${letterhead.originalFileName}" is stored but its bytes could not be read back from storage (${detail}).`,
      };
    }
  }
  if (!letterheadBase64) {
    return { applied: 0, reason: "No active LETTERHEAD asset with stored bytes was found in the Company Vault." };
  }
  if (!/wordprocessingml\.document|msword|octet-stream/i.test(letterhead.mimeType)) {
    return { applied: 0, reason: `The active letterhead is a ${letterhead.mimeType} file. Letterhead is applied by copying Word header/footer parts, so it must be uploaded as a .docx — a PDF or image letterhead cannot be used this way.` };
  }

  const templateBuffer = Buffer.from(letterheadBase64, "base64");
  if (!looksLikeDocx(templateBuffer)) {
    return { applied: 0, reason: `The active letterhead "${letterhead.originalFileName}" is declared as a Word document but its bytes are not a .docx package. Re-save it from Word and upload it again.` };
  }

  let updated = 0;
  // Per-document skips, kept so a zero can name the documents it skipped and
  // why, instead of collapsing every cause into the same silent 0.
  const skipped: string[] = [];
  for (const doc of tender.generatedDocuments) {
    const label = doc.exactFileName ?? doc.name ?? doc.id;
    if (!doc.fileContent) { skipped.push(`${label}: no stored bytes`); continue; }
    // Storage-backed rows: readers serve the storage object first, so the
    // inline copy may be stale. Branding it and making it canonical could
    // replace authoritative bytes — skip instead of guessing.
    if (doc.storagePath) { skipped.push(`${label}: stored in object storage, which this step will not overwrite`); continue; }
    const generatedBuffer = Buffer.from(doc.fileContent, "base64");
    if (!looksLikeDocx(generatedBuffer)) { skipped.push(`${label}: not a DOCX, so there is no header/footer to brand`); continue; }

    const outcome = await applyUploadedDocxLetterheadTemplateWithReason(generatedBuffer, templateBuffer);
    const applied = outcome.buffer;
    if (!outcome.applied || applied.equals(generatedBuffer)) {
      skipped.push(`${label}: ${outcome.reason ?? "the letterhead produced no change"}`);
      continue;
    }

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
    if (integrity.integrityStatus !== "VERIFIED") { skipped.push(`${label}: the branded bytes failed integrity verification, so the original was kept`); continue; }

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

  if (updated > 0) return { applied: updated, reason: null };
  if (tender.generatedDocuments.length === 0) {
    return { applied: 0, reason: "This tender has no generated documents to brand yet." };
  }
  return { applied: 0, reason: `Letterhead reached none of the ${tender.generatedDocuments.length} generated document(s). ${skipped.join("; ")}.` };
}
