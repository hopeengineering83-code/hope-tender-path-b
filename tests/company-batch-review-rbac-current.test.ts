import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const expertSource = readFileSync("app/api/company/experts/batch/route.ts", "utf8");
const projectSource = readFileSync("app/api/company/projects/batch/route.ts", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));

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
    assert.equal(vercel.git?.deploymentEnabled?.["main"], true);
  });
});


it("company batch review denies mixed or cross-company ids before mutation", () => {
  for (const source of [expertSource, projectSource]) {
    assert.match(source, /const ownedCount = await prisma\.(expert|project)\.count\(\{[\s\S]*where: \{ id: \{ in: ids \}, companyId: company\.id, deletedAt: null \}/);
    assert.match(source, /if \(ownedCount !== ids\.length\) \{/);
    assert.match(source, /code: "RECORD_NOT_FOUND"/);
    const countPos = source.indexOf("const ownedCount = await prisma.");
    const updatePos = source.indexOf("const result = await prisma.");
    assert.ok(countPos >= 0 && updatePos > countPos, "ownership count must happen before updateMany");
  }
});
