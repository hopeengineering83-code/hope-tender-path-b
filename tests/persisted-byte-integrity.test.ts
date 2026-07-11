import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  computeByteSha256,
  detectActualByteFormat,
  inspectActualFileBytes,
  requireVerifiedPersistedFileBytes,
  verifyPersistedFileBytes,
} from "../lib/engine/persisted-byte-integrity";

const fakePdf = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF");
const fakeDocx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64, 0x41)]);

describe("persisted actual-byte integrity", () => {
  it("persists SHA-256, byte length, MIME and detected format for valid bytes", () => {
    const result = inspectActualFileBytes({
      bytes: fakePdf,
      filename: "Technical Proposal.pdf",
      claimedMimeType: "application/pdf",
      verifiedAt: new Date("2026-07-11T00:00:00.000Z"),
    });
    assert.equal(result.integrityStatus, "VERIFIED");
    assert.equal(result.contentSha256, computeByteSha256(fakePdf));
    assert.equal(result.contentByteLength, fakePdf.length);
    assert.equal(result.contentMimeType, "application/pdf");
    assert.equal(result.detectedFormat, "PDF");
    assert.equal(result.integrityFailureCode, null);
  });

  it("recognizes ZIP-container DOCX bytes only when the extension agrees", () => {
    assert.equal(detectActualByteFormat(fakeDocx, "proposal.docx"), "DOCX");
    const mismatch = inspectActualFileBytes({
      bytes: fakeDocx,
      filename: "proposal.pdf",
      claimedMimeType: "application/pdf",
    });
    assert.equal(mismatch.integrityStatus, "MISMATCH");
    assert.equal(mismatch.integrityFailureCode, "FILE_SIGNATURE_MISMATCH");
  });

  it("keeps legacy rows UNKNOWN even when their current bytes look valid", () => {
    const result = verifyPersistedFileBytes({
      bytes: fakePdf,
      filename: "proposal.pdf",
      claimedMimeType: "application/pdf",
      persisted: {
        contentSha256: null,
        contentByteLength: null,
        contentMimeType: null,
        detectedFormat: null,
        integrityStatus: "UNKNOWN",
      },
    });
    assert.equal(result.integrityStatus, "UNKNOWN");
    assert.equal(result.integrityFailureCode, "LEGACY_INTEGRITY_UNKNOWN");
  });

  it("detects byte tampering against a previously verified record", () => {
    const persisted = inspectActualFileBytes({
      bytes: fakePdf,
      filename: "proposal.pdf",
      claimedMimeType: "application/pdf",
    });
    const tampered = Buffer.concat([fakePdf, Buffer.from("\ntampered")]);
    const result = verifyPersistedFileBytes({
      bytes: tampered,
      filename: "proposal.pdf",
      claimedMimeType: "application/pdf",
      persisted,
    });
    assert.equal(result.integrityStatus, "MISMATCH");
    assert.equal(result.integrityFailureCode, "PERSISTED_BYTE_INTEGRITY_MISMATCH");
  });

  it("fails closed for zero bytes and unsupported extensions", () => {
    assert.equal(
      inspectActualFileBytes({ bytes: Buffer.alloc(0), filename: "empty.pdf" }).integrityStatus,
      "MISSING",
    );
    assert.equal(
      inspectActualFileBytes({ bytes: Buffer.from("abc"), filename: "payload.bin" }).integrityStatus,
      "UNSUPPORTED",
    );
  });

  it("authorizes use only when persisted and current integrity both verify", () => {
    const persisted = inspectActualFileBytes({
      bytes: fakePdf,
      filename: "proposal.pdf",
      claimedMimeType: "application/pdf",
    });
    const ok = requireVerifiedPersistedFileBytes({
      bytes: fakePdf,
      filename: "proposal.pdf",
      claimedMimeType: "application/pdf",
      persisted,
    });
    assert.equal(ok.integrityStatus, "VERIFIED");

    assert.throws(
      () =>
        requireVerifiedPersistedFileBytes({
          bytes: fakePdf,
          filename: "proposal.pdf",
          claimedMimeType: "application/pdf",
          persisted: { ...persisted, integrityStatus: "UNKNOWN" },
        }),
      /LEGACY_INTEGRITY_UNKNOWN/,
    );
  });
});
