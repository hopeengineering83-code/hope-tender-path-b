import assert from "node:assert/strict";
import { describe, it } from "node:test";
import JSZip from "jszip";
import { validateUploadFile } from "../lib/upload-security";

function upload(name: string, type: string, bytes: Buffer): File {
  return new File([bytes], name, { type });
}

async function openXml(kind: "docx" | "xlsx", extra: Record<string, string | Buffer> = {}): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file(kind === "docx" ? "word/document.xml" : "xl/workbook.xml", "<root/>");
  for (const [name, value] of Object.entries(extra)) zip.file(name, value);
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("shared upload security", () => {
  it("rejects truncated magic signatures", async () => {
    const result = await validateUploadFile(upload("scan.pdf", "application/pdf", Buffer.from([0x25, 0x50])), Buffer.from([0x25, 0x50]));
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /signature/i);
  });

  it("rejects macro and embedded-object OpenXML payloads", async () => {
    const macro = await openXml("docx", { "word/vbaProject.bin": Buffer.from([1, 2, 3]) });
    const macroResult = await validateUploadFile(
      upload("proposal.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", macro),
      macro,
    );
    assert.equal(macroResult.ok, false);
    assert.match(macroResult.error ?? "", /Macro|ActiveX|embedded/i);

    const embedded = await openXml("xlsx", { "xl/embeddings/object1.bin": Buffer.from([1, 2, 3]) });
    const embeddedResult = await validateUploadFile(
      upload("rates.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", embedded),
      embedded,
    );
    assert.equal(embeddedResult.ok, false);
    assert.match(embeddedResult.error ?? "", /embedded/i);
  });

  it("rejects external-link OpenXML payloads", async () => {
    const workbook = await openXml("xlsx", { "xl/externalLinks/externalLink1.xml": "<externalLink/>" });
    const result = await validateUploadFile(
      upload("rates.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", workbook),
      workbook,
    );
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /external-link/i);
  });

  it("rejects legacy Office binaries that cannot be safely inspected", async () => {
    const legacy = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const result = await validateUploadFile(upload("old.doc", "application/msword", legacy), legacy);
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /Convert.*DOCX/i);
  });

  it("accepts minimal clean DOCX and XLSX archives", async () => {
    for (const kind of ["docx", "xlsx"] as const) {
      const bytes = await openXml(kind);
      const type = kind === "docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      const result = await validateUploadFile(upload(`clean.${kind}`, type, bytes), bytes);
      assert.equal(result.ok, true);
    }
  });
});
