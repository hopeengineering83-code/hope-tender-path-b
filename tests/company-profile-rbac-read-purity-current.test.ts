import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

const source = readFileSync(join(rootDir, "app/api/company/route.ts"), "utf8");
const vercel = JSON.parse(readFileSync(join(rootDir, "vercel.json"), "utf8"));

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

  it("validates setupCompletedAt before any database write and returns 400 for invalid dates", () => {
    const putStart = source.indexOf("export async function PUT");
    const putRegion = source.slice(putStart);
    // The date validation must happen BEFORE prisma.company.upsert.
    const validationPos = putRegion.indexOf("parseDateOrNull(body.setupCompletedAt)");
    const upsertPos = putRegion.indexOf("prisma.company.upsert");
    assert.ok(validationPos >= 0, "must validate setupCompletedAt with parseDateOrNull");
    assert.ok(upsertPos > validationPos, "date validation must run BEFORE prisma.company.upsert");
    // Invalid dates must return a stable 400 with INVALID_DATE code.
    assert.match(putRegion, /code: "INVALID_DATE"/);
    assert.match(putRegion, /status: 400/);
    // The create and update paths must use parseDateOrThrow, not raw new Date().
    assert.match(putRegion, /parseDateOrThrow\(body\.setupCompletedAt/);
    assert.doesNotMatch(putRegion, /new Date\(body\.setupCompletedAt as string\)/,
      "must NOT use raw new Date(body.setupCompletedAt) — validates first");
  });

  it("GET never performs destructive cleanup (row preservation)", () => {
    const getStart = source.indexOf("export async function GET");
    const putStart = source.indexOf("export async function PUT");
    const getRegion = source.slice(getStart, putStart);
    // GET must not call deleteMany, delete, or any cleanup helper.
    assert.doesNotMatch(getRegion, /deleteMany|\.delete\(/);
    assert.doesNotMatch(getRegion, /cleanupSupportDocImportedRecords/);
    // GET must use loadCompany (read-only helper), not upsert or update.
    assert.match(getRegion, /loadCompany\(userId\)/);
    assert.doesNotMatch(getRegion, /upsert|\.update\(/);
    // loadCompany itself must use findUnique (read-only).
    const loadCompanyPos = source.indexOf("async function loadCompany");
    const loadCompanyRegion = source.slice(loadCompanyPos, loadCompanyPos + 500);
    assert.match(loadCompanyRegion, /findUnique/,
      "loadCompany must use findUnique (read-only)");
    assert.doesNotMatch(loadCompanyRegion, /deleteMany|\.delete\(|upsert/,
      "loadCompany must not perform any destructive operations");
  });

  it("keeps Vercel Git deployment enabled (repo policy)", () => {
    assert.equal(vercel.git?.deploymentEnabled, true);
  });
});
