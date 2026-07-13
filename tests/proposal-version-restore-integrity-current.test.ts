import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

const source = readFileSync(join(rootDir, "app/api/tenders/[id]/proposal-versions/[versionId]/route.ts"), "utf8");
const vercel = JSON.parse(readFileSync(join(rootDir, "vercel.json"), "utf8"));

describe("proposal version restore byte integrity", () => {
  it("fails closed when saved bytes or the live target document are missing", () => {
    assert.match(source, /VERSION_BYTES_MISSING/);
    assert.match(source, /LIVE_PROPOSAL_DOCUMENT_MISSING/);
    assert.match(source, /status: 409/);
    assert.doesNotMatch(source, /fileContent: version\.fileContent \?\?/);
    assert.doesNotMatch(source, /v\.fileContent \?\? existing\.fileContent/);
  });

  it("verifies bytes before claiming or persisting the live document", () => {
    const verifyPos = source.indexOf("verifiedIntegrityDataFromBase64({");
    const claimPos = source.indexOf("prisma.generatedDocument.updateMany({");
    const invalidatePos = source.indexOf('generationStatus: "GENERATING"', claimPos);
    const persistPos = source.indexOf("writeGeneratedDocumentContent(");
    const completePos = source.indexOf('generationStatus: "GENERATED"', persistPos);
    assert.ok(verifyPos >= 0);
    assert.ok(claimPos > verifyPos);
    assert.ok(invalidatePos > claimPos);
    assert.ok(persistPos > invalidatePos);
    assert.ok(completePos > persistPos);
    assert.match(source, /VERSION_BYTES_NOT_VERIFIED/);
  });

  it("serializes concurrent restores with status and updatedAt", () => {
    assert.match(source, /existing\.generationStatus === "GENERATING"/);
    assert.match(source, /RESTORE_IN_PROGRESS/);
    assert.match(source, /updatedAt: existing\.updatedAt/);
    assert.match(source, /generationStatus: existing\.generationStatus/);
    assert.match(source, /claim\.count !== 1/);
    assert.match(source, /CONCURRENT_MODIFICATION/);
  });

  it("uses the compensated generated-document storage writer", () => {
    assert.match(source, /writeGeneratedDocumentContent/);
    assert.match(source, /Buffer\.from\(normalizedContent, "base64"\)/);
    assert.match(source, /integrityStatus: "VERIFIED"/);
  });

  it("invalidates validation, review, and reviewer identity before storage", () => {
    const claimStart = source.indexOf("prisma.generatedDocument.updateMany({");
    const persistPos = source.indexOf("writeGeneratedDocumentContent(");
    const claimRegion = source.slice(claimStart, persistPos);
    assert.match(claimRegion, /generationStatus: "GENERATING"/);
    assert.match(claimRegion, /validationStatus: "PENDING"/);
    assert.match(claimRegion, /reviewStatus: "PENDING"/);
    assert.match(claimRegion, /reviewedBy: null/);
    assert.match(claimRegion, /reviewedAt: null/);
  });

  it("leaves failed restores non-exportable and returns stable diagnostics", () => {
    assert.match(source, /generationStatus: "FAILED"/);
    assert.match(source, /VERSION_RESTORE_FAILED/);
    assert.match(source, /requestId/);
    assert.match(source, /errorClass: error instanceof Error \? error\.constructor\.name : "UnknownError"/);
    assert.doesNotMatch(source, /error:\s*(?:error\.message|String\(error\))/);
  });

  it("preserves owner/admin access and records a typed non-fatal audit event", () => {
    const tenderAccessCalls = source.match(/requireTenderAccess\(/g) ?? [];
    assert.equal(tenderAccessCalls.length, 3);
    assert.match(source, /requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/);
    assert.match(source, /action: "UPDATE"/);
    assert.match(source, /operation: "PROPOSAL_VERSION_RESTORED"/);
    assert.match(source, /\.catch\(\(error\) =>/);
  });

  it("keeps Vercel Git deployment enabled (repo policy)", () => {
    assert.equal(vercel.git?.deploymentEnabled, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Concurrency and fail-closed restore semantics
// ─────────────────────────────────────────────────────────────────────────────

describe("proposal version restore concurrency and fail-closed semantics", () => {
  it("uses optimistic locking with updateMany (not update) for the claim", () => {
    // The claim must use updateMany with WHERE on id + updatedAt + generationStatus.
    // This prevents two concurrent restores from both claiming the same row:
    // the first updateMany matches 1 row and bumps updatedAt; the second
    // updateMany's stale updatedAt no longer matches and returns count=0.
    const claimPos = source.indexOf("prisma.generatedDocument.updateMany({");
    assert.ok(claimPos >= 0, "must use updateMany for the claim (optimistic locking)");
    const claimRegion = source.slice(claimPos, claimPos + 800);
    assert.match(claimRegion, /updatedAt: existing\.updatedAt/);
    assert.match(claimRegion, /generationStatus: existing\.generationStatus/);
    assert.match(claimRegion, /claim\.count !== 1/);
  });

  it("failed restore sets FAILED and remains non-exportable (PENDING validation/review)", () => {
    // On failure, the catch block must set the document to FAILED with
    // validationStatus: PENDING and reviewStatus: PENDING — never
    // READY_FOR_EXPORT or VALIDATED.
    // Search for the catch block after the writeGeneratedDocumentContent CALL.
    const writeCallPos = source.indexOf("writeGeneratedDocumentContent(");
    assert.ok(writeCallPos >= 0, "must have a writeGeneratedDocumentContent call");
    const catchPos = source.indexOf("} catch (error) {", writeCallPos);
    assert.ok(catchPos >= 0, "must have a catch block after the storage write");
    const catchRegion = source.slice(catchPos, catchPos + 600);
    assert.match(catchRegion, /generationStatus: "FAILED"/);
    assert.match(catchRegion, /validationStatus: "PENDING"/);
    assert.match(catchRegion, /reviewStatus: "PENDING"/);
    assert.doesNotMatch(catchRegion, /READY_FOR_EXPORT/);
    assert.doesNotMatch(catchRegion, /VALIDATED/);
  });

  it("successful restore requires validation and reapproval before export", () => {
    // On success, the document must be set to GENERATED with PENDING
    // validation and PENDING review — not READY_FOR_EXPORT.
    const successPos = source.indexOf('generationStatus: "GENERATED"', source.indexOf("writeGeneratedDocumentContent"));
    assert.ok(successPos >= 0, "must have a success update after the storage write");
    const successRegion = source.slice(successPos, successPos + 400);
    assert.match(successRegion, /validationStatus: "PENDING"/);
    assert.match(successRegion, /reviewStatus: "PENDING"/);
    assert.doesNotMatch(successRegion, /READY_FOR_EXPORT/);
    // The reviewNotes must indicate restoration requires re-validation.
    assert.match(source, /Restoring proposal version/);
    assert.match(source, /validation and review are required again/);
  });

  it("the claim sets GENERATING before the storage write — concurrent requests see GENERATING and fail closed", () => {
    // The order must be: claim (GENERATING) → storage write → success (GENERATED).
    // A concurrent request arriving between the claim and the success sees
    // GENERATING and returns RESTORE_IN_PROGRESS (409).
    const claimPos = source.indexOf('generationStatus: "GENERATING"');
    const writePos = source.indexOf("writeGeneratedDocumentContent(");
    const successPos = source.indexOf('generationStatus: "GENERATED"', writePos);
    assert.ok(claimPos >= 0 && writePos > claimPos,
      "claim (GENERATING) must come before the storage write");
    assert.ok(successPos > writePos,
      "success (GENERATED) must come after the storage write");
  });
});
