// Defect 4 wiring contract test: partial verification is wired into all
// approval routes and the Plan B import route.
//
// buildPartialSourceVerificationProvenance is called when the full gate
// fails, so identity-verified records become SOURCE_VERIFIED instead of
// being rejected as AI_DRAFT. canUseVaultRecordField and
// partialVerificationSummary are exported for consumers.
//
// This test scans the source of each route to assert the wiring is present.
// A full DB-integration test would require real PostgreSQL; this catches
// regressions where a refactor drops the partial-verification fallback.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const planBRoute = readFileSync("app/api/company/plan-b-import/route.ts", "utf8");
const expertsIdRoute = readFileSync("app/api/company/experts/[id]/route.ts", "utf8");
const projectsIdRoute = readFileSync("app/api/company/projects/[id]/route.ts", "utf8");
const expertsBatchRoute = readFileSync("app/api/company/experts/batch/route.ts", "utf8");
const projectsBatchRoute = readFileSync("app/api/company/projects/batch/route.ts", "utf8");
const provenanceLib = readFileSync("lib/vault-review-provenance.ts", "utf8");
const finalPackageModel = readFileSync("lib/engine/final-package-readiness-model.ts", "utf8");

describe("Defect 4 wiring — partial verification in all approval routes", () => {
  it("vault-review-provenance exports buildPartialSourceVerificationProvenance", () => {
    assert.match(provenanceLib, /export function buildPartialSourceVerificationProvenance/);
  });

  it("vault-review-provenance exports canUseVaultRecordField", () => {
    assert.match(provenanceLib, /export function canUseVaultRecordField/);
  });

  it("vault-review-provenance exports partialVerificationSummary", () => {
    assert.match(provenanceLib, /export function partialVerificationSummary/);
  });

  it("Plan B import route imports buildPartialSourceVerificationProvenance", () => {
    assert.match(planBRoute, /import\s+\{[^}]*buildPartialSourceVerificationProvenance[^}]*\}/);
  });

  it("Plan B import route calls buildPartialSourceVerificationProvenance inside decidePlanBTrust", () => {
    const idx = planBRoute.indexOf("function decidePlanBTrust(");
    assert.ok(idx > -1);
    const region = planBRoute.slice(idx, idx + 3000);
    assert.match(region, /buildPartialSourceVerificationProvenance\(/);
  });

  it("Plan B import route surfaces partial-verification warnings for experts", () => {
    // The expert loop must have an else-if branch for unverifiedFields.
    assert.match(planBRoute, /expertDecision\.unverifiedFields\.length > 0/);
    assert.match(planBRoute, /source-verified on identity/);
  });

  it("Plan B import route surfaces partial-verification warnings for projects", () => {
    assert.match(planBRoute, /projectDecision\.unverifiedFields\.length > 0/);
  });

  it("Plan B import route surfaces partial-verification warnings for legal/financial/compliance", () => {
    // Each of the 3 upsert helpers must have the partial-warning branch.
    for (const recordType of ["Legal", "Financial", "Compliance"]) {
      const needle = `${recordType} record`;
      // Find the upsert function for this record type.
      const fnName = `upsert${recordType}Record`;
      const fnIdx = planBRoute.indexOf(`async function ${fnName}(`);
      assert.ok(fnIdx > -1, `${fnName} must exist`);
      const region = planBRoute.slice(fnIdx, fnIdx + 3000);
      assert.match(region, /decision\.unverifiedFields\.length > 0/, `${fnName} must check unverifiedFields`);
      assert.match(region, /source-verified on identity/, `${fnName} must surface partial-verification warning`);
    }
  });

  it("experts/[id] route imports buildPartialSourceVerificationProvenance", () => {
    assert.match(expertsIdRoute, /import\s+\{[^}]*buildPartialSourceVerificationProvenance[^}]*\}/);
  });

  it("experts/[id] route falls back to partial verification before SOURCE_REQUIRED_FOR_APPROVAL", () => {
    // The route must call buildPartialSourceVerificationProvenance inside
    // the !provenance?.ok branch, before returning 422.
    const idx = expertsIdRoute.indexOf("if (!provenance?.ok)");
    assert.ok(idx > -1);
    const region = expertsIdRoute.slice(idx, idx + 3500);
    assert.match(region, /buildPartialSourceVerificationProvenance\(/);
    assert.match(region, /partial\?\.ok/);
    assert.match(region, /trustLevel: "SOURCE_VERIFIED"/);
    assert.match(region, /partialVerification: true/);
  });

  it("projects/[id] route imports buildPartialSourceVerificationProvenance", () => {
    assert.match(projectsIdRoute, /import\s+\{[^}]*buildPartialSourceVerificationProvenance[^}]*\}/);
  });

  it("projects/[id] route falls back to partial verification before SOURCE_REQUIRED_FOR_APPROVAL", () => {
    const idx = projectsIdRoute.indexOf("if (!provenance?.ok)");
    assert.ok(idx > -1);
    const region = projectsIdRoute.slice(idx, idx + 3500);
    assert.match(region, /buildPartialSourceVerificationProvenance\(/);
    assert.match(region, /partial\?\.ok/);
    assert.match(region, /trustLevel: "SOURCE_VERIFIED"/);
    assert.match(region, /partialVerification: true/);
  });

  it("experts/batch route imports buildPartialSourceVerificationProvenance", () => {
    assert.match(expertsBatchRoute, /import\s+\{[^}]*buildPartialSourceVerificationProvenance[^}]*\}/);
  });

  it("experts/batch route falls back to partial verification before rejecting", () => {
    const idx = expertsBatchRoute.indexOf("if (!provenance.ok)");
    assert.ok(idx > -1);
    const region = expertsBatchRoute.slice(idx, idx + 2000);
    assert.match(region, /buildPartialSourceVerificationProvenance\(/);
    assert.match(region, /partial\.ok/);
    assert.match(region, /partial: true/);
    assert.match(region, /trustLevel: "SOURCE_VERIFIED"/);
  });

  it("projects/batch route imports buildPartialSourceVerificationProvenance", () => {
    assert.match(projectsBatchRoute, /import\s+\{[^}]*buildPartialSourceVerificationProvenance[^}]*\}/);
  });

  it("projects/batch route falls back to partial verification before rejecting", () => {
    const idx = projectsBatchRoute.indexOf("if (!provenance.ok)");
    assert.ok(idx > -1);
    const region = projectsBatchRoute.slice(idx, idx + 2000);
    assert.match(region, /buildPartialSourceVerificationProvenance\(/);
    assert.match(region, /partial\.ok/);
    assert.match(region, /partial: true/);
    assert.match(region, /trustLevel: "SOURCE_VERIFIED"/);
  });

  it("experts/batch route accepted array carries per-record status (REVIEWED or SOURCE_VERIFIED)", () => {
    // The accepted array must be updatedIds (array of {id, status}), not
    // updatedIds.map((id) => ({ id, status: "REVIEWED" })).
    assert.match(expertsBatchRoute, /completed\.push\(\{ id: candidate\.id, status: candidate\.partial \? "SOURCE_VERIFIED" : "REVIEWED" \}\)/);
  });

  it("projects/batch route accepted array carries per-record status (REVIEWED or SOURCE_VERIFIED)", () => {
    assert.match(projectsBatchRoute, /completed\.push\(\{ id: candidate\.id, status: candidate\.partial \? "SOURCE_VERIFIED" : "REVIEWED" \}\)/);
  });
});

describe("Defect 4 wiring — final-package-readiness-model surfaces partial-verification warnings", () => {
  it("imports canUseVaultRecordField and partialVerificationSummary", () => {
    assert.match(finalPackageModel, /import\s+\{[^}]*canUseVaultRecordField[^}]*partialVerificationSummary[^}]*\}/);
  });

  it("has a partialVerificationWarnings helper", () => {
    assert.match(finalPackageModel, /function partialVerificationWarnings\(/);
  });

  it("calls partialVerificationWarnings in the evidence section of the result", () => {
    // The evidence section must include partialVerificationWarnings.
    const idx = finalPackageModel.indexOf("partialVerificationWarnings: partialVerificationWarnings(");
    assert.ok(idx > -1, "must call partialVerificationWarnings in the result");
  });

  it("FinalPackageReadinessModel.evidence type includes partialVerificationWarnings: string[]", () => {
    // The type must declare the field.
    const typeIdx = finalPackageModel.indexOf("export type FinalPackageReadinessModel");
    assert.ok(typeIdx > -1);
    const typeRegion = finalPackageModel.slice(typeIdx, typeIdx + 5000);
    assert.match(typeRegion, /partialVerificationWarnings:\s*string\[\]/);
  });
});
