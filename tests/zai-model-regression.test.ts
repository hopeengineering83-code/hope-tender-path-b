// Z.ai model configuration — the app must attempt the model the operator
// configured, and must not carry its own stale copy of Z.ai's catalogue.
//
// This file previously asserted the opposite: that `glm-4-flash` appeared
// everywhere and `glm-4.7-flash` appeared nowhere. That policy was encoded in
// three places that had drifted into contradicting each other:
//
//   - lib/ai-provider-registry.ts allowed ONLY {glm-4-flash, glm-4-flashx};
//   - lib/release-guardian.ts rejected {glm-4.7-flash, glm-4-flash, glm-4}
//     and quarantined Z.ai when it saw one;
//   - the registry defaults were pinned to glm-4-flash.
//
// So the one model the registry permitted was also the one the guardian
// quarantined: no value of ZAI_PROPOSAL_MODEL could make rank-1 Z.ai both valid
// and un-quarantined. With the operator's current glm-4.7-flash configuration
// the resolver returned MODEL_UNSUPPORTED and Z.ai was skipped before it ever
// issued a request — silently, because skipping is "safe".
//
// The enumerated lists are gone. The app validates what it can know locally
// (key present, endpoint is api.z.ai, identifier is well-formed) and lets Z.ai
// answer the question only Z.ai can: whether this key may use this model.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

import { resolveZaiConfiguration } from "../lib/ai-provider-registry";
import { classifyAiError } from "../lib/ai-provider-health";

const read = (p: string) => readFileSync(p, "utf8");

/** Build an isolated env so tests never depend on ambient variables. */
function isolatedEnv(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...overrides } as NodeJS.ProcessEnv;
}

function resolve(overrides: Record<string, string | undefined>, useCase: "proposal" | "extraction" | "fast" = "proposal") {
  return resolveZaiConfiguration(useCase, isolatedEnv({ ZAI_API_KEY: "test-key", ...overrides }));
}

const OPERATOR_ENV = {
  ZAI_BASE_URL: "https://api.z.ai/api/paas/v4",
  ZAI_PROPOSAL_MODEL: "glm-4.7-flash",
  ZAI_ANALYSIS_MODEL: "glm-4.7-flash",
  ZAI_FAST_MODEL: "glm-4.7-flash",
};

describe("Z.ai configuration accepts the operator's configured model", () => {
  it("resolves the deployed glm-4.7-flash configuration as usable for every use case", () => {
    for (const useCase of ["proposal", "extraction", "fast"] as const) {
      const r = resolve(OPERATOR_ENV, useCase);
      assert.equal(r.valid, true, `${useCase} must be usable with the deployed configuration`);
      assert.equal(r.reason, "OK");
      assert.equal(r.model, "glm-4.7-flash");
    }
  });

  it("defaults to glm-4.7-flash when no model override is set", () => {
    for (const useCase of ["proposal", "extraction", "fast"] as const) {
      const r = resolve({ ZAI_BASE_URL: "https://api.z.ai/api/paas/v4" }, useCase);
      assert.equal(r.model, "glm-4.7-flash");
      assert.equal(r.valid, true);
    }
  });

  it("treats an empty or whitespace override as 'not set' rather than as an invalid model", () => {
    for (const value of ["", "   "]) {
      const r = resolve({ ZAI_PROPOSAL_MODEL: value });
      assert.equal(r.model, "glm-4.7-flash");
      assert.equal(r.valid, true);
    }
  });

  it("accepts future GLM identifiers this codebase has never heard of", () => {
    // The whole point of the fix: a model released after this commit must not
    // be rejected by a list written before it existed.
    for (const model of ["glm-4.8-flash", "glm-5", "glm-9.9-turbo"]) {
      const r = resolve({ ZAI_PROPOSAL_MODEL: model });
      assert.equal(r.valid, true, `${model} must not be pre-emptively rejected`);
      assert.equal(r.model, model);
    }
  });
});

describe("Z.ai configuration still fails closed on what it can actually verify", () => {
  it("refuses a missing API key", () => {
    const r = resolveZaiConfiguration("proposal", isolatedEnv({ ...OPERATOR_ENV }));
    assert.equal(r.valid, false);
    assert.equal(r.reason, "API_KEY_MISSING");
  });

  it("refuses any endpoint that is not the general api.z.ai endpoint", () => {
    // Includes the Coding Plan / Zhipu host, which this application must not use.
    for (const baseUrl of ["https://open.bigmodel.cn/api/paas/v4", "https://example.invalid/v1"]) {
      const r = resolve({ ...OPERATOR_ENV, ZAI_BASE_URL: baseUrl });
      assert.equal(r.valid, false, `${baseUrl} must be refused`);
      assert.equal(r.reason, "BASE_URL_MISSING");
    }
  });

  it("refuses another vendor's model identifier pasted into ZAI_PROPOSAL_MODEL", () => {
    for (const model of ["gpt-4o", "claude-3-5-sonnet", "llama-3.1-70b", "gemini-1.5-pro", "glm", "glm-coding"]) {
      const r = resolve({ ZAI_PROPOSAL_MODEL: model });
      assert.equal(r.valid, false, `${model} must be refused`);
      assert.equal(r.reason, "MODEL_UNSUPPORTED");
    }
  });

  it("never returns the API key value in its result", () => {
    const r = resolve({ ...OPERATOR_ENV });
    assert.doesNotMatch(JSON.stringify(r), /test-key/);
  });
});

describe("No component keeps a private copy of Z.ai's model catalogue", () => {
  it("the registry no longer enumerates which GLM models exist", () => {
    const reg = read("lib/ai-provider-registry.ts");
    assert.doesNotMatch(reg, /ZAI_GENERAL_MODELS\s*=\s*new Set/);
    assert.doesNotMatch(reg, /ZAI_CODING_PLAN_MODELS\s*=\s*new Set/);
  });

  it("the release guardian no longer rejects specific model names", () => {
    const guardian = read("lib/release-guardian.ts");
    assert.doesNotMatch(guardian, /REJECTED_ZAI_MODELS\s*=\s*new Set/);
  });

  it("nothing recommends the Coding Plan / Zhipu endpoint", () => {
    for (const file of [
      "app/api/admin/ai-provider-health/zai-diagnostic/route.ts",
      "lib/ai-provider-registry.ts",
      "scripts/check-env.mjs",
      "scripts/provider-smoke-test.mjs",
      "docs/ai-provider-runbook.md",
      "README.md",
    ]) {
      assert.doesNotMatch(read(file), /bigmodel\.cn/, `${file} must not point operators at the Coding Plan endpoint`);
    }
  });

  it("the runtime model still comes from the registry, never a literal in a caller", () => {
    const ai = read("lib/ai.ts");
    const block = ai.slice(ai.indexOf("async function generateWithZai"), ai.indexOf("async function generateWithCerebras"));
    assert.match(block, /getProviderModel\("zai"/);
    assert.doesNotMatch(block, /"glm-\d/);

    for (const file of ["app/api/ai/health/route.ts", "components/ai-health-panel.tsx"]) {
      const src = read(file);
      assert.match(src, /getProviderModel/);
      assert.doesNotMatch(src, /"glm-\d/, `${file} must not hardcode a model`);
    }
  });

  it("Z.ai remains canonical rank 1", () => {
    const reg = read("lib/ai-provider-registry.ts");
    const zaiBlock = reg.slice(reg.indexOf("  zai: {"), reg.indexOf("  cerebras: {"));
    assert.match(zaiBlock, /rank:\s*1/);
  });
});

describe("Z.ai failures are distinguishable rather than collapsed into one bucket", () => {
  it("separates authentication, quota, model access, timeout, malformed response, and provider outage", () => {
    const cases: Array<[string, string]> = [
      ["401 Unauthorized", "AUTH"],
      ["invalid api key", "AUTH"],
      ["429 Too Many Requests", "RATE_LIMIT"],
      ["402 insufficient balance", "BILLING"],
      ["400 unknown model glm-x", "MODEL_UNAVAILABLE"],
      ["request timed out", "TIMEOUT"],
      ["invalid json in response", "MALFORMED_RESPONSE"],
      ["503 service unavailable", "PROVIDER_ERROR"],
      ["502 bad gateway", "PROVIDER_ERROR"],
    ];
    for (const [message, expected] of cases) {
      assert.equal(classifyAiError(new Error(message)), expected, `"${message}" must classify as ${expected}`);
    }
  });

  it("keeps a rate-limited 503 as RATE_LIMIT rather than a provider outage", () => {
    assert.equal(classifyAiError(new Error("503 rate limit exceeded")), "RATE_LIMIT");
  });
});

describe("The Z.ai diagnostic reports the operator's own configuration", () => {
  const route = read("app/api/admin/ai-provider-health/zai-diagnostic/route.ts");

  it("tests the configured model, not only a fixed list", () => {
    assert.match(route, /modelsToTest\s*=\s*\[\.\.\.new Set\(\[model,/);
  });

  it("surfaces the resolver verdict so a skipped provider is visible", () => {
    assert.match(route, /resolverVerdict/);
    assert.match(route, /resolveZaiConfiguration\("proposal"\)/);
  });

  it("classifies provider failures instead of echoing the raw response body", () => {
    assert.match(route, /failureCategory/);
    assert.match(route, /classifyAiError/);
    assert.doesNotMatch(route, /error:\s*body\.slice/);
  });

  it("reports key presence without returning any part of the key", () => {
    assert.doesNotMatch(route, /apiKey\.slice\(0,\s*\d+\)/);
    assert.doesNotMatch(route, /apiKey\.slice\(-\d+\)/);
    assert.match(route, /keyPresence/);
  });
});
