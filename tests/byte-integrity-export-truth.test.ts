// Byte-integrity export truth — closes the gaps that let a document be
// marked exportable while its persisted digests could never verify, or be
// permanently unexportable despite genuinely valid bytes.
//
// Gap set (all verified on main before this remediation):
// 1. apply-active-letterhead rewrote fileContent without re-pinning digests →
//    every letterheaded document failed verified-integrity reads.
// 2. The download route's final-ZIP digest check read ONLY the legacy
//    sha256/byteSize columns, which no writer populated → dead export path.
// 3. Tender-required filenames without an extension (or with legacy .doc/.xls
//    names) were UNSUPPORTED forever, even for valid modern Office bytes.
// 4. auto-finalize left a stale storagePath while rewriting inline bytes, and
//    its final readiness fetch omitted the very columns the byte gate reads.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  inspectActualFileBytes,
  requireVerifiedPersistedFileBytes,
} from "../lib/engine/persisted-byte-integrity";
import { validateFileSignature } from "../lib/engine/export-format-policy";

const read = (p: string) => readFileSync(p, "utf8");

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const fakeDocx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);
const fakePdf = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n");

describe("canonical helper — extensionless and legacy-named required files", () => {
  it("verifies DOCX bytes under an extensionless required name when the claimed MIME says DOCX", () => {
    const result = inspectActualFileBytes({ bytes: fakeDocx, filename: "Technical Proposal", claimedMimeType: DOCX_MIME });
    assert.equal(result.integrityStatus, "VERIFIED");
    assert.equal(result.detectedFormat, "DOCX");
    assert.equal(result.contentMimeType, DOCX_MIME);
  });

  it("stays fail-closed for an extensionless name with no informative claimed MIME", () => {
    const result = inspectActualFileBytes({ bytes: fakeDocx, filename: "Technical Proposal" });
    assert.equal(result.integrityStatus, "UNSUPPORTED");
  });

  it("verifies modern OOXML bytes under legacy .doc/.xls required names", () => {
    const doc = inspectActualFileBytes({ bytes: fakeDocx, filename: "Form-A.doc", claimedMimeType: DOCX_MIME });
    assert.equal(doc.integrityStatus, "VERIFIED");
    assert.equal(doc.detectedFormat, "DOCX");
    const legacyMime = inspectActualFileBytes({ bytes: fakeDocx, filename: "Form-A.doc", claimedMimeType: "application/msword" });
    assert.equal(legacyMime.integrityStatus, "VERIFIED", "legacy msword claimed MIME is an accepted alias for DOCX bytes");
  });

  it("still rejects genuinely wrong bytes under a .doc name", () => {
    const result = inspectActualFileBytes({ bytes: fakePdf, filename: "Form-A.doc", claimedMimeType: DOCX_MIME });
    assert.equal(result.integrityStatus, "MISMATCH");
    assert.equal(result.integrityFailureCode, "FILE_SIGNATURE_MISMATCH");
  });

  it("regression: mislabeled and unknown-extension files keep failing closed", () => {
    assert.equal(
      inspectActualFileBytes({ bytes: fakeDocx, filename: "report.pdf", claimedMimeType: "application/pdf" }).integrityStatus,
      "MISMATCH",
    );
    assert.equal(
      inspectActualFileBytes({ bytes: Buffer.from("abc"), filename: "payload.bin" }).integrityStatus,
      "UNSUPPORTED",
    );
  });

  it("round-trip: a pinned extensionless document verifies at read time via its recorded MIME", () => {
    const persisted = inspectActualFileBytes({ bytes: fakeDocx, filename: "Technical Proposal", claimedMimeType: DOCX_MIME });
    const result = requireVerifiedPersistedFileBytes({
      bytes: fakeDocx,
      filename: "Technical Proposal",
      // The read path passes the persisted contentMimeType as the claim.
      claimedMimeType: persisted.contentMimeType,
      persisted,
    });
    assert.equal(result.integrityStatus, "VERIFIED");
  });
});

describe("signature validation agrees with the integrity helper on extensionless names", () => {
  it("accepts recognizable bytes under an extensionless required name", () => {
    const pdf = validateFileSignature("Technical Proposal", fakePdf.toString("base64"));
    assert.ok(pdf.ok && pdf.detected === "pdf");
    const docx = validateFileSignature("Technical Proposal", fakeDocx.toString("base64"));
    assert.ok(docx.ok && docx.detected === "docx");
  });
  it("still fails closed for unrecognizable bytes and unknown extensions", () => {
    assert.equal(validateFileSignature("Technical Proposal", Buffer.from("plain nonsense").toString("base64")).ok, false);
    assert.equal(validateFileSignature("payload.bin", fakePdf.toString("base64")).ok, false);
    assert.equal(validateFileSignature("report.pdf", fakeDocx.toString("base64")).ok, false, "mislabeled bytes must keep failing");
  });
});

describe("read path verifies against the write-time recorded MIME", () => {
  it("readGeneratedDocumentContent prefers persisted contentMimeType over the extension guess", () => {
    const src = read("lib/generated-document-content.ts");
    assert.ok(src.includes("claimedMimeType: doc.contentMimeType ?? mimeType"), "read verification must use the recorded MIME when present");
  });
});

describe("letterhead application keeps integrity truthful", () => {
  const src = read("lib/engine/apply-active-letterhead.ts");
  it("re-pins persisted integrity from the letterheaded bytes", () => {
    assert.ok(src.includes("inspectActualFileBytes"), "must inspect the branded bytes");
    assert.ok(src.includes("...integrity"), "must persist the new integrity record");
    assert.ok(src.includes("sha256: integrity.contentSha256"), "must keep the legacy ZIP digest in sync");
    assert.ok(src.includes("byteSize: integrity.contentByteLength"), "must keep the legacy byte size in sync");
  });
  it("never degrades an exportable document with unverifiable branded bytes", () => {
    assert.ok(src.includes('if (integrity.integrityStatus !== "VERIFIED") continue;'), "cosmetic branding must be skipped when the result cannot verify");
  });
  it("does not brand rows whose canonical bytes live in storage", () => {
    assert.ok(src.includes("if (doc.storagePath) continue;"), "inline copy of a storage-backed row may be stale — skip");
  });
});

describe("final-ZIP digest verification accepts the canonical digest columns", () => {
  it("download route falls back from legacy sha256/byteSize to contentSha256/contentByteLength", () => {
    const src = read("app/api/tenders/[id]/download/route.ts");
    assert.ok(src.includes("(doc as any).sha256 ?? (doc as any).contentSha256 ?? null"), "sha256 fallback missing");
    assert.ok(src.includes("(doc as any).byteSize ?? (doc as any).contentByteLength ?? null"), "byteSize fallback missing");
  });
});

describe("writers keep both digest systems in sync", () => {
  it("persistGeneratedDocumentContent populates the legacy ZIP digest columns", () => {
    const src = read("lib/generated-document-content.ts");
    assert.ok(src.includes("sha256: integrity.contentSha256"), "central persist helper must fill sha256");
    assert.ok(src.includes("byteSize: integrity.contentByteLength"), "central persist helper must fill byteSize");
  });
  it("auto-finalize clears the stale storage pointer and fills legacy digests", () => {
    const src = read("app/api/tenders/[id]/auto-finalize/route.ts");
    assert.ok(src.includes("sha256: rebuiltIntegrity.contentSha256"), "rebuilt write must fill sha256");
    assert.ok(src.includes("storagePath: null"), "rebuilt bytes are inline — a stale pointer would serve the OLD object");
  });
  it("auto-finalize never rebuilds a storage-backed document from its inline copy", () => {
    // The rebuild reads only inline bytes; rebuilding a storage-backed row
    // would replace real content with a hollow shell built from the filename
    // and orphan/destroy the canonical object.
    const src = read("app/api/tenders/[id]/auto-finalize/route.ts");
    assert.ok(src.includes("if (!doc.fileContent || doc.storagePath) continue;"), "storage-backed and byte-less rows must be skipped");
  });
});

describe("auto-finalize readiness report reads what the byte gate needs", () => {
  it("final fetch includes file bytes and persisted integrity columns", () => {
    const src = read("app/api/tenders/[id]/auto-finalize/route.ts");
    const finalFetch = src.slice(src.indexOf("applyActiveUploadedLetterheadToTenderDocuments(tenderId"));
    for (const field of ["fileContent: true", "contentSha256: true", "contentByteLength: true", "contentMimeType: true", "detectedFormat: true", "integrityStatus: true"]) {
      assert.ok(finalFetch.includes(field), `final readiness fetch must select ${field}`);
    }
  });
});
