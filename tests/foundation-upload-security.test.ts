import { test, describe } from "node:test";
import assert from "node:assert";

describe("Upload Pipeline Security Logic", () => {
  function validateMagicBytes(buffer: Buffer, mimeType: string): boolean {
    if (mimeType === "application/pdf") {
      return buffer.length > 4 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
    }
    if (mimeType.includes("officedocument") || mimeType === "application/zip") {
      return buffer.length > 2 && buffer[0] === 0x50 && buffer[1] === 0x4b;
    }
    return true;
  }

  test("Validates PDF magic bytes", () => {
    const validPdf = Buffer.from("%PDF-1.4");
    const invalidPdf = Buffer.from("NOT-A-PDF");

    assert.strictEqual(validateMagicBytes(validPdf, "application/pdf"), true);
    assert.strictEqual(validateMagicBytes(invalidPdf, "application/pdf"), false);
  });

  test("Validates DOCX magic bytes (PK)", () => {
    const validDocx = Buffer.from("PK\x03\x04");
    assert.strictEqual(validateMagicBytes(validDocx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), true);
  });
});
