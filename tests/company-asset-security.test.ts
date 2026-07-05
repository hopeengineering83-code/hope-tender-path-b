import assert from "node:assert/strict";
import { describe, it } from "node:test";
import JSZip from "jszip";
import {
  COMPANY_ASSET_MAX_BYTES,
  sanitizeCompanyAssetFileName,
  validateCompanyAsset,
} from "../lib/company-asset-security";

function fileInput(assetType: string, fileName: string, mimeType: string) {
  return { assetType, fileName, mimeType };
}

async function minimalDocx(extraEntries: Record<string, Uint8Array | string> = {}): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
  );
  zip.file(
    "word/document.xml",
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>',
  );
  for (const [name, bytes] of Object.entries(extraEntries)) zip.file(name, bytes);
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("company asset filename sanitization", () => {
  it("removes path traversal and control characters", () => {
    assert.equal(sanitizeCompanyAssetFileName("../../bad\u0000name.png"), "bad_name.png");
  });

  it("limits the stored filename length", () => {
    assert.ok(sanitizeCompanyAssetFileName(`${"a".repeat(300)}.png`).length <= 180);
  });
});

describe("company image asset validation", () => {
  it("accepts a valid PNG signature", async () => {
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const result = await validateCompanyAsset(fileInput("LOGO", "logo.png", "image/png"), buffer);
    assert.equal(result.ok, true);
    assert.equal(result.normalizedMime, "image/png");
  });

  it("rejects a disguised PNG", async () => {
    const result = await validateCompanyAsset(
      fileInput("SIGNATURE", "signature.png", "image/png"),
      Buffer.from("not-a-png"),
    );
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /PNG signature/i);
  });

  it("rejects truncated PNG and JPEG signatures", async () => {
    const png = await validateCompanyAsset(
      fileInput("LOGO", "logo.png", "image/png"),
      Buffer.from([0x89, 0x50]),
    );
    assert.equal(png.ok, false);
    assert.match(png.error ?? "", /PNG signature/i);

    const jpeg = await validateCompanyAsset(
      fileInput("STAMP", "stamp.jpg", "image/jpeg"),
      Buffer.from([0xff, 0xd8]),
    );
    assert.equal(jpeg.ok, false);
    assert.match(jpeg.error ?? "", /JPEG signature/i);
  });

  it("accepts a valid JPEG signature", async () => {
    const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    const result = await validateCompanyAsset(fileInput("STAMP", "stamp.jpeg", "image/jpeg"), buffer);
    assert.equal(result.ok, true);
    assert.equal(result.normalizedMime, "image/jpeg");
  });

  it("rejects PDF and SVG content for image assets", async () => {
    const pdf = await validateCompanyAsset(
      fileInput("STAMP", "stamp.pdf", "application/pdf"),
      Buffer.from("%PDF-1.4"),
    );
    assert.equal(pdf.ok, false);

    const svg = await validateCompanyAsset(
      fileInput("LOGO", "logo.svg", "image/svg+xml"),
      Buffer.from("<svg><script>alert(1)</script></svg>"),
    );
    assert.equal(svg.ok, false);
  });
});

describe("company letterhead validation", () => {
  it("accepts a minimal valid DOCX letterhead", async () => {
    const result = await validateCompanyAsset(
      fileInput(
        "LETTERHEAD",
        "letterhead.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
      await minimalDocx(),
    );
    assert.equal(result.ok, true);
  });

  it("rejects legacy DOC files", async () => {
    const result = await validateCompanyAsset(
      fileInput("LETTERHEAD", "letterhead.doc", "application/msword"),
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    );
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /DOCX/i);
  });

  it("rejects macro-enabled DOCX content", async () => {
    const result = await validateCompanyAsset(
      fileInput("LETTERHEAD", "letterhead.docx", "application/zip"),
      await minimalDocx({ "word/vbaProject.bin": Buffer.from([1, 2, 3]) }),
    );
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /Macro|ActiveX|embedded/i);
  });

  it("rejects embedded objects", async () => {
    const result = await validateCompanyAsset(
      fileInput("LETTERHEAD", "letterhead.docx", "application/zip"),
      await minimalDocx({ "word/embeddings/object1.bin": Buffer.from([1, 2, 3]) }),
    );
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /embedded/i);
  });

  it("rejects malformed archives", async () => {
    const result = await validateCompanyAsset(
      fileInput("LETTERHEAD", "letterhead.docx", "application/zip"),
      Buffer.from("PK-invalid"),
    );
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /corrupt|malformed/i);
  });
});

describe("company asset resource limits", () => {
  it("rejects empty files", async () => {
    const result = await validateCompanyAsset(fileInput("LOGO", "logo.png", "image/png"), Buffer.alloc(0));
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /Empty/i);
  });

  it("rejects files larger than the bounded storage limit", async () => {
    const result = await validateCompanyAsset(
      fileInput("LOGO", "logo.png", "image/png"),
      Buffer.alloc(COMPANY_ASSET_MAX_BYTES + 1),
    );
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /must not exceed/i);
  });
});
