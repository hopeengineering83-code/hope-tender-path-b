import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

const source = readFileSync(join(rootDir, "app/api/tenders/[id]/duplicate/route.ts"), "utf8");
const vercel = JSON.parse(readFileSync(join(rootDir, "vercel.json"), "utf8"));

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

  it("uses the canonical non-fatal audit consistency policy", () => {
    // The audit log must be non-fatal: void + .catch, NOT awaited.
    // A failed audit must not roll back the duplication or surface a 500.
    assert.match(source, /void logAction\(/);
    assert.match(source, /\.catch\(\(error\) =>/);
    assert.match(source, /tender duplicate audit persistence failed/);
    assert.doesNotMatch(source, /await logAction\(/,
      "must not await logAction — audit must be non-fatal");
  });

  it("rejected roles cause zero tender mutations", () => {
    // VIEWER and REVIEWER are not in the requireRole allowlist. The route
    // must return 403/401 before any prisma.tender.create call.
    // The requireRole call must appear BEFORE any prisma.tender operation.
    const requireRolePos = source.indexOf("requireRole(");
    const tenderFindPos = source.indexOf("prisma.tender.findFirst");
    const tenderCreatePos = source.indexOf("prisma.tender.create");
    assert.ok(requireRolePos >= 0 && tenderFindPos > requireRolePos,
      "requireRole must run before any tender lookup");
    assert.ok(tenderCreatePos > tenderFindPos,
      "tender.create must come after the ownership lookup");
    // The role list must NOT include VIEWER or REVIEWER.
    const requireRoleRegion = source.slice(requireRolePos, requireRolePos + 100);
    assert.doesNotMatch(requireRoleRegion, /"VIEWER"/,
      "VIEWER must not be allowed to duplicate tenders");
    assert.doesNotMatch(requireRoleRegion, /"REVIEWER"/,
      "REVIEWER must not be allowed to duplicate tenders");
  });

  it("keeps Vercel Git deployment enabled (repo policy)", () => {
    assert.equal(vercel.git?.deploymentEnabled, true);
  });
});
