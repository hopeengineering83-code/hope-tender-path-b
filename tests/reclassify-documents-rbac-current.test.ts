import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("app/api/tenders/[id]/reclassify-documents/route.ts", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));

describe("document reclassification mutation RBAC", () => {
  it("requires ADMIN or PROPOSAL_MANAGER with no authenticated-owner fallback", () => {
    assert.match(source, /requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/);
    assert.match(source, /forbiddenResponse\(\)/);
    assert.match(source, /unauthorizedResponse\(\)/);
    assert.doesNotMatch(source, /getSession/);
    assert.doesNotMatch(source, /Fall back to tender-owner check/i);
    assert.doesNotMatch(source, /"REVIEWER"|"VIEWER"/);
  });

  it("derives actorId only after role authorization and keeps every mutation owner-scoped", () => {
    const rolePos = source.indexOf('requireRole("ADMIN", "PROPOSAL_MANAGER")');
    const aliasPos = source.indexOf("const actorId = actor.id");
    const ownerPos = source.indexOf("where: { id: tenderId, userId: actorId }");
    assert.ok(rolePos >= 0 && aliasPos > rolePos && ownerPos > aliasPos);
    assert.match(source, /Tender not found/);
    assert.match(source, /status: 404/);
  });

  it("preserves dry-run behavior and classification rules", () => {
    assert.match(source, /const dryRun = body\.dryRun === true/);
    assert.match(source, /if \(!dryRun\)/);
    assert.match(source, /normalizeDocumentType/);
    assert.match(source, /requiresOfficialOriginal/);
    assert.match(source, /isControlDocument/);
    assert.match(source, /REPLACE_WITH_ORIGINAL/);
    assert.match(source, /NOT_EXPORTABLE/);
  });

  it("uses actor-scoped throttling and correlated audit", () => {
    assert.match(source, /rateLimit\(`reclassify:\$\{actorId\}`/);
    assert.match(source, /extractRequestId\(req\)/);
    assert.match(source, /userId: actorId/);
    assert.match(source, /action: "DOCUMENT_RECLASSIFY"/);
    assert.match(source, /requestId/);
  });

  it("keeps Vercel Git deployment enabled for main (repo policy)", () => {
    assert.equal(vercel.git?.deploymentEnabled?.main, true);
  });
});
