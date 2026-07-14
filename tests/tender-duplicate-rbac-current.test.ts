import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("app/api/tenders/[id]/duplicate/route.ts", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));

describe("tender duplication mutation RBAC", () => {
  it("requires ADMIN or PROPOSAL_MANAGER with no session-only fallback", () => {
    assert.match(source, /requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/);
    assert.match(source, /forbiddenResponse\(\)/);
    assert.match(source, /unauthorizedResponse\(\)/);
    assert.doesNotMatch(source, /getSession/);
    assert.doesNotMatch(source, /"REVIEWER"|"VIEWER"/);
  });

  it("keeps source lookup and duplicate ownership scoped to the actor", () => {
    assert.match(source, /where: \{ id, userId: actor\.id \}/);
    assert.match(source, /userId: actor\.id/);
    assert.match(source, /Tender not found/);
    assert.match(source, /status: 404/);
  });

  it("resets the duplicate to a fresh intake workflow", () => {
    assert.match(source, /status: "DRAFT"/);
    assert.match(source, /stage: "TENDER_INTAKE"/);
    assert.match(source, /exactFileOrder: "\[\]"/);
    assert.match(source, /exactFileNaming: "\[\]"/);
    assert.match(source, /readinessScore: 0/);
  });

  it("uses actor-scoped throttling and correlated audit", () => {
    assert.match(source, /rateLimit\(`duplicate:\$\{actor\.id\}`/);
    assert.match(source, /extractRequestId\(req\)/);
    assert.match(source, /action: "TENDER_DUPLICATE"/);
    assert.match(source, /sourceTenderId: tender\.id/);
    assert.match(source, /duplicateTenderId: copy\.id/);
    assert.match(source, /requestId/);
  });

  it("keeps Vercel Git deployment enabled (repo policy)", () => {
    assert.equal(vercel.git?.deploymentEnabled?.["main"], true);
  });
});
