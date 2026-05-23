import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { generatedDocumentHasContent, readGeneratedDocumentContent } from "../lib/generated-document-content";

describe("generated-document-content adapter", () => {
  it("reads legacy base64 content and reports legacy source", async () => {
    const base64 = Buffer.from("hello world").toString("base64");
    const out = await readGeneratedDocumentContent({ id: "d1", name: "Tech", exactFileName: "Tech.docx", fileContent: base64 });
    assert.equal(out.source, "legacy");
    assert.equal(out.filename, "Tech.docx");
    assert.equal(out.buffer.toString("utf8"), "hello world");
  });

  it("returns PDF mimeType when filename ends in .pdf", async () => {
    const base64 = Buffer.from("%PDF-1.4 test").toString("base64");
    const out = await readGeneratedDocumentContent({ id: "d2", name: "Financial", exactFileName: "Financial.pdf", fileContent: base64 });
    assert.equal(out.mimeType, "application/pdf");
  });

  it("falls back to octet-stream mimeType for unknown extensions", async () => {
    const base64 = Buffer.from("binary").toString("base64");
    const out = await readGeneratedDocumentContent({ id: "d3", name: "Bundle", exactFileName: "Bundle.bin", fileContent: base64 });
    assert.equal(out.mimeType, "application/octet-stream");
  });

  it("has content when storagePath exists even if fileContent is empty", () => {
    const ok = generatedDocumentHasContent({ storagePath: "/tmp/obj/path", fileContent: null });
    assert.equal(ok, true);
  });

  it("returns false when both storagePath and fileContent are missing", () => {
    const ok = generatedDocumentHasContent({ storagePath: null, fileContent: null });
    assert.equal(ok, false);
  });
});
