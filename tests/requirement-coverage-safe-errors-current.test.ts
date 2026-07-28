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
    // isReviewed decides whether the UI offers a record as linkable evidence,
    // so it must be the canonical generation authority rather than a raw
    // trustLevel comparison — the latter marked every durably SOURCE_VERIFIED
    // record unusable and hid the whole vault from an upload-only company.
    assert.match(source, /isReviewed: canUseVaultRecord\(expert as ReviewRecordState, "GENERATION"\)/);
    assert.match(source, /isReviewed: canUseVaultRecord\(project as ReviewRecordState, "GENERATION"\)/);
    assert.match(source, /canonicalStatus\?\.displayStatus/);
    assert.match(source, /canonicalStatus\?\.displayStatus === "FULLY_MET"/);
  });

  it("keeps source grounding required for full coverage", () => {
    assert.match(source, /sourcePageNumber/);
    assert.match(source, /sourceExactQuote/);
    assert.match(source, /sourceConfidence/);
    assert.match(source, /canonicalStatus\?\.hasSourceTrace/);
    const authority = readFileSync(
      join(rootDir, "lib/engine/final-package-readiness-model.ts"),
      "utf8",
    );
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

  it("keeps Vercel Git deployment enabled (repo policy)", () => {
    assert.equal(vercel.git?.deploymentEnabled?.["main"], true);
  });
});
