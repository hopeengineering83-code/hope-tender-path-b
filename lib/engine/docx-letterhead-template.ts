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
      console.error(`[letterhead] Could not copy media ${name}:`, error);
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
export async function applyUploadedDocxLetterheadTemplate(
  generatedDocx: Buffer,
  letterheadDocx?: Buffer,
): Promise<Buffer> {
  if (!letterheadDocx?.length) return generatedDocx;

  try {
    const [generatedZip, templateZip] = await Promise.all([
      JSZip.loadAsync(generatedDocx),
      JSZip.loadAsync(letterheadDocx),
    ]);

    const templateDocumentXml = await templateZip.file("word/document.xml")?.async("string");
    const templateDocumentRels = await templateZip.file("word/_rels/document.xml.rels")?.async("string");
    if (!templateDocumentXml || !templateDocumentRels) return generatedDocx;

    const templateHeaderPath = defaultPartTarget(templateDocumentXml, templateDocumentRels, "header");
    const templateFooterPath = defaultPartTarget(templateDocumentXml, templateDocumentRels, "footer");

    const generatedHeaderPath = await firstGeneratedPart(generatedZip, "header");
    const generatedFooterPath = await firstGeneratedPart(generatedZip, "footer");

    let applied = false;
    if (templateHeaderPath) applied = (await copyPart(templateZip, generatedZip, templateHeaderPath, generatedHeaderPath)) || applied;
    if (templateFooterPath) applied = (await copyPart(templateZip, generatedZip, templateFooterPath, generatedFooterPath)) || applied;

    if (!applied) return generatedDocx;

    await copyTemplateMedia(templateZip, generatedZip);
    await ensureMediaContentTypes(generatedZip);

    return await generatedZip.generateAsync({ type: "nodebuffer" });
  } catch (error) {
    console.error("[letterhead] Failed to apply uploaded Word letterhead. Falling back to generated letterhead.", error);
    return generatedDocx;
  }
}
