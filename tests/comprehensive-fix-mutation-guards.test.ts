import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluateGenerationReadiness } from "../lib/engine/generation-readiness-gate";

const read = (path: string) => readFileSync(path, "utf8");

describe("one authoritative Build Plan hash and service", () => {
  it("build-plan.ts uses the canonical hash implementation", () => {
    const source = read("lib/engine/build-plan.ts");
    assert.match(source, /computeBuildPlanHash/);
    assert.match(source, /buildCanonicalBuildPlanHashInput/);
    assert.doesNotMatch(source, /export function hashBuildPlanState/);
  });

  it("both public build routes delegate to automatic verification", () => {
    for (const path of [
      "app/api/tenders/[id]/build-plan/route.ts",
      "app/api/tenders/[id]/submission-plan/build/route.ts",
    ]) {
      const source = read(path);
      assert.match(source, /buildAndVerifyBuildPlan/);
      assert.doesNotMatch(source, /import.*computeBuildPlanHash.*from.*build-plan-hash/);
      assert.match(source, /authorizesGeneration: true/);
    }
  });
});

describe("transaction-safe automatic confirmation", () => {
  it("draft construction remains race-safe and clears old confirmation identity", () => {
    const source = read("lib/engine/build-plan.ts");
    assert.match(source, /buildPlan\.upsert/);
    assert.doesNotMatch(source, /buildPlan\.findFirst\(\{\s*where:\s*\{\s*tenderId,\s*status:\s*"DRAFT"/);
    for (const field of ["confirmedRevision", "confirmedContentHash", "confirmedById", "confirmedAt"]) {
      assert.match(source, new RegExp(`${field}:\\s*null`));
    }
  });

  it("the legacy confirm route delegates instead of deleting or directly approving rows", () => {
    const source = read("app/api/tenders/[id]/build-plan/confirm/route.ts");
    assert.doesNotMatch(source, /deleteMany|confirmedById:\s*actor\.id/);
    assert.match(source, /buildAndVerifyBuildPlan\(prisma, id, actor\.id, \{ reuseCurrent: true \}\)/);
    assert.match(source, /state: "CONFIRMED"/);
    assert.match(source, /confirmationMode/);
  });
});

describe("quote containment in the central generation gate", () => {
  it("declares and applies REQUIREMENT_QUOTE_NOT_IN_FILE", () => {
    const source = read("lib/engine/generation-readiness-gate.ts");
    assert.match(source, /REQUIREMENT_QUOTE_NOT_IN_FILE/);
    assert.match(source, /sourceFileExtractedText/);
    assert.match(source, /fileText\.includes\(normalizedQuote\)/);
  });

  it("blocks a quote absent from current source text", () => {
    const result = evaluateGenerationReadiness({
      purpose: "generate",
      tenderExistsAndOwned: true,
      activeFileCount: 1,
      extractionFiles: [{ fileId: "f1", corrupted: false, weak: false, hasOverride: false }],
      analysisState: "AI_SUCCEEDED",
      canonicalJobId: "job1",
      latestJobHash: "hash",
      currentContentHash: "hash",
      fallbackApprovalBound: false,
      currentHashChunks: [],
      requirementCount: 1,
      requirements: [{
        priority: "MANDATORY",
        sourceTenderFileId: "f1",
        sourcePageNumber: 1,
        sourceExactQuote: "This quote does not appear in the file text",
        sourceFileActiveInTender: true,
        sourceFileExtractedText: "Completely different current source text.",
      }],
      criticalMetadataOk: true,
      hasCurrentConfirmedBuildPlan: true,
      confirmedBuildPlanItemsValid: true,
      confirmedPlanDocumentsOk: true,
      exportReadyDocumentCount: 1,
    });
    assert.equal(result.ok, false);
    assert.equal(result.blockerCode, "REQUIREMENT_QUOTE_NOT_IN_FILE");
  });

  it("allows a contained source quote", () => {
    const quote = "The bidder shall submit audited financial statements.";
    const result = evaluateGenerationReadiness({
      purpose: "generate",
      tenderExistsAndOwned: true,
      activeFileCount: 1,
      extractionFiles: [{ fileId: "f1", corrupted: false, weak: false, hasOverride: false }],
      analysisState: "AI_SUCCEEDED",
      canonicalJobId: "job1",
      latestJobHash: "hash",
      currentContentHash: "hash",
      fallbackApprovalBound: false,
      currentHashChunks: [],
      requirementCount: 1,
      requirements: [{
        priority: "MANDATORY",
        sourceTenderFileId: "f1",
        sourcePageNumber: 1,
        sourceExactQuote: quote,
        sourceFileActiveInTender: true,
        sourceFileExtractedText: `Context. ${quote} More context.`,
      }],
      criticalMetadataOk: true,
      hasCurrentConfirmedBuildPlan: true,
      confirmedBuildPlanItemsValid: true,
      confirmedPlanDocumentsOk: true,
      exportReadyDocumentCount: 1,
    });
    assert.equal(result.ok, true);
  });
});

describe("fail-closed migration verification", () => {
  it("throws on retroactive-init or critical-schema verification failure", () => {
    const source = read("scripts/migrate-deploy-safe.mjs");
    assert.doesNotMatch(source, /Don't throw.*non-fatal/);
    assert.match(source, /throw new Error.*retroactive init verification/);
    assert.match(source, /throw new Error.*critical schema verification/);
  });
});
