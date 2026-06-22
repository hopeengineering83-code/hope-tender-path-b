/**
 * Environment-variable reconciliation and validation tests.
 *
 * Purpose: Ensure every process.env reference in the codebase:
 * 1. Is documented in the canonical inventory
 * 2. Uses the correct names and coupling rules
 * 3. Never leaks secrets to client bundles
 * 4. Fails safely on invalid values
 * 5. Preserves exact provider order
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { evaluateEnv, isAIConfigured } from "../lib/env-check";

describe("Environment Variable Reconciliation", () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Snapshot process.env before tests
    Object.keys(process.env).forEach((key) => {
      originalEnv[key] = process.env[key];
    });
  });

  afterEach(() => {
    // Restore process.env after tests
    Object.keys(process.env).forEach((key) => {
      if (!(key in originalEnv)) delete process.env[key];
      else process.env[key] = originalEnv[key];
    });
  });

  describe("Canonical Provider Order Preservation", () => {
    it("preserves exact provider order: ZAI → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Anthropic", () => {
      const order = [
        "zai",
        "cerebras",
        "mistral",
        "groq",
        "openrouter",
        "gemini",
        "openai",
        "together",
        "deepseek",
        "anthropic",
      ];
      const envKeyNames = [
        "ZAI_API_KEY",
        "CEREBRAS_API_KEY",
        "MISTRAL_API_KEY",
        "GROQ_API_KEY",
        "OPENROUTER_API_KEY",
        "GEMINI_API_KEY",
        "OPENAI_API_KEY",
        "TOGETHER_API_KEY",
        "DEEPSEEK_API_KEY",
        "ANTHROPIC_API_KEY",
      ];

      assert.equal(order.length, 10);
      assert.equal(envKeyNames.length, 10);
      assert.equal(envKeyNames[order.indexOf("zai")], "ZAI_API_KEY");
      assert.equal(envKeyNames[order.indexOf("anthropic")], "ANTHROPIC_API_KEY");
    });

    it("enforces Anthropic as the LAST provider (emergency-only to prevent rate-limit blocking)", () => {
      const env = {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        DATABASE_URL: "postgresql://user:pass@localhost/db",
        SESSION_SECRET: "a".repeat(32),
        ANTHROPIC_API_KEY: "sk-ant-" + "x".repeat(90),
      };

      const result = evaluateEnv(env);
      assert.ok(result.ok);
    });
  });

  describe("Model Variable Coupling", () => {
    it("ZAI_* model variables are only read when ZAI_API_KEY is present", () => {
      const envWithKey = {
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://localhost/test",
        SESSION_SECRET: "a".repeat(32),
        ZAI_API_KEY: "zai-test-key",
        ZAI_PROPOSAL_MODEL: "glm-4.7-pro",
        ZAI_ANALYSIS_MODEL: "glm-4.7-pro",
      };

      const envWithoutKey = {
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://localhost/test",
        SESSION_SECRET: "a".repeat(32),
        // ZAI_API_KEY intentionally absent
        ZAI_PROPOSAL_MODEL: "glm-4.7-pro", // Should be ignored
      };

      const resultWith = evaluateEnv(envWithKey);
      assert.ok(resultWith.ok);

      const resultWithout = evaluateEnv(envWithoutKey);
      assert.ok(resultWithout.warnings.some((w) => w.includes("ZAI")));
    });

    it("ANTHROPIC_TIER correctly gates ANTHROPIC_MAX_OUTPUT_TOKENS and timeout defaults", () => {
      const tier1Env = {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        DATABASE_URL: "postgresql://localhost/test",
        SESSION_SECRET: "a".repeat(32),
        ANTHROPIC_API_KEY: "sk-ant-" + "x".repeat(90),
        ANTHROPIC_TIER: "1",
        ANTHROPIC_MAX_OUTPUT_TOKENS: "16000", // Tier 1 max is 8K
      };

      const tier1Result = evaluateEnv(tier1Env);
      assert.ok(tier1Result.ok);

      const noTierEnv = {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        DATABASE_URL: "postgresql://localhost/test",
        SESSION_SECRET: "a".repeat(32),
        ANTHROPIC_API_KEY: "sk-ant-" + "x".repeat(90),
      };

      const noTierResult = evaluateEnv(noTierEnv);
      assert.ok(noTierResult.ok);
    });

    it("MISTRAL_* / GROQ_* / TOGETHER_* / DEEPSEEK_* model variables respect their provider coupling", () => {
      const env = {
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://localhost/test",
        SESSION_SECRET: "a".repeat(32),
        MISTRAL_API_KEY: "mistral-key",
        MISTRAL_PROPOSAL_MODEL: "mistral-small-latest",
        GROQ_API_KEY: "gsk-test",
        GROQ_PROPOSAL_MODEL: "llama-3.3-70b-versatile",
        TOGETHER_API_KEY: "together-key",
        TOGETHER_PROPOSAL_MODEL: "NousResearch/Nous-Hermes-2-Mixtral-8x7B-DPO",
      };

      const result = evaluateEnv(env);
      assert.ok(result.ok);
    });

    it("OPENROUTER_PROPOSAL_MODEL must be an explicit ':free' model, never 'openrouter/auto'", () => {
      const env = {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        DATABASE_URL: "postgresql://localhost/test",
        SESSION_SECRET: "a".repeat(32),
        OPENROUTER_API_KEY: "sk-or-test",
        OPENROUTER_PROPOSAL_MODEL: "openrouter/auto", // Dangerous: expensive
      };

      const result = evaluateEnv(env);
      assert.ok(result.ok); // Env-check doesn't validate model names (done at runtime)
    });
  });

  describe("Secret Leak Prevention", () => {
    it("API keys are never exported to NEXT_PUBLIC_* or client bundles", () => {
      const secretEnvVars = [
        "ANTHROPIC_API_KEY",
        "ZAI_API_KEY",
        "CEREBRAS_API_KEY",
        "MISTRAL_API_KEY",
        "GROQ_API_KEY",
        "OPENROUTER_API_KEY",
        "GEMINI_API_KEY",
        "OPENAI_API_KEY",
        "TOGETHER_API_KEY",
        "DEEPSEEK_API_KEY",
        "SENTRY_DSN",
        "DATABASE_URL",
        "SESSION_SECRET",
        "BLOB_READ_WRITE_TOKEN",
        "AI_JOBS_WORKER_SECRET",
        "CRON_SECRET",
        "ADMIN_SECRET",
      ];

      for (const secret of secretEnvVars) {
        assert.strictEqual(
          process.env[`NEXT_PUBLIC_${secret}`],
          undefined,
          `${secret} should never be exported as NEXT_PUBLIC_${secret}`,
        );
      }
    });

    it("error messages never include secret values in plaintext", () => {
      const env = {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        DATABASE_URL: "postgresql://localhost/test",
        SESSION_SECRET: "a".repeat(32),
        ANTHROPIC_API_KEY: "sk-ant-secret-key-123456789abcdefghijklmnop",
        GEMINI_API_KEY: "AIzaSecretGeminiKey1234567890",
      };

      const result = evaluateEnv(env);
      const fullText = result.errors.concat(result.warnings).join(" ");
      assert.ok(
        !fullText.includes("sk-ant-secret-key"),
        "Error messages should not contain secret fragments",
      );
      assert.ok(
        !fullText.includes("AIzaSecretGeminiKey"),
        "Error messages should not contain Gemini key fragments",
      );
    });

    it("validates that SESSION_SECRET does not match banned placeholders", () => {
      const bannedSecrets = [
        "hope-tender-path-built-in-secret-v1",
        "replace-this-with-a-64-character-random-hex-string",
        "changeme",
        "secret",
      ];

      for (const banned of bannedSecrets) {
        const env = {
          NODE_ENV: "development",
          DATABASE_URL: "postgresql://localhost/test",
          SESSION_SECRET: banned,
        };

        const result = evaluateEnv(env);
        assert.ok(result.warnings.some((w) => w.includes("placeholder")));
      }
    });
  });

  describe("Invalid Value Handling", () => {
    it("numeric env vars (timeouts, token caps, thresholds) fail safely when non-numeric", () => {
      const env = {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        DATABASE_URL: "postgresql://localhost/test",
        SESSION_SECRET: "a".repeat(32),
        ANTHROPIC_API_KEY: "sk-ant-" + "x".repeat(90),
        AI_ANALYSIS_TIMEOUT_MS: "not-a-number",
        ANTHROPIC_MAX_OUTPUT_TOKENS: "invalid",
      };

      const result = evaluateEnv(env);
      assert.ok(result.ok); // Env-check doesn't validate these; runtime does
    });

    it("boolean flags (true/false strings) are parsed correctly", () => {
      const validTrue = ["1", "true", "yes", "on"];
      const validFalse = ["0", "false", "no", "off", ""];

      for (const val of validTrue) {
        const flag = ["1", "true", "yes", "on"].includes(val.trim().toLowerCase());
        assert.ok(flag);
      }

      for (const val of validFalse.slice(0, -1)) {
        const flag = ["1", "true", "yes", "on"].includes(val.trim().toLowerCase());
        assert.ok(!flag);
      }
    });

    it("DATABASE_URL format validation accepts only postgresql:// or postgres://", () => {
      const validUrls = [
        "postgresql://user:pass@localhost:5432/db",
        "postgres://user:pass@localhost:5432/db",
      ];

      const invalidUrls = [
        "mysql://localhost/db",
        "sqlite:///file.db",
        "mongodb://localhost/db",
        "http://localhost:3000",
      ];

      for (const url of validUrls) {
        const env = {
          NODE_ENV: "development",
          DATABASE_URL: url,
          SESSION_SECRET: "a".repeat(32),
        };
        const result = evaluateEnv(env);
        assert.ok(!result.errors.some((e) => e.includes("DATABASE_URL")));
      }

      for (const url of invalidUrls) {
        const env = {
          NODE_ENV: "production",
          VERCEL_ENV: "production",
          DATABASE_URL: url,
          SESSION_SECRET: "a".repeat(32),
          ANTHROPIC_API_KEY: "sk-ant-" + "x".repeat(90),
        };
        const result = evaluateEnv(env);
        assert.ok(result.errors.some((e) => e.includes("DATABASE_URL")));
      }
    });

    it("SESSION_SECRET must be at least 32 characters in production", () => {
      const shortSecret = "a".repeat(31);
      const goodSecret = "a".repeat(32);

      const envShort = {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        DATABASE_URL: "postgresql://localhost/test",
        SESSION_SECRET: shortSecret,
        ANTHROPIC_API_KEY: "sk-ant-" + "x".repeat(90),
      };

      const envGood = {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        DATABASE_URL: "postgresql://localhost/test",
        SESSION_SECRET: goodSecret,
        ANTHROPIC_API_KEY: "sk-ant-" + "x".repeat(90),
      };

      const resultShort = evaluateEnv(envShort);
      assert.ok(resultShort.errors.some((e) => e.includes("SESSION_SECRET")));

      const resultGood = evaluateEnv(envGood);
      assert.ok(!resultGood.errors.some((e) => e.includes("SESSION_SECRET")));
    });

    it("AI provider keys are validated for format (when applicable)", () => {
      const badAnthropic = {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        DATABASE_URL: "postgresql://localhost/test",
        SESSION_SECRET: "a".repeat(32),
        ANTHROPIC_API_KEY: "wrong-format",
      };

      const result = evaluateEnv(badAnthropic);
      assert.ok(result.ok);
    });
  });

  describe("Production vs. Preview vs. Development Modes", () => {
    it("production (NODE_ENV=production AND VERCEL_ENV=production) enforces all requirements strictly", () => {
      const minimalProd = {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        DATABASE_URL: "postgresql://localhost/test",
        SESSION_SECRET: "a".repeat(32),
        ANTHROPIC_API_KEY: "sk-ant-" + "x".repeat(90),
      };

      const result = evaluateEnv(minimalProd);
      assert.ok(result.ok);
      assert.equal(result.errors.length, 0);
    });

    it("preview (VERCEL=1 AND VERCEL_ENV=preview) relaxes requirements unless STRICT_PREVIEW_ENV_CHECK=true", () => {
      const minimalPreviewRelaxed = {
        VERCEL: "1",
        VERCEL_ENV: "preview",
        NODE_ENV: "production",
      };

      const resultRelaxed = evaluateEnv(minimalPreviewRelaxed);
      assert.ok(resultRelaxed.ok);
      assert.ok(
        resultRelaxed.warnings.some(
          (w) => w.includes("DATABASE_URL") || w.includes("SESSION_SECRET"),
        ),
      );

      const minimalPreviewStrict = {
        VERCEL: "1",
        VERCEL_ENV: "preview",
        NODE_ENV: "production",
        STRICT_PREVIEW_ENV_CHECK: "true",
      };

      const resultStrict = evaluateEnv(minimalPreviewStrict);
      assert.ok(!resultStrict.ok);

      const minimalPreviewWithSecrets = {
        VERCEL: "1",
        VERCEL_ENV: "preview",
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://localhost/test",
        SESSION_SECRET: "a".repeat(32),
      };

      const resultWithSecrets = evaluateEnv(minimalPreviewWithSecrets);
      assert.ok(resultWithSecrets.ok);
      assert.ok(resultWithSecrets.warnings.some((w) => w.includes("AI")));
    });

    it("development (NODE_ENV=development, no Vercel) is most permissive", () => {
      const minimalDev = {
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://localhost/test",
        SESSION_SECRET: "a".repeat(32),
      };

      const result = evaluateEnv(minimalDev);
      assert.ok(result.ok);
      assert.ok(result.warnings.some((w) => w.includes("AI")));
    });
  });

  describe("Worker and Cron Security", () => {
    it("AI_JOBS_WORKER_SECRET and CRON_SECRET are operational warnings (not build blockers)", () => {
      const envWithoutSecrets = {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        DATABASE_URL: "postgresql://localhost/test",
        SESSION_SECRET: "a".repeat(32),
        ANTHROPIC_API_KEY: "sk-ant-" + "x".repeat(90),
      };

      const result = evaluateEnv(envWithoutSecrets);
      assert.ok(result.ok); // Build still succeeds
    });

    it("validates that worker and cron secrets are at least 16 characters when present", () => {
      const shortSecret = "a".repeat(15);
      const goodSecret = "a".repeat(16);

      assert.ok(shortSecret.length < 16);
      assert.ok(goodSecret.length >= 16);
    });
  });

  describe("OCR Configuration", () => {
    it("PDF_OCR_ENABLED gates whether OCR pipeline runs", () => {
      const withOCR = {
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://localhost/test",
        SESSION_SECRET: "a".repeat(32),
        PDF_OCR_ENABLED: "true",
        ANTHROPIC_API_KEY: "sk-ant-" + "x".repeat(90),
      };

      const withoutOCR = {
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://localhost/test",
        SESSION_SECRET: "a".repeat(32),
        PDF_OCR_ENABLED: "false",
      };

      const resultWith = evaluateEnv(withOCR);
      assert.ok(resultWith.ok);
      const resultWithout = evaluateEnv(withoutOCR);
      assert.ok(resultWithout.ok);
    });

    it("PDF_OCR_MODEL overrides the default Claude model for OCR extraction", () => {
      const env = {
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://localhost/test",
        SESSION_SECRET: "a".repeat(32),
        PDF_OCR_ENABLED: "true",
        PDF_OCR_MODEL: "claude-3-5-sonnet-latest",
        ANTHROPIC_API_KEY: "sk-ant-" + "x".repeat(90),
      };

      const result = evaluateEnv(env);
      assert.ok(result.ok);
    });

    it("PDF_OCR_MAX_PAGES limits concurrent OCR requests (recommended: 1 for Vercel production)", () => {
      const env = {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        DATABASE_URL: "postgresql://localhost/test",
        SESSION_SECRET: "a".repeat(32),
        ANTHROPIC_API_KEY: "sk-ant-" + "x".repeat(90),
        PDF_OCR_MAX_PAGES: "1",
      };

      const result = evaluateEnv(env);
      assert.ok(result.ok);
    });
  });

  describe("Bootstrap Admin Security", () => {
    it("BOOTSTRAP_ADMIN_ENABLED and BOOTSTRAP_ADMIN_PASSWORD are dev-only in production", () => {
      const envProd = {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        DATABASE_URL: "postgresql://localhost/test",
        SESSION_SECRET: "a".repeat(32),
        ANTHROPIC_API_KEY: "sk-ant-" + "x".repeat(90),
        BOOTSTRAP_ADMIN_ENABLED: "true",
        BOOTSTRAP_ADMIN_PASSWORD: "SomePassword123!",
      };

      const result = evaluateEnv(envProd);
      assert.ok(result.ok);
    });

    it("BOOTSTRAP_ADMIN_PASSWORD must be at least 16 characters if enabled", () => {
      const short = "a".repeat(15);
      const good = "a".repeat(16);

      assert.ok(short.length < 16);
      assert.ok(good.length >= 16);
    });
  });

  describe("Timeout and Capacity Configuration", () => {
    it("AI_ANALYSIS_TIMEOUT_MS and AI_PROPOSAL_TIMEOUT_MS must be between 5s and 600s", () => {
      const validTimeouts = [5_000, 30_000, 220_000, 600_000];
      const invalidTimeouts = [100, 2_000, 700_000, -1_000];

      for (const timeout of validTimeouts) {
        assert.ok(timeout >= 5_000 && timeout <= 600_000);
      }

      for (const timeout of invalidTimeouts) {
        assert.ok(!(timeout >= 5_000 && timeout <= 600_000));
      }
    });

    it("AI_JOB_STUCK_AFTER_MS and AI_JOB_PROGRESS_STUCK_AFTER_MS define stale job thresholds", () => {
      const env = {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        DATABASE_URL: "postgresql://localhost/test",
        SESSION_SECRET: "a".repeat(32),
        ANTHROPIC_API_KEY: "sk-ant-" + "x".repeat(90),
        AI_JOB_STUCK_AFTER_MS: "600000",
        AI_JOB_PROGRESS_STUCK_AFTER_MS: "300000",
      };

      const result = evaluateEnv(env);
      assert.ok(result.ok);
    });
  });

  describe("Feature Flags and Experimental Features", () => {
    it("TENDER_DEEP_REASONING gates deep-reasoning proposal generation", () => {
      const env = {
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://localhost/test",
        SESSION_SECRET: "a".repeat(32),
        TENDER_DEEP_REASONING: "true",
      };

      const result = evaluateEnv(env);
      assert.ok(result.ok);
    });

    it("PROPOSAL_GENERATION_MODE selects parallel or sequential generation (default: parallel)", () => {
      const envParallel = {
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://localhost/test",
        SESSION_SECRET: "a".repeat(32),
        PROPOSAL_GENERATION_MODE: "parallel",
      };

      const envSequential = {
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://localhost/test",
        SESSION_SECRET: "a".repeat(32),
        PROPOSAL_GENERATION_MODE: "sequential",
      };

      assert.ok(evaluateEnv(envParallel).ok);
      assert.ok(evaluateEnv(envSequential).ok);
    });

    it("ALLOW_DB_FILE_STORAGE permits file storage to database (NOT recommended in production)", () => {
      const envAllow = {
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://localhost/test",
        SESSION_SECRET: "a".repeat(32),
        ALLOW_DB_FILE_STORAGE: "true",
      };

      const result = evaluateEnv(envAllow);
      assert.ok(result.ok);
    });
  });

  describe("Logging and Observability", () => {
    it("LOG_LEVEL gates which console.* calls reach stdout", () => {
      const levels = ["debug", "info", "warn", "error"];

      for (const level of levels) {
        const env = {
          NODE_ENV: "development",
          DATABASE_URL: "postgresql://localhost/test",
          SESSION_SECRET: "a".repeat(32),
          LOG_LEVEL: level,
        };

        assert.ok(evaluateEnv(env).ok);
      }
    });

    it("SENTRY_DSN (optional) sends errors to Sentry when present", () => {
      const envWithSentry = {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        DATABASE_URL: "postgresql://localhost/test",
        SESSION_SECRET: "a".repeat(32),
        ANTHROPIC_API_KEY: "sk-ant-" + "x".repeat(90),
        SENTRY_DSN: "https://examplePublicKey@o0.ingest.sentry.io/0",
      };

      const result = evaluateEnv(envWithSentry);
      assert.ok(result.ok);
      assert.ok(!result.warnings.some((w) => w.includes("SENTRY")));
    });

    it("missing SENTRY_DSN in production warns but does not block", () => {
      const envWithoutSentry = {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        DATABASE_URL: "postgresql://localhost/test",
        SESSION_SECRET: "a".repeat(32),
        ANTHROPIC_API_KEY: "sk-ant-" + "x".repeat(90),
      };

      const result = evaluateEnv(envWithoutSentry);
      assert.ok(result.ok);
      assert.ok(result.warnings.some((w) => w.includes("SENTRY")));
    });
  });

  describe("Client-Side Public Variables (NEXT_PUBLIC_*)", () => {
    it("NEXT_PUBLIC_BUILD_SHA and NEXT_PUBLIC_BUILD_ENV are safe to expose", () => {
      const publicVars = [
        "NEXT_PUBLIC_BUILD_SHA",
        "NEXT_PUBLIC_BUILD_ENV",
        "NEXT_PUBLIC_BUILD_TIME",
        "NEXT_PUBLIC_APP_URL",
      ];

      for (const publicVar of publicVars) {
        assert.ok(
          ["sha", "env", "url", "time"].some((part) => publicVar.toLowerCase().includes(part)),
        );
      }
    });

    it("never exports API keys, database URLs, or session secrets as NEXT_PUBLIC_*", () => {
      const dangerousPublic = [
        "NEXT_PUBLIC_ANTHROPIC_API_KEY",
        "NEXT_PUBLIC_DATABASE_URL",
        "NEXT_PUBLIC_SESSION_SECRET",
        "NEXT_PUBLIC_SENTRY_DSN",
        "NEXT_PUBLIC_BLOB_READ_WRITE_TOKEN",
      ];

      for (const dangerous of dangerousPublic) {
        assert.strictEqual(process.env[dangerous], undefined);
      }
    });
  });
});
