import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

const expertSource = readFileSync(join(rootDir, "app/api/company/experts/batch/route.ts"), "utf8");
const projectSource = readFileSync(join(rootDir, "app/api/company/projects/batch/route.ts"), "utf8");
const vercel = JSON.parse(readFileSync(join(rootDir, "vercel.json"), "utf8"));

function assertBatchReviewContract(source: string, entity: "expert" | "project") {
  assert.match(source, /requireRole\("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"\)/);
  assert.match(source, /forbiddenResponse\(\)/);
  assert.match(source, /unauthorizedResponse\(\)/);
  assert.doesNotMatch(source, /getSession/);
  assert.doesNotMatch(source, /"VIEWER"/);

  assert.match(source, /body\.trustLevel !== "REVIEWED"/);
  assert.match(source, /INVALID_TRUST_LEVEL/);
  assert.doesNotMatch(source, /\? body\.trustLevel : "REVIEWED"/);
  assert.doesNotMatch(source, /AI_EXTRACTED|IMPORTED/);

  assert.match(source, /Array\.from\(new Set\(/);
  assert.match(source, /Maximum 200 unique ids per batch/);
  assert.match(source, /companyId: company\.id/);
  assert.match(source, /deletedAt: null/);
  assert.match(source, /trustLevel: "REVIEWED"/);
  assert.match(source, /reviewedBy: actor\.id/);
  assert.match(source, /reviewedAt: new Date\(\)/);

  assert.ok(
    source.includes(`rateLimitPersistent(\`${entity}s-batch-review:\${actor.id}\``),
    `${entity} batch route must use persistent actor-scoped throttling`,
  );
  assert.match(source, /extractRequestId\(req\)/);
  assert.match(source, /void logAction\(/);
  assert.match(source, /\.catch\(\(error\) =>/);
}

describe("company batch review RBAC and explicit approval", () => {
  it("protects Expert batch approval", () => {
    assertBatchReviewContract(expertSource, "expert");
    assert.match(expertSource, /entityType: "Expert"/);
    assert.match(expertSource, /expert batch-review audit persistence failed/);
  });

  it("protects Project batch approval", () => {
    assertBatchReviewContract(projectSource, "project");
    assert.match(projectSource, /entityType: "Project"/);
    assert.match(projectSource, /project batch-review audit persistence failed/);
  });

  it("keeps Vercel Git deployment enabled (repo policy)", () => {
    assert.equal(vercel.git?.deploymentEnabled, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Four-role matrix: ADMIN, PROPOSAL_MANAGER, REVIEWER are allowed; VIEWER is
// rejected. Foreign-company IDs must update zero rows. Input must explicitly
// equal REVIEWED.
// ─────────────────────────────────────────────────────────────────────────────

describe("company batch review four-role matrix and isolation", () => {
  it("ADMIN, PROPOSAL_MANAGER, and REVIEWER are all in the allowlist", () => {
    for (const [name, src] of [["expert", expertSource], ["project", projectSource]] as const) {
      const match = src.match(/requireRole\("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"\)/);
      assert.ok(match, `${name} route must allow ADMIN, PROPOSAL_MANAGER, and REVIEWER`);
    }
  });

  it("VIEWER is not in the allowlist — must be rejected with 403", () => {
    for (const [name, src] of [["expert", expertSource], ["project", projectSource]] as const) {
      const requireRolePos = src.indexOf("requireRole(");
      const requireRoleRegion = src.slice(requireRolePos, requireRolePos + 120);
      assert.doesNotMatch(requireRoleRegion, /"VIEWER"/,
        `${name} route must NOT allow VIEWER`);
    }
  });

  it("foreign-company IDs update zero rows — every updateMany is company-scoped", () => {
    for (const [name, src] of [["expert", expertSource], ["project", projectSource]] as const) {
      // Every updateMany must include companyId in its WHERE clause.
      // This guarantees that IDs from a foreign company match zero rows.
      const updateManyMatches = src.match(/\.updateMany\(\{[\s\S]*?\}\)/g) ?? [];
      assert.ok(updateManyMatches.length > 0, `${name} route must have at least one updateMany`);
      for (const m of updateManyMatches) {
        assert.match(m, /companyId/, `${name} updateMany must be company-scoped — foreign IDs update zero rows`);
      }
    }
  });

  it("input must explicitly equal REVIEWED — no silent default approval", () => {
    for (const [name, src] of [["expert", expertSource], ["project", projectSource]] as const) {
      // The route must reject any trustLevel that is not exactly "REVIEWED".
      assert.match(src, /body\.trustLevel !== "REVIEWED"/,
        `${name} route must reject trustLevel !== "REVIEWED"`);
      assert.match(src, /INVALID_TRUST_LEVEL/,
        `${name} route must return INVALID_TRUST_LEVEL for non-REVIEWED input`);
      // No stale trust level values may appear as defaults.
      assert.doesNotMatch(src, /AI_EXTRACTED|IMPORTED/,
        `${name} route must not accept stale trust level values`);
    }
  });

  it("role check runs before any database mutation — rejected roles cause zero writes", () => {
    for (const [name, src] of [["expert", expertSource], ["project", projectSource]] as const) {
      const requireRolePos = src.indexOf("requireRole(");
      const firstPrismaPos = src.indexOf("prisma.");
      assert.ok(requireRolePos >= 0 && firstPrismaPos > requireRolePos,
        `${name} route: requireRole must run before any prisma operation`);
      // The catch block must return before any prisma call.
      const catchPos = src.indexOf("} catch (error) {", requireRolePos);
      const returnPos = src.indexOf("return ", catchPos);
      const nextPrismaPos = src.indexOf("prisma.", catchPos);
      assert.ok(returnPos > catchPos && returnPos < nextPrismaPos,
        `${name} route: catch block must return before any prisma operation`);
    }
  });
});
