import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

const source = readFileSync(join(rootDir, "app/api/tenders/[id]/reclassify-documents/route.ts"), "utf8");
const vercel = JSON.parse(readFileSync(join(rootDir, "vercel.json"), "utf8"));

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

  it("keeps Vercel Git deployment enabled (repo policy)", () => {
    assert.equal(vercel.git?.deploymentEnabled, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Four-role route test: ADMIN and PROPOSAL_MANAGER are allowed; VIEWER and
// REVIEWER must receive 403 and cause zero document mutations.
// ─────────────────────────────────────────────────────────────────────────────

describe("document reclassification four-role matrix", () => {
  // The route uses requireRole("ADMIN", "PROPOSAL_MANAGER"). This means:
  //   ADMIN → allowed
  //   PROPOSAL_MANAGER → allowed
  //   REVIEWER → 403 Forbidden (not in allowlist)
  //   VIEWER → 403 Forbidden (not in allowlist)
  //
  // The catch block returns forbiddenResponse() when requireRole throws
  // "Forbidden", and unauthorizedResponse() for other errors. Both VIEWER and
  // REVIEWER would trigger the "Forbidden" path because requireRole throws
  // when the user's role is not in the allowlist.
  //
  // The critical invariant: the role check runs BEFORE any prisma operation
  // (findFirst, findMany, update). A rejected role causes zero database
  // mutations.

  it("the requireRole allowlist contains exactly ADMIN and PROPOSAL_MANAGER", () => {
    const match = source.match(/requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/);
    assert.ok(match, "requireRole must be called with ADMIN and PROPOSAL_MANAGER");
  });

  it("VIEWER and REVIEWER are not in the allowlist", () => {
    // Extract the requireRole call and verify VIEWER/REVIEWER are absent.
    const requireRolePos = source.indexOf("requireRole(");
    const requireRoleRegion = source.slice(requireRolePos, requireRolePos + 100);
    assert.doesNotMatch(requireRoleRegion, /"VIEWER"/,
      "VIEWER must not be in the requireRole allowlist");
    assert.doesNotMatch(requireRoleRegion, /"REVIEWER"/,
      "REVIEWER must not be in the requireRole allowlist");
  });

  it("rejected roles cause zero document mutations — role check runs before any prisma call", () => {
    // The requireRole try/catch must appear BEFORE any prisma operation.
    const requireRolePos = source.indexOf("requireRole(");
    const firstPrismaPos = source.indexOf("prisma.");
    assert.ok(requireRolePos >= 0, "must call requireRole");
    assert.ok(firstPrismaPos > requireRolePos,
      "requireRole must run before any prisma operation — rejected roles cause zero mutations");

    // The catch block must return forbiddenResponse or unauthorizedResponse
    // (not fall through to the mutation code).
    const catchPos = source.indexOf("} catch (error) {", requireRolePos);
    const nextPrismaPos = source.indexOf("prisma.", catchPos);
    const returnPos = source.indexOf("return ", catchPos);
    assert.ok(catchPos >= 0, "must have a catch block for requireRole");
    assert.ok(returnPos > catchPos && returnPos < nextPrismaPos,
      "catch block must return before any prisma operation — rejected roles cause zero mutations");
    assert.match(source.slice(catchPos, returnPos + 200), /forbiddenResponse\(\)/,
      "catch block must return forbiddenResponse for rejected roles");
  });

  it("no session-only fallback remains — getSession is not imported or called", () => {
    assert.doesNotMatch(source, /getSession/,
      "getSession must not appear — no session-only fallback after requireRole");
    assert.doesNotMatch(source, /Fall back/i,
      "no fallback comment may remain");
  });
});
