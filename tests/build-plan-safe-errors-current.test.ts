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
  assert.match(source, /Build Plan could not be automatically derived and verified/);
}

describe("canonical and compatibility Build Plan routes", () => {
  it("return the same stable unexpected-runtime contract", () => {
    assertSafeRuntimeContract(canonical);
    assertSafeRuntimeContract(compatibility);
  });

  it("preserve exact typed preflight blockers from automatic verification", () => {
    for (const source of [canonical, compatibility]) {
      assert.match(source, /buildAndVerifyBuildPlan\(prisma, id, actor\.id, \{ reuseCurrent: false \}\)/);
      assert.match(source, /result\.code/);
      assert.match(source, /result\.message/);
      assert.match(source, /result\.status/);
      assert.match(source, /result\.blockers \?\? \[\]/);
      assert.match(source, /automaticVerificationPending: true/);
    }
  });

  it("preserves the zero GeneratedDocument authority invariant", () => {
    for (const source of [canonical, compatibility]) {
      assert.match(source, /generatedDocument\.count/);
      assert.match(source, /generatedDocumentsCreated: after(?:Docs)? - before(?:Docs)?/);
      assert.doesNotMatch(source, /generatedDocument\.(?:create|upsert|createMany)\(/);
      assert.match(source, /authorizesGeneration: true/);
    }
  });

  it("keeps mutation authorization restricted", () => {
    assert.match(canonical, /requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/);
    assert.match(compatibility, /requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/);
  });

  it("keeps Vercel Git deployment enabled by repository policy", () => {
    assert.equal(vercel.git?.deploymentEnabled?.main, true);
  });
});
