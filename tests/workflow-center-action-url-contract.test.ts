import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readRouteSource(): string {
  return readFileSync(
    resolve(process.cwd(), "app/api/tenders/[id]/workflow-center/route.ts"),
    "utf8",
  );
}

describe("workflow-center canonical ownership contract", () => {
  const source = readRouteSource();

  it("does not expose direct mutation URLs", () => {
    assert.doesNotMatch(source, /actionUrl\s*:/);
    assert.doesNotMatch(source, /actionMethod\s*:/);
  });

  it("does not bypass canonical AI Analyze, Build Plan, evidence, generation, validation, or ZIP panels", () => {
    assert.doesNotMatch(source, /ai-analyze\?mode=background/);
    assert.doesNotMatch(source, /submission-plan\/build/);
    assert.doesNotMatch(source, /link-vault-evidence-auto/);
    assert.doesNotMatch(source, /generate-missing-plan-files/);
    assert.doesNotMatch(source, /\/validate`/);
    assert.doesNotMatch(source, /download-final-zip/);
  });

  it("classifies every action through the shared mutation registry", () => {
    assert.match(source, /actionKind:\s*isMutationAction\(actionName\)/);
  });

  it("documents that Action Center is informational and navigation-only", () => {
    assert.match(source, /Action Center is informational\/navigation only/);
    assert.match(source, /canonical panels/);
    assert.match(source, /integrity, and ZIP gates/);
  });
});
