// Mutation guards for the comprehensive release-safety fix commit.
// Each test verifies a specific protection. If anyone reverts any of these,
// the corresponding test fails.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluateGenerationReadiness } from "../lib/engine/generation-readiness-gate";
import { buildDraftBuildPlan, computeTenderBuildPlanHash, validateBuildPlanForConfirmation, type BuildPlanItem } from "../lib/engine/build-plan";
import { computeBuildPlanHash, buildPlanHashInputFromTender } from "../lib/engine/build-plan-hash";

// ─── Fix 1: ONE authoritative BuildPlan hash ────────────────────────────────

describe("Fix 1 — ONE authoritative BuildPlan hash", () => {
  it("build-plan.ts uses computeBuildPlanHash from build-plan-hash.ts (not hashBuildPlanState)", () => {
    const src = readFileSync("lib/engine/build-plan.ts", "utf8");
    assert.match(src, /computeBuildPlanHash/, "build-plan.ts MUST use computeBuildPlanHash");
    assert.match(src, /buildCanonicalBuildPlanHashInput/, "build-plan.ts MUST use buildCanonicalBuildPlanHashInput");
    // The old hashBuildPlanState function MUST be gone.
    assert.ok(
      !src.includes("export function hashBuildPlanState"),
      "build-plan.ts MUST NOT export hashBuildPlanState (old competing hash)",
    );
  });

  it("submission-plan/build route does NOT import computeBuildPlanHash directly", () => {
    const src = readFileSync("app/api/tenders/[id]/submission-plan/build/route.ts", "utf8");
    // The route MUST call buildDraftBuildPlan (the canonical service) instead
    // of computing its own hash.
    assert.match(src, /buildDraftBuildPlan/, "submission-plan/build MUST call buildDraftBuildPlan");
    assert.ok(
      !/import.*computeBuildPlanHash.*from.*build-plan-hash/.test(src),
      "submission-plan/build MUST NOT import computeBuildPlanHash directly — use the canonical service",
    );
  });
});

// ─── Fix 2: Transaction-safe rebuild after confirmation ─────────────────────

describe("Fix 2 — Transaction-safe rebuild after confirmation", () => {
  it("buildDraftBuildPlan uses upsert (not findFirst+create)", () => {
    const src = readFileSync("lib/engine/build-plan.ts", "utf8");
    assert.match(src, /buildPlan\.upsert/, "buildDraftBuildPlan MUST use upsert for race safety");
    assert.ok(
      !/buildPlan\.findFirst\(\{\s*where:\s*\{\s*tenderId,\s*status:\s*"DRAFT"/.test(src),
      "buildDraftBuildPlan MUST NOT use findFirst with status:DRAFT (must rebuild ANY existing row)",
    );
  });

  it("confirm route does NOT delete confirmed plans", () => {
    const src = readFileSync("app/api/tenders/[id]/build-plan/confirm/route.ts", "utf8");
    assert.ok(
      !/deleteMany/.test(src),
      "confirm route MUST NOT call deleteMany — never delete a confirmed plan",
    );
    assert.match(src, /buildPlan\.update/, "confirm route MUST use update on the same DRAFT row");
  });

  it("buildDraftBuildPlan clears all confirmed* fields on rebuild", () => {
    const src = readFileSync("lib/engine/build-plan.ts", "utf8");
    assert.match(src, /confirmedRevision:\s*null/);
    assert.match(src, /confirmedContentHash:\s*null/);
    assert.match(src, /confirmedById:\s*null/);
    assert.match(src, /confirmedAt:\s*null/);
  });
});

// ─── Fix 6: Quote containment check in central gate ────────────────────────

describe("Fix 6 — Quote containment check in central gate", () => {
  it("gate has REQUIREMENT_QUOTE_NOT_IN_FILE blocker code", () => {
    const src = readFileSync("lib/engine/generation-readiness-gate.ts", "utf8");
    assert.match(src, /REQUIREMENT_QUOTE_NOT_IN_FILE/);
  });

  it("gate checks that quote is contained in sourceFileExtractedText", () => {
    const src = readFileSync("lib/engine/generation-readiness-gate.ts", "utf8");
    assert.match(src, /sourceFileExtractedText/);
    assert.match(src, /fileText\.includes\(normalizedQuote\)/);
  });

  it("blocks when quote is NOT in the extracted text", () => {
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
        sourceFileExtractedText: "Completely different text that does not contain the quote at all.",
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

  it("allows when quote IS in the extracted text", () => {
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
        sourceFileExtractedText: `Some context. ${quote} More context after the quote.`,
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

// ─── Fix 9: Fail-closed migration verification ─────────────────────────────

describe("Fix 9 — Fail-closed migration verification", () => {
  it("migrate-deploy-safe.mjs throws on retroactive-init verification failure", () => {
    const src = readFileSync("scripts/migrate-deploy-safe.mjs", "utf8");
    // The old code had "Don't throw - migrations are deployed; verification warnings are non-fatal"
    // The new code MUST throw.
    assert.ok(
      !/Don't throw.*non-fatal/.test(src),
      "migrate-deploy-safe MUST NOT have non-fatal verification warnings",
    );
    assert.match(src, /throw new Error.*retroactive init verification/, "MUST throw on retroactive-init failure");
    assert.match(src, /throw new Error.*critical schema verification/, "MUST throw on critical-schema failure");
  });
});
