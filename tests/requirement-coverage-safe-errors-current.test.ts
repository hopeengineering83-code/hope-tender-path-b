import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

const source = readFileSync(join(rootDir, "app/api/tenders/[id]/requirement-coverage/route.ts"), "utf8");
const vercel = JSON.parse(readFileSync(join(rootDir, "vercel.json"), "utf8"));

describe("requirement-coverage safe response boundary", () => {
  it("returns a stable correlated runtime error", () => {
    assert.doesNotMatch(source, /sanitizeError/);
    assert.doesNotMatch(source, /detail:\s*(?:error|message)/);
    assert.match(source, /REQUIREMENT_COVERAGE_RUNTIME_ERROR/);
    assert.match(source, /Requirement coverage could not be loaded/);
    assert.match(source, /extractRequestId\(req\)/);
    assert.match(source, /errorClass: error instanceof Error \? error\.constructor\.name : "UnknownError"/);
  });

  it("keeps tender and canonical readiness queries tenant scoped", () => {
    assert.match(source, /where: \{ id, userId: actor\.id \}/);
    assert.match(source, /getFinalPackageReadinessModel\(prisma, id, actor\.id\)/);
    assert.match(source, /where: \{ tenderId: id, priority: \{ in: \["MANDATORY", "CRITICAL"\] \} \}/);
    assert.match(source, /TENDER_NOT_FOUND/);
    assert.doesNotMatch(source, /prisma\.(?:company|expert|project)\./);
  });

  it("counts only mandatory and critical requirements", () => {
    assert.match(source, /priority: \{ in: \["MANDATORY", "CRITICAL"\] \}/);
    assert.match(source, /totalMandatory/);
    assert.match(source, /coverageRatio/);
  });

  it("reports persisted automatic evidence without becoming a second writer", () => {
    assert.match(source, /requirement\.complianceMatrixRows\.map/);
    assert.match(source, /parseAutomaticRequirementEvidence\(row\.notes\)/);
    assert.match(source, /VAULT_AUTO_LINK/);
    assert.match(source, /autoLinked: Boolean\(automatic\)/);
    assert.match(source, /linkageScore: automatic\?\.linkageScore \?\? null/);
    assert.match(source, /linkageReasons: automatic\?\.linkageReasons \?\? \[\]/);
    assert.match(source, /canonicalStatus\?\.displayStatus \?\? "NOT_MET"/);
    assert.match(source, /canonicalStatus\?\.hasSourceTrace \?\? false/);
    assert.match(source, /coverageStatus === "FULLY_MET"/);
    assert.doesNotMatch(source, /evidenceLinks\.push\(/);
    assert.doesNotMatch(source, /canUseVaultRecord/);
  });

  it("keeps source grounding required for full coverage", () => {
    assert.match(source, /sourcePageNumber/);
    assert.match(source, /sourceExactQuote/);
    assert.match(source, /sourceConfidence/);
    assert.match(source, /canonicalStatus\?\.hasSourceTrace/);
    const authority = readFileSync(join(rootDir, "lib/engine/final-package-readiness-model.ts"), "utf8");
    assert.match(authority, /isGroundedEvidenceInActiveFiles/);
    assert.match(authority, /displayStatus === "FULLY_MET"/);
  });

  it("keeps final-package readiness parity", () => {
    assert.match(source, /getFinalPackageReadinessModel\(prisma, id, actor\.id\)/);
    assert.match(source, /requirementEvidenceStatuses: finalPackageModel\.requirementEvidenceStatuses/);
  });

  it("keeps the endpoint read-only", () => {
    assert.doesNotMatch(source, /\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\(/);
  });

  it("keeps Vercel Git deployment enabled by repository policy", () => {
    assert.equal(vercel.git?.deploymentEnabled?.main, true);
  });
});
