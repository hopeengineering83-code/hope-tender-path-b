import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("app/api/tenders/route.ts", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));

const getStart = source.indexOf("export async function GET");
const postStart = source.indexOf("export async function POST");
const getRegion = source.slice(getStart, postStart);
const postRegion = source.slice(postStart);

describe("tender creation mutation RBAC", () => {
  it("keeps GET available to authenticated readers", () => {
    assert.match(getRegion, /getSession\(\)/);
    assert.match(getRegion, /tender-list:\$\{userId\}/);
    assert.match(getRegion, /where: \{\s*userId/);
  });

  it("requires ADMIN or PROPOSAL_MANAGER for POST with no session-only fallback", () => {
    assert.match(postRegion, /requireRoleOrRespond\("ADMIN", "PROPOSAL_MANAGER"\)/);
    assert.doesNotMatch(postRegion, /getSession/);
    assert.doesNotMatch(postRegion, /"REVIEWER"|"VIEWER"/);
  });

  it("uses the approved actor for persistent throttling and ownership", () => {
    assert.match(postRegion, /rateLimitPersistent\(`tender-create:\$\{actor\.id\}`/);
    assert.match(postRegion, /userId: actor\.id/);
    assert.match(postRegion, /extractRequestId\(req\)/);
  });

  it("preserves input validation and fresh intake state", () => {
    assert.match(postRegion, /title is required/);
    assert.match(postRegion, /title must be 500 characters or fewer/);
    assert.match(postRegion, /description must be 10,000 characters or fewer/);
    assert.match(postRegion, /budget must be a finite number/);
    assert.match(postRegion, /status: "DRAFT"/);
    assert.match(postRegion, /stage: "TENDER_INTAKE"/);
    assert.match(postRegion, /cleanTenderTitle/);
    assert.match(postRegion, /cleanClientName/);
  });

  it("returns stable correlated failures and makes audit non-fatal", () => {
    assert.match(postRegion, /TENDER_CREATE_FAILED/);
    assert.match(postRegion, /errorClass: error instanceof Error \? error\.constructor\.name : "UnknownError"/);
    assert.match(postRegion, /void logAction\(/);
    assert.match(postRegion, /tender creation audit persistence failed/);
    assert.match(postRegion, /requestId/);
    assert.doesNotMatch(postRegion, /error:\s*(?:error\.message|String\(error\))/);
  });

  it("keeps Vercel Git deployment enabled (repo policy)", () => {
    assert.equal(vercel.git?.deploymentEnabled?.["main"], true);
  });
});
