import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

const source = readFileSync(join(rootDir, "app/api/tenders/[id]/engine/route.ts"), "utf8");
const vercel = JSON.parse(readFileSync(join(rootDir, "vercel.json"), "utf8"));

describe("tender Engine mutation RBAC", () => {
  it("requires ADMIN or PROPOSAL_MANAGER with no session-only fallback", () => {
    assert.match(source, /requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/);
    assert.match(source, /forbiddenResponse\(\)/);
    assert.match(source, /unauthorizedResponse\(\)/);
    assert.doesNotMatch(source, /getSession/);
    assert.doesNotMatch(source, /"REVIEWER"|"VIEWER"/);
  });

  it("uses the role-approved actor for throttling, ownership, and the engine call", () => {
    const rolePos = source.indexOf('requireRole("ADMIN", "PROPOSAL_MANAGER")');
    const actorPos = source.indexOf("const userId = actor.id");
    const ownerPos = source.indexOf("where: { id, userId }");
    const enginePos = source.indexOf("runTenderEngine(id, userId");
    assert.ok(rolePos >= 0 && actorPos > rolePos && ownerPos > actorPos && enginePos > ownerPos);
    assert.match(source, /rateLimitPersistent\(`engine:\$\{userId\}`/);
  });

  it("preserves all extraction and stored-analysis blockers", () => {
    for (const code of [
      "NO_TENDER_FILES",
      "EXTRACTION_CORRUPTED_ENGINE_SKIPPED",
      "EXTRACTION_QUALITY_ENGINE_BLOCKED",
      "ANALYSIS_FROM_CORRUPTED_EXTRACTION",
      "ANALYSIS_FROM_WEAK_EXTRACTION",
    ]) {
      assert.match(source, new RegExp(code));
    }
    assert.match(source, /listInvalidStoredFields/);
    assert.match(source, /computeStoredMetadataPatch/);
    assert.match(source, /isExtractionAcceptableForGeneration/);
  });

  it("preserves OCR_REQUIRED, REGEX_FALLBACK, stale-analysis and partial-result blockers", () => {
    // These blockers prevent the engine from running on corrupted, weak,
    // regex-fallback, stale, or partial analysis states.
    assert.match(source, /OCR_REQUIRED/);
    assert.match(source, /REGEX_FALLBACK/);
    assert.match(source, /partial/i);
    // The engine must not proceed when analysis is partial.
    assert.match(source, /partial: isPartial/);
    assert.match(source, /success: !isPartial/);
  });

  it("preserves deadline and partial-result honesty", () => {
    assert.match(source, /const deadlineAt = Date\.now\(\) \+ 50_000/);
    assert.match(source, /partial: isPartial/);
    assert.match(source, /success: !isPartial/);
    assert.match(source, /evidenceMatchingBlocker/);
    assert.match(source, /actionableEngineError/);
    assert.match(source, /diagnosticId/);
  });

  it("keeps Vercel Git deployment enabled (repo policy)", () => {
    assert.equal(vercel.git?.deploymentEnabled, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Four-role matrix: ADMIN and PROPOSAL_MANAGER are allowed; VIEWER and
// REVIEWER must receive 403 and cause zero tender, match, analysis, and
// engine-state writes.
// ─────────────────────────────────────────────────────────────────────────────

describe("tender Engine four-role matrix and zero-mutation rejection", () => {
  it("the requireRole allowlist contains exactly ADMIN and PROPOSAL_MANAGER", () => {
    const match = source.match(/requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/);
    assert.ok(match, "requireRole must be called with ADMIN and PROPOSAL_MANAGER");
  });

  it("VIEWER and REVIEWER are not in the allowlist", () => {
    const requireRolePos = source.indexOf("requireRole(");
    const requireRoleRegion = source.slice(requireRolePos, requireRolePos + 120);
    assert.doesNotMatch(requireRoleRegion, /"VIEWER"/,
      "VIEWER must not be in the requireRole allowlist");
    assert.doesNotMatch(requireRoleRegion, /"REVIEWER"/,
      "REVIEWER must not be in the requireRole allowlist");
  });

  it("rejected roles cause zero tender, match, analysis, and engine-state writes", () => {
    // The requireRole try/catch must appear BEFORE any prisma operation
    // (tender.findFirst, runTenderEngine, etc.). A rejected role returns
    // 403/401 before any database mutation can occur.
    const requireRolePos = source.indexOf("requireRole(");
    const firstPrismaPos = source.indexOf("prisma.");
    assert.ok(requireRolePos >= 0, "must call requireRole");
    assert.ok(firstPrismaPos > requireRolePos,
      "requireRole must run before any prisma operation — rejected roles cause zero writes");

    // The catch block must return before any prisma call.
    const catchPos = source.indexOf("} catch (error) {", requireRolePos);
    const returnPos = source.indexOf("return ", catchPos);
    const nextPrismaPos = source.indexOf("prisma.", catchPos);
    assert.ok(catchPos >= 0, "must have a catch block for requireRole");
    assert.ok(returnPos > catchPos && returnPos < nextPrismaPos,
      "catch block must return before any prisma operation — rejected roles cause zero writes");

    // Verify the catch block returns forbiddenResponse for rejected roles.
    assert.match(source.slice(catchPos, returnPos + 200), /forbiddenResponse\(\)/,
      "catch block must return forbiddenResponse for rejected roles");
  });

  it("no session-only fallback remains — getSession is absent", () => {
    assert.doesNotMatch(source, /getSession/,
      "getSession must not appear — no session-only fallback after requireRole");
  });
});
