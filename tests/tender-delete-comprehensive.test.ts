import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
const read = (p: string) => readFileSync(p, "utf8");

describe("Tender delete — comprehensive child cleanup", () => {
  const src = read("app/api/tenders/[id]/route.ts");
  const childModels = ["tenderRequirement","tenderFile","complianceGap","generatedDocument","pricingWorkbook","tenderShare","tenderCopilotMessage","submissionPlanState","tenderExpertMatch","tenderProjectMatch","matchScoreBreakdown","evaluatorObjection","sectionEvidenceMap","tenderMetadataOverride","proposalVersion","exportPackage","complianceMatrix"];
  it("deletes ALL 16+ child models", () => {
    const missing = childModels.filter(m => !src.includes(`${m}.deleteMany`));
    assert.equal(missing.length, 0, `Missing: ${missing.join(", ")}`);
  });
  it("deletes DocumentComment (child of GeneratedDocument)", () => { assert.ok(src.includes("documentComment.deleteMany")); });
  it("deletes CostLine (child of PricingWorkbook)", () => { assert.ok(src.includes("costLine.deleteMany")); });
  it("deletes ComplianceMatrix before TenderRequirement", () => {
    const cmIdx = src.indexOf("complianceMatrix.deleteMany");
    const trIdx = src.indexOf("tenderRequirement.deleteMany");
    assert.ok(cmIdx < trIdx, "ComplianceMatrix must be before TenderRequirement");
  });
  it("uses transaction with adequate timeout", () => {
    const m = src.match(/timeout:\s*(\d+)/);
    assert.ok(m && parseInt(m[1]) >= 15000);
  });
  it("preserves authorization and audit", () => {
    assert.ok(src.includes("requireRole") && src.includes("TENDER_DELETE"));
  });
  it("returns safe error (no internal exception text)", () => {
    assert.ok(!src.includes("detail: error instanceof Error ? error.message"));
    assert.ok(src.includes("correlationId"));
  });
});
