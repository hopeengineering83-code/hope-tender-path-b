import assert from "node:assert";
import { describe, it } from "node:test";
import { isForbiddenModel, zaiModelValidity, isProviderConfigured } from "../lib/ai-provider-registry";

describe("Z.ai Forbidden Model Protection", () => {
  it("correctly identifies the forbidden model", () => {
    assert.strictEqual(isForbiddenModel("glm-4.7-flash"), true);
    assert.strictEqual(isForbiddenModel("glm-4-flash"), false);
    assert.strictEqual(isForbiddenModel("gpt-4"), false);
    assert.strictEqual(isForbiddenModel(undefined), false);
  });

  it("rejects Z.ai when forbidden model is in env", () => {
    const env = {
      ZAI_API_KEY: "test-key",
      ZAI_PROPOSAL_MODEL: "glm-4.7-flash"
    };
    const validity = zaiModelValidity(env as unknown as NodeJS.ProcessEnv);
    assert.strictEqual(validity.valid, false);
    assert.match(validity.message!, /forbidden regressed model 'glm-4.7-flash'/);

    // isProviderConfigured should also return false
    assert.strictEqual(isProviderConfigured("zai", env as unknown as NodeJS.ProcessEnv), false);
  });

  it("accepts Z.ai when valid model is in env", () => {
    const env = {
      ZAI_API_KEY: "test-key",
      ZAI_PROPOSAL_MODEL: "glm-4-flash"
    };
    const validity = zaiModelValidity(env as unknown as NodeJS.ProcessEnv);
    assert.strictEqual(validity.valid, true);
    assert.strictEqual(isProviderConfigured("zai", env as unknown as NodeJS.ProcessEnv), true);
  });
});
