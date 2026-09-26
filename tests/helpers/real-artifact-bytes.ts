// Genuine artifact bytes for tests.
//
// ZIP-assembly fixtures used to pass placeholder strings — Buffer.from("technical
// bytes") for a .docx entry, Buffer.from("financial bytes") for an .xlsx. Those
// are not documents: a .docx holding plain text does not open in Word, so a
// package built from them would be a failed submission.
//
// assembleFinalSubmissionZip now verifies that each entry's bytes match its
// name and declared format (lib/engine/artifact-identity.ts), which those
// placeholders correctly fail. Tests assert over real artifacts instead — one
// helper so every suite means the same thing by "a DOCX".

import JSZip from "jszip";

/** A real OOXML package: PK zip container with a word/document.xml part. */
export async function realDocxBytes(text = "Technical narrative content."): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

/** A real OOXML spreadsheet package — also a PK zip, like DOCX. */
export async function realXlsxBytes(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file("xl/workbook.xml", '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets/></workbook>');
  return zip.generateAsync({ type: "nodebuffer" });
}

/** A minimal file that genuinely begins with the %PDF- signature. */
export function realPdfBytes(text = "Technical Proposal"): Buffer {
  const body = `%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n% ${text}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

/** Real bytes matching whatever the file name claims. */
export async function realBytesFor(fileName: string): Promise<Buffer> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return realPdfBytes(fileName);
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return realXlsxBytes();
  return realDocxBytes(`Content for ${fileName}`);
}
