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

  it("NO file in the codebase uses glm-4.7-flash as a model value (except the registry allowlist comments)", () => {
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
      if (f === "lib/ai-provider-registry.ts") {
        // The registry is ALLOWED to mention glm-4.7-flash / glm-4.5-flash /
        // glm-4 inside comments describing what the allowlist rejects. Only
        // forbid using them as a "Model: ...", "modelDefault: ...", or
        // "default: ..." value (i.e., as an actual configured model).
        assert.ok(
          !/Model:\s*"glm-4\.7|modelDefault:\s*"glm-4\.7|default:\s*"glm-4\.7-flash"/.test(src),
          `${f} must NOT use glm-4.7-flash as a model/default value (comment usage is OK)`,
        );
        // Must use the Z.ai configuration resolver (endpoint/model compatibility)
        assert.match(src, /resolveZaiConfiguration/, "registry must use resolveZaiConfiguration for endpoint/model pairing");
        assert.match(src, /ZAI_GENERAL_MODELS/, "registry must define ZAI_GENERAL_MODELS set");
        assert.match(src, /ZAI_CODING_PLAN_MODELS/, "registry must define ZAI_CODING_PLAN_MODELS set");
        // Both General and Coding Plan models must be recognized
        assert.match(src, /glm-4-flash/, "registry must support glm-4-flash (General API)");
        assert.match(src, /glm-4-coding/, "registry must support glm-4-coding (Coding Plan)");
        continue;
      }
      assert.ok(
        !/Model:\s*"glm-4\.7|modelDefault.*glm-4\.7|default.*glm-4\.7-flash|glm-4\.7-flash/.test(src),
        `${f} must NOT reference glm-4.7-flash`,
      );
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
    assert.ok(!env.includes("glm-4.7-flash"), "check-env must not reference glm-4.7-flash");
  });

  it("ai-environment-readiness says glm-4-flash", () => {
    const ready = read("lib/ai-environment-readiness.ts");
    assert.match(ready, /default: glm-4-flash/);
    assert.ok(!ready.includes("glm-4.7-flash"), "env readiness must not reference glm-4.7-flash");
  });
});
