// Defect 3 contract test: restore-vault-bytes repair step.
//
// The admin repair route must support a `step=restore-vault-bytes` operation
// that:
//   1. Re-runs inspectActualFileBytes against each tenant-owned
//      CompanyDocument's persisted bytes — restoring contentSha256,
//      contentByteLength, contentMimeType, detectedFormat, integrityStatus.
//   2. Re-extracts text using the DETECTED mime type (not the persisted,
//      possibly tampered one).
//   3. Detects the "official bytes lost" case (Plan B synthetic JSON
//      overwrote a real PDF/DOCX upload) and surfaces OFFICIAL_BYTES_LOST.
//   4. Invalidates stale provenance on dependent Expert/Project/Legal/
//      Financial/Compliance rows whose sourceDocumentId points at the
//      repaired document.
//
// This is a source-contract test — it scans the route source to assert
// each piece of the contract is present. A full DB-integration test would
// require a real PostgreSQL database; this catches regressions where a
// refactor drops one of the pieces.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const route = readFileSync("app/api/admin/repair/route.ts", "utf8");

describe("Defect 3 — restore-vault-bytes repair step contract", () => {
  it("declares 'restore-vault-bytes' in AdminRepairStep and ADMIN_REPAIR_STEPS", () => {
    assert.match(route, /"restore-vault-bytes"/);
    // The set must include it.
    const setIdx = route.indexOf("ADMIN_REPAIR_STEPS = new Set");
    assert.ok(setIdx > -1);
    const setRegion = route.slice(setIdx, setIdx + 400);
    assert.match(setRegion, /"restore-vault-bytes"/);
  });

  it("imports inspectActualFileBytes from persisted-byte-integrity", () => {
    assert.match(
      route,
      /import\s+\{[^}]*inspectActualFileBytes[^}]*\}\s+from\s+"[^"]*persisted-byte-integrity"/,
    );
  });

  it("has a step === 'restore-vault-bytes' branch that loads tenant-owned documents", () => {
    const idx = route.indexOf('step === "restore-vault-bytes"');
    assert.ok(idx > -1, "must have a restore-vault-bytes branch");
    const region = route.slice(idx, idx + 4000);
    // Loads CompanyDocuments owned by this tenant with fileContent or storagePath.
    assert.match(region, /prisma\.companyDocument\.findMany/);
    assert.match(region, /companyId: company\.id/);
    // Selects the byte-integrity fields needed to detect a change.
    assert.match(region, /contentSha256: true/);
    assert.match(region, /contentByteLength: true/);
    assert.match(region, /integrityStatus: true/);
    assert.match(region, /mimeType: true/);
    assert.match(region, /originalFileName: true/);
    assert.match(region, /metadata: true/);
  });

  it("calls inspectActualFileBytes against the actual bytes inside the step", () => {
    const idx = route.indexOf('step === "restore-vault-bytes"');
    const region = route.slice(idx, idx + 6000);
    assert.match(region, /inspectActualFileBytes\(/);
    assert.match(region, /bytes:\s*buffer/);
  });

  it("re-extracts text using the DETECTED mime type, not the persisted one", () => {
    const idx = route.indexOf('step === "restore-vault-bytes"');
    const region = route.slice(idx, idx + 6000);
    assert.match(region, /detectedMime/);
    assert.match(region, /extractTextFromBuffer\(/);
  });

  it("persists the restored byte-integrity fields and extracted text", () => {
    const idx = route.indexOf('step === "restore-vault-bytes"');
    const region = route.slice(idx, idx + 9000);
    assert.match(region, /prisma\.companyDocument\.update/);
    // The spread of integrity fields is the restore.
    assert.match(region, /\.\.\.integrity/);
    assert.match(region, /extractedText:/);
  });

  it("detects the OFFICIAL_BYTES_LOST case for Plan B-corrupted rows", () => {
    const idx = route.indexOf('step === "restore-vault-bytes"');
    const region = route.slice(idx, idx + 9000);
    assert.match(region, /OFFICIAL_BYTES_LOST/);
    // Detection: metadata.planB === true AND originalFileName ends in PDF/DOCX
    // AND mimeType includes json.
    assert.match(region, /isPlanBArtifact/);
    assert.match(region, /wasOfficialUpload/);
    // The regex in source code: /\.(pdf|docx?|xlsx?|pptx?)$/
    // Match the literal source by looking for the file-extension regex pattern.
    assert.match(region, /pdf\|docx/);
  });

  it("invalidates stale provenance on dependent rows via invalidateDependentProvenance helper", () => {
    assert.match(route, /async function invalidateDependentProvenance\(/);
    const fnIdx = route.indexOf("async function invalidateDependentProvenance");
    const region = route.slice(fnIdx, fnIdx + 3000);
    // Each of the 5 record types is reset.
    assert.match(region, /client\.expert\.updateMany/);
    assert.match(region, /client\.project\.updateMany/);
    assert.match(region, /client\.legalRecord\.updateMany/);
    assert.match(region, /client\.financialRecord\.updateMany/);
    assert.match(region, /client\.companyComplianceRecord\.updateMany/);
    // The reset payload nulls out reviewer identity + resets trust.
    assert.match(region, /trustLevel: "AI_DRAFT"/);
    assert.match(region, /reviewedBy: null/);
    assert.match(region, /reviewedAt: null/);
    assert.match(region, /reviewNotes: null/);
    // The where clause scopes by companyId + sourceDocumentId + the durable trust levels.
    assert.match(region, /sourceDocumentId/);
    assert.match(region, /trustLevel:\s*\{\s*in:\s*\["REVIEWED",\s*"SOURCE_VERIFIED"\]\s*\}/);
  });

  it("only invalidates provenance when the hash actually changed (avoid spurious resets)", () => {
    const idx = route.indexOf('step === "restore-vault-bytes"');
    const region = route.slice(idx, idx + 9000);
    assert.match(region, /hashChanged/);
    assert.match(region, /document\.contentSha256/);
    assert.match(region, /integrity\.contentSha256/);
  });

  it("results object includes a restoreVaultBytes field with restored/bytesLost/provenanceInvalidated counts", () => {
    assert.match(route, /restoreVaultBytes:/);
    assert.match(route, /restored:/);
    assert.match(route, /bytesLost:/);
    assert.match(route, /provenanceInvalidated:/);
  });

  it("audit log records vaultBytesRestored / vaultBytesLost / vaultProvenanceInvalidated", () => {
    assert.match(route, /vaultBytesRestored:/);
    assert.match(route, /vaultBytesLost:/);
    assert.match(route, /vaultProvenanceInvalidated:/);
  });
});
