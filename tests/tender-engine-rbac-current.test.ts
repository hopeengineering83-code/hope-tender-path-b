import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("app/api/tenders/[id]/engine/route.ts", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));

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

  it("preserves deadline and partial-result honesty", () => {
    assert.match(source, /const deadlineAt = Date\.now\(\) \+ 50_000/);
    assert.match(source, /partial: isPartial/);
    assert.match(source, /success: !isPartial/);
    assert.match(source, /evidenceMatchingBlocker/);
    assert.match(source, /actionableEngineError/);
    assert.match(source, /diagnosticId/);
  });

  it("keeps Vercel Git deployment enabled for main (repo policy)", () => {
    assert.equal(vercel.git?.deploymentEnabled?.main, true);
  });
});
