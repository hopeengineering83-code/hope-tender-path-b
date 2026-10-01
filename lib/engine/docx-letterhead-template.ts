import { logger } from "../observability";
import JSZip from "jszip";

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function normalizeWordPath(target: string): string {
  const clean = target.replace(/^\.\//, "");
  return clean.startsWith("word/") ? clean : `word/${clean}`;
}

function relationshipTarget(relsXml: string, rid: string): string | null {
  const relationship = new RegExp(`<Relationship[^>]+Id=["']${rid}["'][^>]+>`, "i").exec(relsXml)?.[0];
  if (!relationship) return null;
  return /Target=["']([^"']+)["']/i.exec(relationship)?.[1] ?? null;
}

function defaultPartTarget(documentXml: string, relsXml: string, kind: "header" | "footer"): string | null {
  const ref = new RegExp(`<w:${kind}Reference[^>]+w:type=["']default["'][^>]+r:id=["']([^"']+)["'][^>]*/?>`, "i").exec(documentXml)
    ?? new RegExp(`<w:${kind}Reference[^>]+r:id=["']([^"']+)["'][^>]*/?>`, "i").exec(documentXml);
  if (!ref?.[1]) return null;
  const target = relationshipTarget(relsXml, ref[1]);
  return target ? normalizeWordPath(target) : null;
}

function ensureContentType(xml: string, extension: string, contentType: string): string {
  const pattern = new RegExp(`<Default[^>]+Extension=["']${extension}["']`, "i");
  if (pattern.test(xml)) return xml;
  return xml.replace("</Types>", `<Default Extension="${extension}" ContentType="${contentType}"/></Types>`);
}

async function firstGeneratedPart(zip: JSZip, kind: "header" | "footer"): Promise<string> {
  const pattern = new RegExp(`^word/${kind}\\d+\\.xml$`);
  const existing = Object.keys(zip.files).find((name) => pattern.test(name));
  return existing ?? `word/${kind}1.xml`;
}

async function copyPart(templateZip: JSZip, generatedZip: JSZip, templatePath: string, generatedPath: string) {
  const templateXml = await templateZip.file(templatePath)?.async("string");
  if (!templateXml) return false;

  generatedZip.file(generatedPath, templateXml);

  const templateRelsPath = `word/_rels/${basename(templatePath)}.rels`;
  const generatedRelsPath = `word/_rels/${basename(generatedPath)}.rels`;
  const templateRels = await templateZip.file(templateRelsPath)?.async("string");
  if (templateRels) generatedZip.file(generatedRelsPath, templateRels);

  return true;
}

async function copyTemplateMedia(templateZip: JSZip, generatedZip: JSZip) {
  const mediaNames = Object.keys(templateZip.files).filter((name) => name.startsWith("word/media/"));
  for (const name of mediaNames) {
    const file = templateZip.file(name);
    if (!file) continue;
    try {
      const data = await file.async("nodebuffer");
      generatedZip.file(name, data);
    } catch (error) {
      logger.error(`[letterhead] Could not copy media ${name}:`, { detail: error });
    }
  }
}

async function ensureMediaContentTypes(generatedZip: JSZip) {
  const contentTypesPath = "[Content_Types].xml";
  const xml = await generatedZip.file(contentTypesPath)?.async("string");
  if (!xml) return;
  let next = xml;
  next = ensureContentType(next, "jpeg", "image/jpeg");
  next = ensureContentType(next, "jpg", "image/jpeg");
  next = ensureContentType(next, "png", "image/png");
  generatedZip.file(contentTypesPath, next);
}

/**
 * Applies the active uploaded Word letterhead to a generated DOCX.
 *
 * The generator first creates a normal DOCX with header/footer placeholders.
 * This helper then copies the uploaded template's default Word header/footer
 * parts into those generated parts so the original letterhead layout repeats
 * on every page of the generated document.
 */
/** Why an uploaded letterhead did or did not reach the document. */
export type LetterheadTemplateOutcome = {
  buffer: Buffer;
  applied: boolean;
  /** Owner-readable explanation. Null only when the letterhead was applied. */
  reason: string | null;
};

/**
 * Same work as applyUploadedDocxLetterheadTemplate, but it says what happened.
 *
 * Reproduced defect: on tender 08e250af every PROPOSAL_GENERATION run recorded
 * "letterhead applied to 0 file(s)" with an active, valid Word letterhead
 * (LetterHead_repaired.docx, 126,100 bytes) and no branding prohibition. Five
 * candidate causes were ruled out one at a time against live data over a whole
 * session, because the only thing any surface reported was the number zero. An
 * owner has strictly less information than that, and would simply see branding
 * silently missing from their documents.
 *
 * This returns WHY. It changes no behaviour and weakens no gate — the same
 * bytes come back in the same cases; the difference is that the caller can now
 * tell the owner what to fix.
 */
export async function applyUploadedDocxLetterheadTemplateWithReason(
  generatedDocx: Buffer,
  letterheadDocx?: Buffer,
): Promise<LetterheadTemplateOutcome> {
  if (!letterheadDocx?.length) {
    return { buffer: generatedDocx, applied: false, reason: "No letterhead template bytes were supplied." };
  }

  try {
    const [generatedZip, templateZip] = await Promise.all([
      JSZip.loadAsync(generatedDocx),
      JSZip.loadAsync(letterheadDocx),
    ]);

    const templateDocumentXml = await templateZip.file("word/document.xml")?.async("string");
    const templateDocumentRels = await templateZip.file("word/_rels/document.xml.rels")?.async("string");
    if (!templateDocumentXml || !templateDocumentRels) {
      return {
        buffer: generatedDocx,
        applied: false,
        reason: "The uploaded letterhead is not a readable Word document: it has no word/document.xml. Re-save it from Word as .docx and upload it again.",
      };
    }

    const templateHeaderPath = defaultPartTarget(templateDocumentXml, templateDocumentRels, "header");
    const templateFooterPath = defaultPartTarget(templateDocumentXml, templateDocumentRels, "footer");

    // This is the case that is easy to get wrong and impossible to see. Word
    // letterhead is only repeated on every page when it lives in the page
    // HEADER or FOOTER. A letterhead whose logo and address sit in the
    // document BODY is a perfectly valid .docx and looks correct to the owner,
    // but there is no part to copy, so nothing can be applied.
    if (!templateHeaderPath && !templateFooterPath) {
      return {
        buffer: generatedDocx,
        applied: false,
        reason: "The uploaded letterhead has no page header or footer. Word only repeats letterhead on every page when the logo and address sit in the header/footer area, so there was nothing to copy. Open the letterhead in Word, move the branding into Header & Footer, save, and upload it again.",
      };
    }

    const generatedHeaderPath = await firstGeneratedPart(generatedZip, "header");
    const generatedFooterPath = await firstGeneratedPart(generatedZip, "footer");

    let applied = false;
    if (templateHeaderPath) applied = (await copyPart(templateZip, generatedZip, templateHeaderPath, generatedHeaderPath)) || applied;
    if (templateFooterPath) applied = (await copyPart(templateZip, generatedZip, templateFooterPath, generatedFooterPath)) || applied;

    if (!applied) {
      return {
        buffer: generatedDocx,
        applied: false,
        reason: `The uploaded letterhead names a header/footer part (${templateHeaderPath ?? templateFooterPath}) that is missing from the file. Re-save it from Word as .docx and upload it again.`,
      };
    }

    await copyTemplateMedia(templateZip, generatedZip);
    await ensureMediaContentTypes(generatedZip);

    return { buffer: await generatedZip.generateAsync({ type: "nodebuffer" }), applied: true, reason: null };
  } catch (error) {
    logger.error("[letterhead] Failed to apply uploaded Word letterhead. Falling back to generated letterhead.", { detail: error });
    return {
      buffer: generatedDocx,
      applied: false,
      reason: `The uploaded letterhead could not be opened as a Word document (${error instanceof Error ? error.message : "unknown error"}).`,
    };
  }
}

export async function applyUploadedDocxLetterheadTemplate(
  generatedDocx: Buffer,
  letterheadDocx?: Buffer,
): Promise<Buffer> {
  return (await applyUploadedDocxLetterheadTemplateWithReason(generatedDocx, letterheadDocx)).buffer;
}
