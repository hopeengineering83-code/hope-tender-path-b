// Comprehensive test: tender DELETE must explicitly delete ALL 16 child
// models that have a tenderId FK, plus their nested children, to avoid
// P2003 foreign-key errors when the database has schema drift.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("Tender delete — comprehensive child cleanup", () => {
  const src = read("app/api/tenders/[id]/route.ts");

  // All 16 models with a direct tenderId FK to Tender
  const childModels = [
    "tenderRequirement",
    "tenderFile",
    "complianceGap",
    "generatedDocument",
    "pricingWorkbook",
    "tenderShare",
    "tenderCopilotMessage",
    "submissionPlanState",
    "tenderExpertMatch",
    "tenderProjectMatch",
    "matchScoreBreakdown",
    "evaluatorObjection",
    "sectionEvidenceMap",
    "tenderMetadataOverride",
    "proposalVersion",
    "exportPackage",
    "complianceMatrix",
  ];

  it("DELETE handler deletes ALL 16+ child models", () => {
    const missing = childModels.filter(
      (model) => !src.includes(`${model}.deleteMany`),
    );
    assert.equal(
      missing.length,
      0,
      `DELETE handler must delete these child models: ${missing.join(", ")}`,
    );
  });

  it("DELETE handler deletes DocumentReview (child of GeneratedDocument)", () => {
    assert.ok(
      src.includes("documentReview.deleteMany"),
      "must delete DocumentReview before GeneratedDocument",
    );
  });

  it("DELETE handler deletes DocumentComment (child of GeneratedDocument)", () => {
    assert.ok(
      src.includes("documentComment.deleteMany"),
      "must delete DocumentComment before GeneratedDocument",
    );
  });

  it("DELETE handler deletes CostLine (child of PricingWorkbook)", () => {
    assert.ok(
      src.includes("costLine.deleteMany"),
      "must delete CostLine before PricingWorkbook",
    );
  });

  it("DELETE handler deletes AI job children (chunks, retry states, steps)", () => {
    assert.ok(src.includes("aiAnalyzeChunk.deleteMany"), "must delete AiAnalyzeChunk");
    assert.ok(src.includes("aiAnalyzeRetryState.deleteMany"), "must delete AiAnalyzeRetryState");
    assert.ok(src.includes("aiJobStep.deleteMany"), "must delete AiJobStep");
    assert.ok(src.includes("aiJob.deleteMany"), "must delete AiJob");
  });

  it("DELETE handler deletes ComplianceMatrix before TenderRequirement", () => {
    const cmIdx = src.indexOf("complianceMatrix.deleteMany");
    const trIdx = src.indexOf("tenderRequirement.deleteMany");
    assert.ok(cmIdx > 0 && trIdx > 0, "both must exist");
    assert.ok(
      cmIdx < trIdx,
      "ComplianceMatrix must be deleted BEFORE TenderRequirement (it has an FK to it)",
    );
  });

  it("DELETE handler uses a transaction with adequate timeout", () => {
    assert.ok(src.includes("prisma.$transaction"), "must use a transaction");
    const timeoutMatch = src.match(/timeout:\s*(\d+)/);
    assert.ok(timeoutMatch, "must have explicit timeout");
    const timeoutMs = parseInt(timeoutMatch[1], 10);
    assert.ok(
      timeoutMs >= 15000,
      `timeout must be >= 15000ms for large tenders (got ${timeoutMs}ms)`,
    );
  });

  it("DELETE handler preserves authorization and audit", () => {
    assert.ok(src.includes("requireRole"), "must require role");
    assert.ok(src.includes("logAction"), "must log the action");
    assert.ok(src.includes("TENDER_DELETE"), "must log TENDER_DELETE action");
  });

  it("DELETE handler returns safe error (no internal exception text)", () => {
    assert.ok(
      !src.includes("detail: error instanceof Error ? error.message"),
      "must NOT expose error.message in response",
    );
    assert.ok(
      src.includes("correlationId"),
      "must return correlationId for tracing",
    );
  });
});
