import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("app/api/company/route.ts", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));

describe("company profile RBAC and read purity", () => {
  it("keeps GET authenticated and free of destructive knowledge cleanup", () => {
    const getStart = source.indexOf("export async function GET");
    const putStart = source.indexOf("export async function PUT");
    const getRegion = source.slice(getStart, putStart);
    assert.match(getRegion, /getSession\(\)/);
    assert.match(getRegion, /loadCompany\(userId\)/);
    assert.doesNotMatch(getRegion, /deleteMany|cleanupSupportDocImportedRecords/);
  });

  it("removes automatic support-import cleanup from the profile route", () => {
    assert.doesNotMatch(source, /import \{ cleanupSupportDocImportedRecords \}/);
    assert.doesNotMatch(source, /await cleanupSupportDocImportedRecords\(/);
    assert.doesNotMatch(source, /\.expert\.deleteMany|\.project\.deleteMany/);
  });

  it("requires approved mutation roles for PUT", () => {
    const putStart = source.indexOf("export async function PUT");
    const putRegion = source.slice(putStart);
    assert.match(putRegion, /requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/);
    assert.match(putRegion, /forbiddenResponse\(\)/);
    assert.match(putRegion, /unauthorizedResponse\(\)/);
    assert.doesNotMatch(putRegion, /const userId = await getSession\(\)/);
    assert.doesNotMatch(putRegion, /"REVIEWER"|"VIEWER"/);
  });

  it("keeps profile persistence actor-scoped", () => {
    const putStart = source.indexOf("export async function PUT");
    const putRegion = source.slice(putStart);
    assert.match(putRegion, /where: \{ userId: actor\.id \}/);
    assert.match(putRegion, /userId: actor\.id/);
    assert.match(putRegion, /rateLimitPersistent\(`company-update:\$\{actor\.id\}`/);
  });

  it("returns stable correlated failures and makes audit non-fatal", () => {
    assert.match(source, /COMPANY_PROFILE_UPDATE_FAILED/);
    assert.match(source, /extractRequestId\(req\)/);
    assert.match(source, /errorClass: error instanceof Error \? error\.constructor\.name : "UnknownError"/);
    assert.match(source, /void logAction\(/);
    assert.match(source, /company profile audit persistence failed/);
    assert.doesNotMatch(source, /error:\s*(?:error\.message|String\(error\))/);
  });

  it("keeps Vercel Git deployment enabled (repo policy)", () => {
    assert.equal(vercel.git?.deploymentEnabled?.["main"], true);
  });
});
