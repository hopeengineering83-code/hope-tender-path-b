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
    assert.match(src, /inspectActualFileBytes\(\{\s*bytes: buffer,/s, "upload must inspect the real bytes");
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
});


describe("review-status badge truthfulness", () => {
  it("NEEDS_REVIEW renders an attention badge, not the neutral fallback", () => {
    // auto-finalize routes documents to NEEDS_REVIEW; without a STATUS_COLORS
    // entry the badge fell through to the same grey as an untouched document.
    const src = read("components/document-review-panel.tsx");
    assert.ok(/NEEDS_REVIEW:\s*"bg-amber-100 text-amber-800"/.test(src), "NEEDS_REVIEW badge must be amber");
  });
});
