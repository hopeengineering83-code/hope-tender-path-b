import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("app/api/tenders/[id]/requirement-coverage/route.ts", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));

describe("requirement-coverage safe response boundary", () => {
  it("returns a stable correlated runtime error", () => {
    assert.doesNotMatch(source, /sanitizeError/);
    assert.doesNotMatch(source, /detail:\s*(?:error|message)/);
    assert.match(source, /REQUIREMENT_COVERAGE_RUNTIME_ERROR/);
    assert.match(source, /Requirement coverage could not be loaded/);
    assert.match(source, /extractRequestId\(req\)/);
    assert.match(source, /errorClass: error instanceof Error \? error\.constructor\.name : "UnknownError"/);
  });

  it("keeps tender and Company Vault queries owner/company scoped", () => {
    assert.match(source, /where: \{ id, userId: actor\.id \}/);
    assert.match(source, /where: \{ userId: tender\.userId \}/);
    assert.match(source, /where: \{ companyId: company\.id, deletedAt: null \}/);
    assert.match(source, /TENDER_NOT_FOUND/);
  });

  it("counts only mandatory and critical requirements", () => {
    assert.match(source, /priority: \{ in: \["MANDATORY", "CRITICAL"\] \}/);
    assert.match(source, /totalMandatory/);
    assert.match(source, /coverageRatio/);
  });

  it("keeps auto-linked Vault evidence display-only and never fully covered", () => {
    assert.match(source, /evidenceSource: "VAULT_AUTO_LINK"/);
    assert.match(source, /supportLevel: "PARTIAL"/);
    assert.match(source, /isReviewed: expert\.trustLevel === "REVIEWED"/);
    assert.match(source, /isReviewed: project\.trustLevel === "REVIEWED"/);
    assert.match(source, /hasOnlyAutoLinks/);
    assert.match(source, /!hasOnlyAutoLinks/);
  });

  it("keeps source grounding required for full coverage", () => {
    assert.match(source, /sourcePageNumber/);
    assert.match(source, /sourceExactQuote/);
    assert.match(source, /sourceConfidence/);
    assert.match(source, /&& hasSourceRef/);
  });

  it("keeps final-package readiness parity", () => {
    assert.match(source, /getFinalPackageReadinessModel\(prisma, id, actor\.id\)/);
    assert.match(source, /requirementEvidenceStatuses: finalPackageModel\.requirementEvidenceStatuses/);
  });

  it("keeps the endpoint read-only", () => {
    assert.doesNotMatch(source, /\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\(/);
  });

  it("keeps Vercel Git deployment enabled (repo policy)", () => {
    assert.equal(vercel.git?.deploymentEnabled, true);
  });
});
