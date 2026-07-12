import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("app/api/tenders/[id]/proposal-versions/[versionId]/route.ts", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));

describe("proposal version restore byte integrity", () => {
  it("fails closed when saved bytes or the live target document are missing", () => {
    assert.match(source, /VERSION_BYTES_MISSING/);
    assert.match(source, /LIVE_PROPOSAL_DOCUMENT_MISSING/);
    assert.match(source, /status: 409/);
    assert.doesNotMatch(source, /fileContent: version\.fileContent \?\?/);
    assert.doesNotMatch(source, /v\.fileContent \?\? existing\.fileContent/);
  });

  it("verifies bytes before invalidating or persisting the live document", () => {
    const verifyPos = source.indexOf("verifiedIntegrityDataFromBase64({");
    const invalidatePos = source.indexOf('generationStatus: "GENERATING"');
    const persistPos = source.indexOf("writeGeneratedDocumentContent(");
    const completePos = source.indexOf('generationStatus: "GENERATED"', persistPos);
    assert.ok(verifyPos >= 0);
    assert.ok(invalidatePos > verifyPos);
    assert.ok(persistPos > invalidatePos);
    assert.ok(completePos > persistPos);
    assert.match(source, /VERSION_BYTES_NOT_VERIFIED/);
  });

  it("uses the compensated generated-document storage writer", () => {
    assert.match(source, /writeGeneratedDocumentContent/);
    assert.match(source, /Buffer\.from\(normalizedContent, "base64"\)/);
    assert.match(source, /integrityStatus: "VERIFIED"/);
  });

  it("invalidates validation, review, and reviewer identity before storage", () => {
    const invalidateStart = source.indexOf('generationStatus: "GENERATING"');
    const persistPos = source.indexOf("writeGeneratedDocumentContent(");
    const invalidateRegion = source.slice(invalidateStart, persistPos);
    assert.match(invalidateRegion, /validationStatus: "PENDING"/);
    assert.match(invalidateRegion, /reviewStatus: "PENDING"/);
    assert.match(invalidateRegion, /reviewedBy: null/);
    assert.match(invalidateRegion, /reviewedAt: null/);
  });

  it("leaves failed restores non-exportable and returns stable diagnostics", () => {
    assert.match(source, /generationStatus: "FAILED"/);
    assert.match(source, /VERSION_RESTORE_FAILED/);
    assert.match(source, /requestId/);
    assert.match(source, /errorClass: error instanceof Error \? error\.constructor\.name : "UnknownError"/);
    assert.doesNotMatch(source, /error:\s*(?:error\.message|String\(error\))/);
  });

  it("preserves owner/admin access and records a non-fatal audit event", () => {
    const tenderAccessCalls = source.match(/requireTenderAccess\(/g) ?? [];
    assert.equal(tenderAccessCalls.length, 3);
    assert.match(source, /requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/);
    assert.match(source, /PROPOSAL_VERSION_RESTORED/);
    assert.match(source, /\.catch\(\(error\) =>/);
  });

  it("keeps Vercel Git deployment disabled", () => {
    assert.equal(vercel.git?.deploymentEnabled, false);
  });
});
