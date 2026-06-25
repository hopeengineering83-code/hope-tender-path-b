import assert from "node:assert";
import { describe, it } from "node:test";
import { zaiModelValidity, isProviderConfigured } from "../lib/ai-provider-registry";

describe("Z.ai Forbidden Model Protection", () => {

  it("rejects Z.ai when forbidden model is in env", () => {
    const env = {
      ZAI_API_KEY: "test-key",
      ZAI_PROPOSAL_MODEL: "glm-4.7-flash"
    };
    const validity = zaiModelValidity(env as unknown as NodeJS.ProcessEnv);
    assert.strictEqual(validity.valid, false);
    assert.match(validity.reason!, /is forbidden; use glm-4-flash/);

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
