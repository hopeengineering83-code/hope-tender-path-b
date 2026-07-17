import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("app/api/company/knowledge/repair/route.ts", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));

const getStart = source.indexOf("export async function GET");
const postStart = source.indexOf("export async function POST");
const getRegion = source.slice(getStart, postStart);
const postRegion = source.slice(postStart);

describe("company knowledge repair mutation RBAC", () => {
  it("keeps paginated diagnostics GET available to authenticated readers", () => {
    assert.match(getRegion, /getSession\(\)/);
    assert.match(getRegion, /new URL\(req\.url\)/);
    assert.match(getRegion, /buildDiagnostics\(company\.id,\s*\{/);
    assert.match(getRegion, /expertPage: requestedPage\(searchParams, "expertPage"\)/);
    assert.match(getRegion, /projectPage: requestedPage\(searchParams, "projectPage"\)/);
    assert.doesNotMatch(getRegion, /importCompanyKnowledgeFromDocuments/);
  });

  it("requires ADMIN or PROPOSAL_MANAGER for POST", () => {
    assert.match(postRegion, /requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/);
    assert.match(postRegion, /forbiddenResponse\(\)/);
    assert.match(postRegion, /unauthorizedResponse\(\)/);
    assert.doesNotMatch(postRegion, /getSession/);
    assert.doesNotMatch(postRegion, /"REVIEWER"|"VIEWER"/);
  });

  it("uses the role-approved actor for persistent throttling and company scope", () => {
    assert.match(postRegion, /rateLimitPersistent\(`knowledge-repair:\$\{actor\.id\}`/);
    assert.match(postRegion, /getCompany\(actor\.id\)/);
    assert.match(postRegion, /userId: actor\.id/);
  });

  it("preserves importer and paginated diagnostic behavior", () => {
    assert.match(postRegion, /importCompanyKnowledgeFromDocuments\(company\.id\)/);
    assert.match(postRegion, /buildDiagnostics\(company\.id\)/);
    assert.match(postRegion, /result: \{ \.\.\.result, diagnostics \}/);
    assert.match(postRegion, /expertsCreated: result\.expertsCreated/);
    assert.match(postRegion, /projectsCreated: result\.projectsCreated/);
  });

  it("returns stable correlated failures and makes audit non-fatal", () => {
    assert.match(postRegion, /COMPANY_KNOWLEDGE_REPAIR_FAILED/);
    assert.match(postRegion, /extractRequestId\(req\)/);
    assert.match(postRegion, /errorClass: error instanceof Error \? error\.constructor\.name : "UnknownError"/);
    assert.match(postRegion, /void logAction\(/);
    assert.match(postRegion, /company knowledge repair audit persistence failed/);
    assert.doesNotMatch(postRegion, /error:\s*(?:error\.message|String\(error\))/);
  });

  it("keeps Vercel Git deployment enabled (repo policy)", () => {
    assert.equal(vercel.git?.deploymentEnabled?.["main"], true);
  });
});
