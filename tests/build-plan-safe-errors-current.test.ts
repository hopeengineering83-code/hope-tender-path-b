import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const canonical = readFileSync("app/api/tenders/[id]/build-plan/route.ts", "utf8");
const compatibility = readFileSync("app/api/tenders/[id]/submission-plan/build/route.ts", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));

function assertSafeRuntimeContract(source: string) {
  assert.doesNotMatch(source, /sanitizeError/);
  assert.doesNotMatch(source, /detail:\s*(?:error|message)/);
  assert.match(source, /BUILD_PLAN_RUNTIME_ERROR/);
  assert.match(source, /extractRequestId\(req\)/);
  assert.match(source, /requestId/);
  assert.match(source, /errorClass: error instanceof Error \? error\.constructor\.name : "UnknownError"/);
}

describe("canonical and compatibility Build Plan routes", () => {
  it("return the same stable unexpected-runtime contract", () => {
    assertSafeRuntimeContract(canonical);
    assertSafeRuntimeContract(compatibility);
    assert.match(canonical, /Build Plan could not be created/);
    assert.match(compatibility, /Build Plan could not be created/);
  });

  it("preserve exact typed preflight blockers from the canonical service", () => {
    for (const source of [canonical, compatibility]) {
      assert.match(source, /buildDraftBuildPlan\(prisma, id, actor\.id\)/);
      assert.match(source, /draftResult\.code/);
      assert.match(source, /draftResult\.message/);
      assert.match(source, /draftResult\.status/);
    }
  });

  it("preserve the zero GeneratedDocument authority invariant", () => {
    for (const source of [canonical, compatibility]) {
      assert.match(source, /generatedDocument\.count/);
      assert.match(source, /authorizesGeneration: false/);
      assert.doesNotMatch(source, /generatedDocument\.(?:create|upsert|createMany)\(/);
    }
    assert.match(compatibility, /generatedDocumentsCreated: 0/);
  });

  it("keep mutation authorization restricted", () => {
    assert.match(canonical, /requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/);
    assert.match(compatibility, /requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/);
  });

  it("keeps Vercel Git deployment enabled for main (repo policy)", () => {
    assert.equal(vercel.git?.deploymentEnabled?.main, true);
  });
});
