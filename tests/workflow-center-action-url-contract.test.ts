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

  it("does not expose direct mutation URLs or HTTP methods", () => {
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

  it("projects every action from the shared action registry", () => {
    assert.match(source, /getTenderAction\(actionId\)/);
    assert.match(source, /actionKind: "navigation" as const/);
    assert.match(source, /actionTarget: action\.anchor/);
    assert.match(source, /mutation: action\.mutation/);
    assert.match(source, /mutationOwner: action\.owner/);
    assert.match(source, /iconName: action\.iconName/);
  });

  it("keeps Action Center informational and navigation-only by construction", () => {
    assert.match(source, /const stage = \(/);
    assert.match(source, /actionAvailability: action\.availability/);
    assert.match(source, /actionKind: "navigation" as const/);
    assert.doesNotMatch(source, /fetch\(|axios\.|prisma\.[a-zA-Z]+\.(?:create|update|delete|upsert)\(/);
  });
});
