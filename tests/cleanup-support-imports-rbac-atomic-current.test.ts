import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("app/api/company/cleanup-support-imports/route.ts", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));

describe("support-import cleanup safety", () => {
  it("requires approved mutation roles with no session-only fallback", () => {
    assert.match(source, /requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/);
    assert.match(source, /forbiddenResponse\(\)/);
    assert.match(source, /unauthorizedResponse\(\)/);
    assert.doesNotMatch(source, /getSession/);
    assert.doesNotMatch(source, /"REVIEWER"|"VIEWER"/);
  });

  it("runs all discovery and deletions inside one transaction", () => {
    const transactionStart = source.indexOf("prisma.$transaction(async (tx)");
    const transactionEnd = source.indexOf("    });", transactionStart);
    assert.ok(transactionStart >= 0);
    assert.ok(transactionEnd > transactionStart);
    const transactionRegion = source.slice(transactionStart, source.indexOf("void logAction", transactionStart));
    assert.match(transactionRegion, /tx\.companyDocument\.findMany/);
    assert.match(transactionRegion, /tx\.expert\.deleteMany/);
    assert.match(transactionRegion, /tx\.project\.deleteMany/);
    assert.doesNotMatch(transactionRegion, /prisma\.(?:expert|project)\.deleteMany/);
  });

  it("preserves company scoping for every destructive query", () => {
    assert.match(source, /where: \{ companyId: company\.id \}/);
    const scopedDeletes = source.match(/companyId: company\.id/g) ?? [];
    assert.ok(scopedDeletes.length >= 5, `expected repeated company scoping, found ${scopedDeletes.length}`);
  });

  it("uses persistent actor throttling and stable correlated errors", () => {
    assert.match(source, /rateLimitPersistent\(`cleanup-support:\$\{actor\.id\}`/);
    assert.match(source, /SUPPORT_IMPORT_CLEANUP_FAILED/);
    assert.match(source, /extractRequestId\(req\)/);
    assert.match(source, /errorClass: error instanceof Error \? error\.constructor\.name : "UnknownError"/);
    assert.doesNotMatch(source, /error:\s*(?:error\.message|String\(error\))/);
  });

  it("makes post-commit audit persistence non-fatal", () => {
    assert.match(source, /void logAction\(/);
    assert.match(source, /cleanup-support-imports audit persistence failed/);
    assert.match(source, /\.catch\(\(error\) =>/);
  });

  it("keeps Vercel Git deployment disabled", () => {
    assert.equal(vercel.git?.deploymentEnabled, false);
  });
});
