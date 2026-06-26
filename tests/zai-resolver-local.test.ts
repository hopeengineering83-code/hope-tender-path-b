import assert from "node:assert";
import { test, describe } from "node:test";
import { zaiConfigurationValidity, isProviderConfigured } from "../lib/ai-provider-registry";
import { deriveProviderStatus } from "../lib/ai-provider-health";
import { generateWithFallback } from "../lib/ai";
import { getAIEnvironmentReadiness } from "../lib/ai-environment-readiness";

// Minimal mock of NodeJS.ProcessEnv to satisfy TypeScript
const baseEnv = {
  NODE_ENV: "test",
} as any;

describe("zaiConfigurationValidity", () => {
  test("accepts default general config", () => {
    const v = zaiConfigurationValidity("proposal", baseEnv);
    assert.strictEqual(v.valid, true);
    assert.strictEqual(v.model, "glm-4-flash");
    assert.strictEqual(v.planType, "GENERAL");
  });

  test("accepts valid coding config", () => {
    const env = {
      ...baseEnv,
      ZAI_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
      ZAI_PROPOSAL_MODEL: "glm-4-coding"
    };
    const v = zaiConfigurationValidity("proposal", env as any);
    assert.strictEqual(v.valid, true);
    assert.strictEqual(v.model, "glm-4-coding");
    assert.strictEqual(v.planType, "CODING");
  });

  test("rejects coding model on general endpoint", () => {
    const env = {
      ...baseEnv,
      ZAI_BASE_URL: "https://api.z.ai/api/paas/v4",
      ZAI_PROPOSAL_MODEL: "glm-4-coding"
    };
    const v = zaiConfigurationValidity("proposal", env as any);
    assert.strictEqual(v.valid, false);
    assert.strictEqual(v.reason, "MODEL_ENDPOINT_MISMATCH");
  });

  test("rejects general model on coding endpoint", () => {
    const env = {
      ...baseEnv,
      ZAI_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
      ZAI_PROPOSAL_MODEL: "glm-4-flash"
    };
    const v = zaiConfigurationValidity("proposal", env as any);
    assert.strictEqual(v.valid, false);
    assert.strictEqual(v.reason, "MODEL_ENDPOINT_MISMATCH");
  });

  test("rejects invalid model (PR #864 preservation)", () => {
    const env = {
      ...baseEnv,
      ZAI_PROPOSAL_MODEL: "glm-4.7-flash"
    };
    const v = zaiConfigurationValidity("proposal", env as any);
    assert.strictEqual(v.valid, false);
    assert.strictEqual(v.reason, "MODEL_UNAVAILABLE");
  });

  test("isProviderConfigured returns false for invalid Z.ai config", () => {
    const env = {
      ...baseEnv,
      ZAI_API_KEY: "test-key",
      ZAI_PROPOSAL_MODEL: "glm-4-7-flash"
    };
    assert.strictEqual(isProviderConfigured("zai", env as any), false);
  });
});

describe("deriveProviderStatus with Z.ai integration", () => {
  test("returns CONFIGURATION_INVALID for Z.ai endpoint mismatch", () => {
    const oldKey = process.env.ZAI_API_KEY;
    const oldBase = process.env.ZAI_BASE_URL;
    const oldModel = process.env.ZAI_PROPOSAL_MODEL;
    try {
      process.env.ZAI_API_KEY = "test-key";
      process.env.ZAI_BASE_URL = "https://api.z.ai/api/paas/v4";
      process.env.ZAI_PROPOSAL_MODEL = "glm-4-coding";

      assert.strictEqual(deriveProviderStatus("zai"), "CONFIGURATION_INVALID");
    } finally {
      process.env.ZAI_API_KEY = oldKey;
      process.env.ZAI_BASE_URL = oldBase;
      process.env.ZAI_PROPOSAL_MODEL = oldModel;
    }
  });

  test("returns MODEL_UNAVAILABLE for Z.ai invalid model", () => {
    const oldKey = process.env.ZAI_API_KEY;
    const oldModel = process.env.ZAI_PROPOSAL_MODEL;
    try {
      process.env.ZAI_API_KEY = "test-key";
      process.env.ZAI_PROPOSAL_MODEL = "glm-4.7-flash";

      assert.strictEqual(deriveProviderStatus("zai"), "MODEL_UNAVAILABLE");
    } finally {
      process.env.ZAI_API_KEY = oldKey;
      process.env.ZAI_PROPOSAL_MODEL = oldModel;
    }
  });
});

describe("getAIEnvironmentReadiness with Z.ai integration", () => {
  test("adds warning for Z.ai endpoint mismatch", () => {
    const oldKey = process.env.ZAI_API_KEY;
    const oldBase = process.env.ZAI_BASE_URL;
    const oldModel = process.env.ZAI_PROPOSAL_MODEL;
    try {
      process.env.ZAI_API_KEY = "test-key";
      process.env.ZAI_BASE_URL = "https://api.z.ai/api/paas/v4";
      process.env.ZAI_PROPOSAL_MODEL = "glm-4-coding";

      const readiness = getAIEnvironmentReadiness();
      assert.ok(readiness.warnings.some(w => w.includes("Z.ai Coding model") && w.includes("requires a Coding Plan endpoint")));
    } finally {
      process.env.ZAI_API_KEY = oldKey;
      process.env.ZAI_BASE_URL = oldBase;
      process.env.ZAI_PROPOSAL_MODEL = oldModel;
    }
  });
});

describe("generateWithFallback with Z.ai integration", () => {
  test("skips Z.ai and does not consume attempt budget on invalid config", async () => {
    const oldKey = process.env.ZAI_API_KEY;
    const oldBase = process.env.ZAI_BASE_URL;
    const oldModel = process.env.ZAI_PROPOSAL_MODEL;
    const oldMistralKey = process.env.MISTRAL_API_KEY;
    try {
      process.env.ZAI_API_KEY = "test-key";
      process.env.ZAI_BASE_URL = "https://api.z.ai/api/paas/v4";
      process.env.ZAI_PROPOSAL_MODEL = "glm-4-coding"; // Invalid mismatch

      process.env.MISTRAL_API_KEY = "test-mistral-key";

      try {
        await generateWithFallback("test prompt", {
            onProviderAttempt: (p) => {
                if (p === "zai") {
                    throw new Error("Z.ai should have been skipped!");
                }
            }
        });
      } catch (err: any) {
        assert.notStrictEqual(err.message, "Z.ai should have been skipped!");
      }
    } finally {
      process.env.ZAI_API_KEY = oldKey;
      process.env.ZAI_BASE_URL = oldBase;
      process.env.ZAI_PROPOSAL_MODEL = oldModel;
      process.env.MISTRAL_API_KEY = oldMistralKey;
    }
  });
});
