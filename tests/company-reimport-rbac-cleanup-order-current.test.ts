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

  it("defers destructive cleanup until primary and safety imports complete", () => {
    const postStart = route.indexOf("export async function POST");
    const primaryPos = route.indexOf("importCompanyKnowledgeFromDocuments(company.id)", postStart);
    const safetyPos = route.indexOf("runCompanyKnowledgeSafetyImport(prisma, company.id)", postStart);
    const cleanupPos = route.indexOf("cleanupSupportDocImportedRecords(company.id)", postStart);
    assert.ok(postStart >= 0);
    assert.ok(primaryPos > postStart);
    assert.ok(safetyPos > primaryPos);
    assert.ok(cleanupPos > safetyPos);
    const postRegion = route.slice(postStart);
    assert.equal(postRegion.match(/cleanupSupportDocImportedRecords\(company\.id\)/g)?.length, 1);
    assert.doesNotMatch(route.slice(postStart, primaryPos), /cleanupSupportDocImportedRecords\(company\.id\)/);
  });

  it("makes support-derived deletion one transaction", () => {
    assert.match(cleanup, /return prisma\.\$transaction\(async \(tx\) =>/);
    assert.match(cleanup, /tx\.companyDocument\.findMany/);
    assert.match(cleanup, /tx\.expert\.deleteMany/);
    assert.match(cleanup, /tx\.project\.deleteMany/);
    assert.doesNotMatch(cleanup, /prisma\.(?:expert|project)\.deleteMany/);
  });

  it("keeps every cleanup query company-scoped", () => {
    const scopes = cleanup.match(/companyId/g) ?? [];
    assert.ok(scopes.length >= 7, `expected repeated company scoping, found ${scopes.length}`);
    assert.match(cleanup, /where: \{ companyId, sourceDocumentId:/);
    assert.match(cleanup, /where: \{ companyId, id: \{ in:/);
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
    assert.equal(vercel.git?.deploymentEnabled, true);
  });
});
