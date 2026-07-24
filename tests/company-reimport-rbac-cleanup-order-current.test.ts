import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const route = readFileSync("app/api/company/reimport/route.ts", "utf8");
const cleanup = readFileSync("lib/company-support-doc-cleanup.ts", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));

describe("company reimport safety", () => {
  it("requires approved mutation roles with no session-only fallback", () => {
    assert.match(route, /requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/);
    assert.match(route, /forbiddenResponse\(\)/);
    assert.match(route, /unauthorizedResponse\(\)/);
    assert.doesNotMatch(route, /getSession/);
    assert.doesNotMatch(route, /"REVIEWER"|"VIEWER"/);
  });

  it("re-extracts verified bytes, then invokes the single canonical ingestion owner", () => {
    const postStart = route.indexOf("export async function POST");
    const integrityPos = route.indexOf("inspectActualFileBytes", postStart);
    const ingestPos = route.indexOf("ingestCompanyVault(company.id)", postStart);
    const auditPos = route.indexOf("cleanupSupportDocImportedRecords(company.id)", postStart);
    assert.ok(postStart >= 0);
    assert.ok(integrityPos > postStart);
    assert.ok(ingestPos > integrityPos);
    assert.ok(auditPos > ingestPos);
    assert.equal(route.slice(postStart).match(/ingestCompanyVault\(company\.id\)/g)?.length, 1);
  });

  it("treats mixed/support document handling as a non-destructive audit", () => {
    assert.match(cleanup, /uncertain claim must remain available to the Review Inbox/);
    assert.match(cleanup, /prisma\.expert\.count/);
    assert.match(cleanup, /prisma\.project\.count/);
    assert.match(cleanup, /expertsPreservedForReview/);
    assert.match(cleanup, /projectsPreservedForReview/);
    assert.match(cleanup, /expertsDeleted: 0/);
    assert.match(cleanup, /projectsDeleted: 0/);
    assert.doesNotMatch(cleanup, /deleteMany|\.delete\(/);
  });

  it("keeps every support-evidence audit query company-scoped", () => {
    const scopes = cleanup.match(/companyId/g) ?? [];
    assert.ok(scopes.length >= 4, `expected repeated company scoping, found ${scopes.length}`);
    assert.match(cleanup, /companyId,\s*sourceDocumentId: \{ in: supportDocIds \}/s);
  });

  it("uses persistent throttling and stable correlated runtime errors", () => {
    assert.match(route, /rateLimitPersistent\(`reimport:\$\{actor\.id\}`/);
    assert.match(route, /COMPANY_REIMPORT_FAILED/);
    assert.match(route, /extractRequestId\(req\)/);
    assert.match(route, /errorClass: error instanceof Error \? error\.constructor\.name : "UnknownError"/);
    assert.doesNotMatch(route, /error:\s*(?:error\.message|String\(error\))/);
  });

  it("makes post-success audit persistence non-fatal", () => {
    assert.match(route, /void logAction\(/);
    assert.match(route, /company reimport audit persistence failed/);
    assert.match(route, /\.catch\(\(error\) =>/);
  });

  it("keeps Vercel Git deployment enabled (repo policy)", () => {
    assert.equal(vercel.git?.deploymentEnabled?.["main"], true);
  });
});
