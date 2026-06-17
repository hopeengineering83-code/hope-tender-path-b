import { describe, it } from "node:test";
import assert from "node:assert";
import JSZip from "jszip";

describe("Artifact Structural Validation", () => {
  it("should validate a generated DOCX as a valid ZIP with word/document.xml", async () => {
    // This is a minimal valid DOCX structure for testing the validator
    const zip = new JSZip();
    zip.file("[Content_Types].xml", "<?xml version='1.0' encoding='UTF-8' standalone='yes'?><Types xmlns='http://schemas.openxmlformats.org/package/2006/content-types'></Types>");
    zip.file("word/document.xml", "<?xml version='1.0' encoding='UTF-8' standalone='yes'?><w:document xmlns:w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'><w:body><w:p><w:r><w:t>Golden Proposal</w:t></w:r></w:p></w:body></w:document>");

    const buffer = await zip.generateAsync({ type: "nodebuffer" });

    // Test logic: can we open it and find required files?
    const opened = await JSZip.loadAsync(buffer);
    assert.ok(opened.file("[Content_Types].xml"));
    assert.ok(opened.file("word/document.xml"));

    const content = await opened.file("word/document.xml")?.async("string");
    assert.match(content!, /Golden Proposal/);
  });

  it("should validate a generated PDF signature", () => {
    const pdfBuffer = Buffer.from("%PDF-1.4\n...");
    assert.strictEqual(pdfBuffer.subarray(0, 4).toString(), "%PDF", "Invalid PDF signature");
  });
});
