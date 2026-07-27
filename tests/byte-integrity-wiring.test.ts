// Wiring regression tests — byte integrity must be pinned by EVERY writer.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("byte-integrity wiring — every writer pins at creation", () => {
  it("initial tender upload verifies actual bytes before storage and persists the integrity record", () => {
    const src = read("lib/background-tender-upload.ts");
    assert.ok(src.includes("inspectActualFileBytes({"), "upload must inspect the real bytes");
    assert.ok(src.includes('integrity.integrityStatus !== "VERIFIED"'), "upload must reject unverified bytes");
    assert.ok(src.indexOf("inspectActualFileBytes") < src.indexOf("storage.putFile"), "verification must precede storage");
    assert.ok(src.includes("...upload.integrity"), "TenderFile creation must persist the integrity record");
  });

  it("append and Company Vault upload verify bytes before storage", () => {
    const src = read("lib/background-secure-upload.ts");
    assert.ok(src.includes("inspectActualFileBytes({ bytes: buffer"));
    assert.ok(src.includes('integrity.integrityStatus !== "VERIFIED"'));
    assert.ok(src.indexOf("inspectActualFileBytes") < src.indexOf("storage.putFile"));
    assert.ok(src.includes("...integrity"));
  });

  it("background extraction re-verifies persisted bytes before parsing", () => {
    const src = read("lib/ai-jobs/tender-extraction-service.ts");
    assert.ok(src.includes("requireVerifiedPersistedFileBytes"));
    assert.ok(src.indexOf("requireVerifiedPersistedFileBytes") < src.indexOf("extractTextFromBuffer"));
    assert.ok(src.includes("sourceContentSha256"));
  });

  it("auto-finalize pins the rebuilt DOCX and never auto-approves unverified bytes", () => {
    const src = read("app/api/tenders/[id]/auto-finalize/route.ts");
    assert.ok(src.includes("rebuiltIntegrity"), "must inspect the rebuilt bytes");
    assert.ok(src.includes("...rebuiltIntegrity"), "must persist the integrity record");
    assert.ok(
      src.includes('rebuiltIntegrity.integrityStatus === "VERIFIED"'),
      "READY_FOR_EXPORT must require VERIFIED rebuilt bytes (fail closed to review)",
    );
    assert.ok(src.includes("integrityNotes"), "NEEDS_REVIEW notes must state the byte-integrity reason");
  });

  it("attach-original pins integrity and rejects non-verified originals before storing", () => {
    const src = read("app/api/tenders/[id]/documents/[docId]/attach-original/route.ts");
    assert.ok(src.includes("const attachedIntegrity = inspectActualFileBytes({ bytes: buffer, filename: outputName"));
    assert.ok(src.includes("...attachedIntegrity"));
    assert.ok(src.includes('attachedIntegrity.integrityStatus !== "VERIFIED"'));
    assert.ok(src.indexOf("const attachedIntegrity") < src.indexOf("putFile"));
  });

  it("generate-elite CV writes remain pinned", () => {
    const src = read("lib/engine/generate-elite.ts");
    assert.ok(src.includes("verifiedIntegrityDataFromBase64"));
  });

  it("writeGeneratedDocumentContent remains the verified-write helper", () => {
    const src = read("lib/generated-document-content.ts");
    assert.ok(src.includes("inspectActualFileBytes"));
    assert.ok(src.includes("contentSha256: integrity.contentSha256"));
  });
});

describe("review-status badge truthfulness", () => {
  it("NEEDS_REVIEW renders an attention badge, not the neutral fallback", () => {
    const src = read("components/document-review-panel.tsx");
    assert.ok(/NEEDS_REVIEW:\s*"bg-amber-100 text-amber-700"/.test(src));
  });
});
