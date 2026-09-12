/**
 * Auto-apply company signature and stamp images to generated DOCX documents.
 *
 * The App must put stamp and signature by itself — the user uploads all
 * necessary company documents (including signature and stamp images), and
 * the App uses those. Auto-approved — no manual approval required.
 *
 * This function runs AFTER document generation and AFTER letterhead application.
 * It inserts the active SIGNATURE and STAMP assets as images at the end of
 * each generated DOCX (after the last paragraph), respecting the tender's
 * signature/stamp policy (if the tender prohibits signatures/stamps, they
 * are not applied).
 *
 * Pattern mirrors lib/engine/apply-active-letterhead.ts:
 * - Fetch active SIGNATURE + STAMP assets from CompanyAsset
 * - For each generated DOCX, insert the images via JSZip + OOXML
 * - Re-pin byte integrity (SHA-256, byte length, MIME)
 * - Skip storage-backed rows (inline copy may be stale)
 * - Skip if tender policy prohibits signatures/stamps
 */

import { prisma } from "../prisma";
import { detectBrandingPolicy } from "./export-format-policy";
import { inspectActualFileBytes } from "./persisted-byte-integrity";
import JSZip from "jszip";
import { logger } from "../observability";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function looksLikeDocx(buffer: Buffer): boolean {
  return buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function looksLikeImage(buffer: Buffer): boolean {
  // PNG: 89 50 4E 47
  if (buffer.length > 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return true;
  // JPEG: FF D8 FF
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;
  return false;
}

function imageExtension(mimeType: string): string {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpeg";
  return "png";
}

function imageContentType(mimeType: string): string {
  if (mimeType.includes("png")) return "image/png";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "image/jpeg";
  return "image/png";
}

/**
 * Insert an image into a DOCX ZIP archive.
 *
 * Adds the image to word/media/, adds the image relationship to
 * word/_rels/document.xml.rels, adds the content type to
 * [Content_Types].xml, and inserts a <w:drawing> element at the end
 * of word/document.xml.
 *
 * Image size: 200x100 EMU (English Metric Units) for signature, 150x150 for stamp.
 * 1 inch = 914400 EMU. 200x100 EMU ≈ 0.02x0.01 inches (too small).
 * Actually: 200x100 pixels at 96 DPI ≈ 2x1 inches = 1828800x914400 EMU.
 * Let's use a reasonable default: signature 300x150 pixels, stamp 200x200 pixels.
 */
async function insertImageIntoDocx(
  docxBuffer: Buffer,
  imageBuffer: Buffer,
  imageExt: string,
  imageContentTypeStr: string,
  opts: { widthEmu: number; heightEmu: number; imageName: string },
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(docxBuffer);

  // 1. Add image to word/media/
  const mediaName = `word/media/${opts.imageName}.${imageExt}`;
  zip.file(mediaName, imageBuffer);

  // 2. Add content type to [Content_Types].xml
  const contentTypesXml = await zip.file("[Content_Types].xml")?.async("string");
  if (contentTypesXml) {
    const extPattern = new RegExp(`<Default[^>]+Extension=["']${imageExt}["']`, "i");
    let updatedContentTypes = contentTypesXml;
    if (!extPattern.test(contentTypesXml)) {
      updatedContentTypes = contentTypesXml.replace(
        "</Types>",
        `<Default Extension="${imageExt}" ContentType="${imageContentTypeStr}"/></Types>`,
      );
    }
    zip.file("[Content_Types].xml", updatedContentTypes);
  }

  // 3. Add relationship to word/_rels/document.xml.rels
  const relsPath = "word/_rels/document.xml.rels";
  const relsXml = await zip.file(relsPath)?.async("string");
  let nextRid = 1;
  let updatedRels = relsXml ?? "";
  if (relsXml) {
    const ridMatches = [...relsXml.matchAll(/Id=["']rId(\d+)["']/g)];
    if (ridMatches.length > 0) {
      nextRid = Math.max(...ridMatches.map((m) => parseInt(m[1], 10))) + 1;
    }
    const newRel = `<Relationship Id="rId${nextRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${opts.imageName}.${imageExt}"/>`;
    updatedRels = relsXml.replace("</Relationships>", `${newRel}</Relationships>`);
    zip.file(relsPath, updatedRels);
  }

  // 4. Insert <w:drawing> at the end of word/document.xml (before </w:body>)
  const docXml = await zip.file("word/document.xml")?.async("string");
  if (docXml) {
    const drawingXml = `
        <w:p>
          <w:r>
            <w:drawing>
              <wp:inline distT="0" distB="0" distL="0" distR="0">
                <wp:extent cx="${opts.widthEmu}" cy="${opts.heightEmu}"/>
                <wp:effectExtent l="0" t="0" r="0" b="0"/>
                <wp:docPr id="${nextRid}" name="${opts.imageName}"/>
                <wp:cNvGraphicFramePr>
                  <a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/>
                </wp:cNvGraphicFramePr>
                <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                  <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                    <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
                      <pic:nvPicPr>
                        <pic:cNvPr id="${nextRid}" name="${opts.imageName}"/>
                        <pic:cNvPicPr/>
                      </pic:nvPicPr>
                      <pic:blipFill>
                        <a:blip r:embed="rId${nextRid}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>
                        <a:stretch>
                          <a:fillRect/>
                        </a:stretch>
                      </pic:blipFill>
                      <pic:spPr>
                        <a:xfrm>
                          <a:off x="0" y="0"/>
                          <a:ext cx="${opts.widthEmu}" cy="${opts.heightEmu}"/>
                        </a:xfrm>
                        <a:prstGeom prst="rect">
                          <a:avLst/>
                        </a:prstGeom>
                      </pic:spPr>
                    </pic:pic>
                  </a:graphicData>
                </a:graphic>
              </wp:inline>
            </w:drawing>
          </w:r>
        </w:p>`;
    const updatedDocXml = docXml.replace("</w:body>", `${drawingXml}</w:body>`);
    zip.file("word/document.xml", updatedDocXml);
  }

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/**
 * Apply active uploaded signature and stamp images to every generated DOCX
 * for a tender. Returns the total number of images applied across all docs.
 */
export async function applyActiveSignatureAndStampToTenderDocuments(
  tenderId: string,
  userId: string,
): Promise<{ signatureApplied: number; stampApplied: number }> {
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

  // Resolve the tender's branding policy by scanning tender notes + requirement text
  // (same pattern as lib/tender-generation-readiness.ts:617)
  const tenderText = [
    tender.notes ?? "",
    ...tender.requirements.map((r: { title?: string | null; description?: string | null; restrictions?: string | null }) =>
      `${r.title ?? ""} ${r.description ?? ""} ${r.restrictions ?? ""}`,
    ),
  ].join("\n\n");
  const brandingPolicy = detectBrandingPolicy(tenderText);
  const forbidsSig = !brandingPolicy.signatureAllowed;
  const forbidsStmp = !brandingPolicy.stampAllowed;

  if (forbidsSig && forbidsStmp) {
    logger.info("[signature-stamp] tender prohibits both signature and stamp — skipping");
    return { signatureApplied: 0, stampApplied: 0 };
  }

  const company = await prisma.company.findUnique({
    where: { userId },
    include: {
      settings: { select: { allowSignatureDefault: true, allowStampDefault: true } },
      assets: {
        where: {
          assetType: { in: ["SIGNATURE", "STAMP"] },
          isActive: true,
        },
        select: { id: true, assetType: true, fileContent: true, originalFileName: true, mimeType: true },
      },
    },
  });

  // Honour AppSettings preferences
  const sigEnabled = company?.settings?.allowSignatureDefault !== false;
  const stampEnabled = company?.settings?.allowStampDefault !== false;

  const signatureAsset = company?.assets?.find((a) => a.assetType === "SIGNATURE");
  const stampAsset = company?.assets?.find((a) => a.assetType === "STAMP");

  if ((!signatureAsset?.fileContent || forbidsSig || !sigEnabled) && (!stampAsset?.fileContent || forbidsStmp || !stampEnabled)) {
    logger.info("[signature-stamp] no active signature/stamp assets or all disabled — skipping", {
      hasSignature: Boolean(signatureAsset?.fileContent),
      hasStamp: Boolean(stampAsset?.fileContent),
      forbidsSig,
      forbidsStmp,
      sigEnabled,
      stampEnabled,
    });
    return { signatureApplied: 0, stampApplied: 0 };
  }

  let signatureApplied = 0;
  let stampApplied = 0;

  for (const doc of tender.generatedDocuments) {
    if (!doc.fileContent) continue;
    // Storage-backed rows: skip (same pattern as letterhead applier)
    if (doc.storagePath) continue;

    let currentBuffer: Buffer = Buffer.from(doc.fileContent, "base64");
    if (!looksLikeDocx(currentBuffer)) continue;

    let modified = false;
    const docName = doc.exactFileName ?? `${doc.name}.docx`;

    // Apply signature
    if (signatureAsset?.fileContent && !forbidsSig && sigEnabled) {
      const sigBuffer = Buffer.from(signatureAsset.fileContent, "base64");
      if (looksLikeImage(sigBuffer)) {
        try {
          const ext = imageExtension(signatureAsset.mimeType);
          const ct = imageContentType(signatureAsset.mimeType);
          // Signature: 300x150 pixels at 96 DPI ≈ 3.125x1.5625 inches
          // 1 inch = 914400 EMU → 2857500x1428750 EMU
          const applied = await insertImageIntoDocx(currentBuffer, sigBuffer, ext, ct, {
            widthEmu: 2857500,
            heightEmu: 1428750,
            imageName: `signature_${doc.id.slice(0, 8)}`,
          });
          if (!applied.equals(currentBuffer)) {
            currentBuffer = applied as unknown as Buffer;
            modified = true;
            signatureApplied += 1;
          }
        } catch (e) {
          logger.warn("[signature-stamp] failed to apply signature to doc", {
            detail: e,
            docId: doc.id,
            docName,
          });
        }
      }
    }

    // Apply stamp
    if (stampAsset?.fileContent && !forbidsStmp && stampEnabled) {
      const stampBuffer = Buffer.from(stampAsset.fileContent, "base64");
      if (looksLikeImage(stampBuffer)) {
        try {
          const ext = imageExtension(stampAsset.mimeType);
          const ct = imageContentType(stampAsset.mimeType);
          // Stamp: 200x200 pixels at 96 DPI ≈ 2.08x2.08 inches
          // 1 inch = 914400 EMU → 1905000x1905000 EMU
          const applied = await insertImageIntoDocx(currentBuffer, stampBuffer, ext, ct, {
            widthEmu: 1905000,
            heightEmu: 1905000,
            imageName: `stamp_${doc.id.slice(0, 8)}`,
          });
          if (!applied.equals(currentBuffer)) {
            currentBuffer = applied as unknown as Buffer;
            modified = true;
            stampApplied += 1;
          }
        } catch (e) {
          logger.warn("[signature-stamp] failed to apply stamp to doc", {
            detail: e,
            docId: doc.id,
            docName,
          });
        }
      }
    }

    if (!modified) continue;

    // Re-pin byte integrity (same pattern as letterhead applier)
    const integrity = inspectActualFileBytes({
      bytes: currentBuffer,
      filename: docName,
      claimedMimeType: DOCX_MIME,
    });
    if (integrity.integrityStatus !== "VERIFIED") {
      logger.warn("[signature-stamp] byte integrity check failed after applying signature/stamp — keeping original", {
        docId: doc.id,
        docName,
      });
      continue;
    }

    const summary = doc.contentSummary ?? "Generated document";
    const tags: string[] = [];
    if (signatureAsset?.fileContent && !forbidsSig && sigEnabled) tags.push("signature applied");
    if (stampAsset?.fileContent && !forbidsStmp && stampEnabled) tags.push("stamp applied");
    const tagStr = tags.length > 0 ? ` | ${tags.join(", ")}` : "";

    await prisma.generatedDocument.update({
      where: { id: doc.id },
      data: {
        fileContent: currentBuffer.toString("base64"),
        ...integrity,
        sha256: integrity.contentSha256,
        byteSize: integrity.contentByteLength,
        contentSummary: /signature applied|stamp applied/i.test(summary) ? summary : `${summary}${tagStr}`,
        updatedAt: new Date(),
      },
    });
  }

  logger.info("[signature-stamp] auto-apply complete", {
    tenderId,
    signatureApplied,
    stampApplied,
  });

  return { signatureApplied, stampApplied };
}
