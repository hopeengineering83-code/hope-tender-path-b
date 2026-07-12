// Wiring regression tests — byte integrity must be pinned by EVERY writer.
//
// Main's canonical integrity system (persisted-byte-integrity: contentSha256 /
// integrityStatus) enforces verified integrity at read time
// (requireVerifiedIntegrity). That makes unpinned writers a functional hazard:
// rows they produce can never pass the verified-integrity read gate. These
// tests pin the three writers this remediation wired.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("byte-integrity wiring — every writer pins at creation", () => {
  it("tender upload pins TenderFile integrity from the actual uploaded bytes", () => {
    const src = read("lib/tender-upload-first.ts");
    assert.ok(src.includes("inspectActualFileBytes({ bytes: buffer"), "upload must inspect the real bytes");
    assert.ok(src.includes("...upload.integrity"), "tenderFile.create must persist the integrity record");
  });

  it("auto-finalize pins the rebuilt DOCX and never auto-approves unverified bytes", () => {
    const src = read("app/api/tenders/[id]/auto-finalize/route.ts");
    assert.ok(src.includes("rebuiltIntegrity"), "must inspect the rebuilt bytes");
    assert.ok(src.includes("...rebuiltIntegrity"), "must persist the integrity record");
    assert.ok(
      src.includes('rebuiltIntegrity.integrityStatus === "VERIFIED"'),
      "READY_FOR_EXPORT must require VERIFIED rebuilt bytes (fail closed to review)",
    );
    assert.ok(
      src.includes("integrityNotes"),
      "NEEDS_REVIEW notes must state the byte-integrity reason (truthful audit trail)",
    );
  });

  it("attach-original pins integrity and rejects non-verified originals before storing", () => {
    const src = read("app/api/tenders/[id]/documents/[docId]/attach-original/route.ts");
    assert.ok(src.includes("const attachedIntegrity = inspectActualFileBytes({ bytes: buffer, filename: outputName"), "attached original must be pinned from the actual bytes");
    assert.ok(src.includes("...attachedIntegrity"), "must persist the pinned integrity record");
    assert.ok(
      src.includes('attachedIntegrity.integrityStatus !== "VERIFIED"'),
      "must fail closed: never mark READY_FOR_EXPORT with unverifiable bytes",
    );
    assert.ok(
      src.indexOf("const attachedIntegrity") < src.indexOf("putFile"),
      "integrity must be checked BEFORE the storage write (no orphan blobs for rejected files)",
    );
  });

  it("generate-elite CV writes remain pinned (regression guard)", () => {
    const src = read("lib/engine/generate-elite.ts");
    assert.ok(src.includes("verifiedIntegrityDataFromBase64"), "CV writes must pin via the canonical helper");
  });

  it("writeGeneratedDocumentContent remains the verified-write helper (regression guard)", () => {
    const src = read("lib/generated-document-content.ts");
    assert.ok(src.includes("inspectActualFileBytes"), "central write helper must inspect bytes");
    assert.ok(src.includes("contentSha256: integrity.contentSha256"), "central write helper must persist the digest");
  });
});

describe("review-status badge truthfulness", () => {
  it("NEEDS_REVIEW renders an attention badge, not the neutral fallback", () => {
    // auto-finalize routes documents to NEEDS_REVIEW; without a STATUS_COLORS
    // entry the badge fell through to the same grey as an untouched document.
    const src = read("components/document-review-panel.tsx");
    assert.ok(/NEEDS_REVIEW:\s*"bg-amber-100 text-amber-700"/.test(src), "NEEDS_REVIEW badge must be amber");
  });
});
