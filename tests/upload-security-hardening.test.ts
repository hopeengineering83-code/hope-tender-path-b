import assert from "node:assert/strict";
import { describe, it } from "node:test";
import JSZip from "jszip";
import { MAX_UPLOAD_FILE_BYTES, validateUploadFile } from "../lib/upload-security";

function upload(name: string, type: string, bytes: Buffer): File {
  return new File([Uint8Array.from(bytes)], name, { type });
}

async function openXml(kind: "docx" | "xlsx", extra: Record<string, string | Buffer> = {}): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file(kind === "docx" ? "word/document.xml" : "xl/workbook.xml", "<root/>");
  for (const [name, value] of Object.entries(extra)) zip.file(name, value);
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("shared upload security", () => {
  it("accepts PDF, DOCX, XLSX, CSV, and TXT Company Vault sources", async () => {
    const docx = await openXml("docx");
    const xlsx = await openXml("xlsx");
    const fixtures = [
      ["source.pdf", "application/pdf", Buffer.from("%PDF-1.7\nvalid fixture")],
      ["source.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", docx],
      ["source.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xlsx],
      ["source.csv", "text/csv", Buffer.from("name,value\nHope,1\n")],
      ["source.txt", "text/plain", Buffer.from("Plain Company Vault source text")],
    ] as const;

    for (const [name, type, bytes] of fixtures) {
      const result = await validateUploadFile(upload(name, type, bytes), bytes);
      assert.equal(result.ok, true, `${name}: ${result.error ?? "unexpected rejection"}`);
    }
  });

  it("rejects JSON as a staging descriptor with an exact Company Vault instruction", async () => {
    const bytes = Buffer.from('{"sourceDocuments":[]}');
    const result = await validateUploadFile(upload("plan-b.json", "application/json", bytes), bytes);
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /Plan B staging descriptor/i);
    assert.match(result.error ?? "", /PDF, DOCX, XLSX, CSV, and TXT/i);
  });

  it("rejects legacy DOC and XLS with conversion instructions", async () => {
    const legacy = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    for (const [name, type] of [
      ["old.doc", "application/msword"],
      ["old.xls", "application/vnd.ms-excel"],
    ] as const) {
      const result = await validateUploadFile(upload(name, type, legacy), legacy);
      assert.equal(result.ok, false);
      assert.match(result.error ?? "", /Convert DOC to DOCX or XLS to XLSX/i);
    }
  });

  it("rejects oversized, unsupported, and empty files precisely", async () => {
    const oversized = Buffer.alloc(MAX_UPLOAD_FILE_BYTES + 1, 0x61);
    const oversizedResult = await validateUploadFile(upload("large.txt", "text/plain", oversized), oversized);
    assert.equal(oversizedResult.ok, false);
    assert.match(oversizedResult.error ?? "", /10 MB per-file limit/i);

    const unsupported = Buffer.from("image bytes");
    const unsupportedResult = await validateUploadFile(upload("image.png", "image/png", unsupported), unsupported);
    assert.equal(unsupportedResult.ok, false);
    assert.match(unsupportedResult.error ?? "", /Unsupported file type/i);
    assert.match(unsupportedResult.error ?? "", /PDF, DOCX, XLSX, CSV, and TXT/i);

    const empty = Buffer.alloc(0);
    const emptyResult = await validateUploadFile(upload("empty.txt", "text/plain", empty), empty);
    assert.equal(emptyResult.ok, false);
    assert.match(emptyResult.error ?? "", /empty/i);
  });

  it("rejects invalid PDF, Office, and text content precisely", async () => {
    const invalidPdf = Buffer.from("not a pdf");
    const pdfResult = await validateUploadFile(upload("scan.pdf", "application/pdf", invalidPdf), invalidPdf);
    assert.equal(pdfResult.ok, false);
    assert.match(pdfResult.error ?? "", /Invalid PDF file.*signature/i);

    const invalidDocx = Buffer.from("not a zip");
    const docxResult = await validateUploadFile(
      upload("proposal.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", invalidDocx),
      invalidDocx,
    );
    assert.equal(docxResult.ok, false);
    assert.match(docxResult.error ?? "", /Invalid DOCX file.*signature/i);

    const binaryText = Buffer.from([0x61, 0x00, 0x62]);
    const textResult = await validateUploadFile(upload("source.txt", "text/plain", binaryText), binaryText);
    assert.equal(textResult.ok, false);
    assert.match(textResult.error ?? "", /binary content/i);
  });

  it("rejects macro, embedded-object, and external-link OpenXML payloads", async () => {
    const macro = await openXml("docx", { "word/vbaProject.bin": Buffer.from([1, 2, 3]) });
    const macroResult = await validateUploadFile(
      upload("proposal.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", macro),
      macro,
    );
    assert.equal(macroResult.ok, false);
    assert.match(macroResult.error ?? "", /macros|ActiveX|embedded/i);

    const embedded = await openXml("xlsx", { "xl/embeddings/object1.bin": Buffer.from([1, 2, 3]) });
    const embeddedResult = await validateUploadFile(
      upload("rates.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", embedded),
      embedded,
    );
    assert.equal(embeddedResult.ok, false);
    assert.match(embeddedResult.error ?? "", /embedded/i);

    const workbook = await openXml("xlsx", { "xl/externalLinks/externalLink1.xml": "<externalLink/>" });
    const externalResult = await validateUploadFile(
      upload("rates.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", workbook),
      workbook,
    );
    assert.equal(externalResult.ok, false);
    assert.match(externalResult.error ?? "", /external links/i);
  });
});
