import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { validateFileSignature } from "../lib/engine/export/export-format-policy";

describe("official original attachment signature policy", () => {
  it("accepts DOCX/OOXML package signatures", () => {
    const base64 = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]).toString("base64");
    const result = validateFileSignature("Tender-Form.docx", base64);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.detected, "docx");
  });

  it("accepts XLSX/OOXML package signatures", () => {
    const base64 = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]).toString("base64");
    const result = validateFileSignature("Rate-Card.xlsx", base64);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.detected, "xlsx");
  });

  it("accepts legacy Office OLE signatures", () => {
    const base64 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0x00, 0x00]).toString("base64");
    assert.equal(validateFileSignature("Legacy-Form.doc", base64).ok, true);
    assert.equal(validateFileSignature("Legacy-Workbook.xls", base64).ok, true);
  });

  it("rejects renamed files with mismatched signatures", () => {
    const docxBase64 = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]).toString("base64");
    const pdfResult = validateFileSignature("Renamed.pdf", docxBase64);
    assert.equal(pdfResult.ok, false);
  });
});
