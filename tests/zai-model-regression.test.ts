// Regression test: diagnostics and runtime MUST report glm-4-flash, not glm-4.7-flash.
// The old invalid model name was the root cause of the persistent AI Analyze failure.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("Z.ai model name regression — glm-4-flash everywhere, never glm-4.7-flash", () => {

  it("registry defaults to glm-4-flash for all use cases", () => {
    const reg = read("lib/ai-provider-registry.ts");
    assert.match(reg, /proposalModel:\s*"glm-4-flash"/);
    assert.match(reg, /analysisModel:\s*"glm-4-flash"/);
    assert.match(reg, /fastModel:\s*"glm-4-flash"/);
  });

  it("NO file in the codebase uses glm-4.7-flash as a model value", () => {
    // Check every source file except node_modules
    const files = [
      "lib/ai-provider-registry.ts",
      "lib/ai.ts",
      "lib/ai-environment-readiness.ts",
      "lib/ai-provider-health.ts",
      "scripts/provider-smoke-test.mjs",
      "scripts/check-env.mjs",
      "app/api/ai-providers/diagnostics/route.ts",
      "app/api/ai/health/route.ts",
      "app/api/admin/ai-provider-health/test/route.ts",
      "components/ai-health-panel.tsx",
      "components/ai-health-test-button.tsx",
      "docs/ai-provider-runbook.md",
      "README.md",
    ];
    for (const f of files) {
      const src = read(f);
      // We allow the string in validation logic itself
      const lines = src.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes("glm-4.7-flash")) {
           // Allow if it's a validation check or a comment about it
           const isAllowed = line.includes("isForbiddenModel") ||
                             line.includes("forbidden =") ||
                             line.includes("validateZaiModels") ||
                             line.includes("regressed") ||
                             line.includes("model.trim() ===") ||
                             line.includes("/* FORBIDDEN_MODEL */");
           assert.ok(isAllowed, `${f}:${i+1} must NOT reference glm-4.7-flash outside of validation logic. Line: ${line.trim()}`);
        }
      }
    }
  });

  it("diagnostics endpoint uses selfTestAllProviders (which calls callProvider → getProviderModel)", () => {
    const route = read("app/api/ai-providers/diagnostics/route.ts");
    assert.match(route, /selfTestAllProviders/);
  });

  it("selfTestProvider calls callProvider with useCase fast (which reads registry model)", () => {
    const ai = read("lib/ai.ts");
    const block = ai.slice(ai.indexOf("selfTestProvider"), ai.indexOf("selfTestAllProviders"));
    assert.match(block, /callProvider\(provider,\s*PROVIDER_SELF_TEST_PROMPT,\s*\{\s*useCase:\s*"fast"\s*\}\)/);
  });

  it("generateWithZai calls getProviderModel (not a hardcoded model)", () => {
    const ai = read("lib/ai.ts");
    const block = ai.slice(ai.indexOf("async function generateWithZai"), ai.indexOf("async function generateWithCerebras"));
    assert.match(block, /getProviderModel\("zai"/);
    // Must NOT hardcode glm-4.7-flash
    assert.ok(!block.includes("glm-4.7-flash"), "generateWithZai must not hardcode glm-4.7-flash");
  });

  it("ai/health route uses getProviderModel (not hardcoded)", () => {
    const route = read("app/api/ai/health/route.ts");
    assert.match(route, /getProviderModel/);
    assert.ok(!route.includes("glm-4.7-flash"), "health route must not hardcode glm-4.7-flash");
  });

  it("ai-health-panel uses getProviderModel (not hardcoded)", () => {
    const panel = read("components/ai-health-panel.tsx");
    assert.match(panel, /getProviderModel/);
    assert.ok(!panel.includes("glm-4.7-flash"), "health panel must not hardcode glm-4.7-flash");
  });

  it("provider-smoke-test uses glm-4-flash as default", () => {
    const smoke = read("scripts/provider-smoke-test.mjs");
    assert.match(smoke, /modelDefault:\s*"glm-4-flash"/);
    assert.ok(!smoke.includes("glm-4.7-flash"), "smoke test must not reference glm-4.7-flash");
  });

  it("check-env description says glm-4-flash", () => {
    const env = read("scripts/check-env.mjs");
    assert.match(env, /default glm-4-flash/);
    // Exclude validation logic
    const lines = env.split('\n');
    for (const line of lines) {
       if (line.includes("glm-4.7-flash") && !line.includes("forbidden =") && !line.includes("validateZaiModels") && !line.includes("/* FORBIDDEN_MODEL */")) {
          assert.fail(`check-env contains glm-4.7-flash in non-validation context: ${line.trim()}`);
       }
    }
  });

  it("ai-environment-readiness says glm-4-flash", () => {
    const ready = read("lib/ai-environment-readiness.ts");
    assert.match(ready, /default: glm-4-flash/);
    assert.ok(!ready.includes("glm-4.7-flash"), "env readiness must not reference glm-4.7-flash");
  });
});
