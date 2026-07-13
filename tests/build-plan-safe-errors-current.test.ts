import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

const canonical = readFileSync(join(rootDir, "app/api/tenders/[id]/build-plan/route.ts"), "utf8");
const compatibility = readFileSync(join(rootDir, "app/api/tenders/[id]/submission-plan/build/route.ts"), "utf8");
const vercel = JSON.parse(readFileSync(join(rootDir, "vercel.json"), "utf8"));

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
  });

  it("reports the actual measured GeneratedDocument delta, not a hardcoded 0", () => {
    // The compatibility route measures beforeDocs and afterDocs around the
    // Build Plan creation. The response must report the actual delta
    // (afterDocs - beforeDocs), not a hardcoded 0.
    assert.match(compatibility, /generatedDocumentsCreated: afterDocs - beforeDocs/);
    assert.doesNotMatch(compatibility, /generatedDocumentsCreated: 0/,
      "must NOT hardcode generatedDocumentsCreated to 0 — use the measured delta");
  });

  it("keep mutation authorization restricted", () => {
    assert.match(canonical, /requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/);
    assert.match(compatibility, /requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/);
  });

  it("keeps Vercel Git deployment enabled (repo policy)", () => {
    assert.equal(vercel.git?.deploymentEnabled, true);
  });
});
