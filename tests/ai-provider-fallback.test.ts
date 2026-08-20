// AI provider fallback chain tests.
//
// Verifies that the multi-provider fallback chain (Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Claude)
// behaves correctly under various failure modes, and that env-check logic
// accepts any single provider key as sufficient.

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";

import { evaluateEnv } from "../lib/env-check";

// ─── Env-check: provider key coverage ────────────────────────────────────────

const STRONG_SECRET = "x".repeat(40);
const BASE_DB = "postgresql://app:pw@db.example.com/app";

function prodEnv(aiOverrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    NODE_ENV: "production",
    DATABASE_URL: BASE_DB,
    SESSION_SECRET: STRONG_SECRET,
    ...aiOverrides,
  };
}

describe("evaluateEnv — 8-provider coverage", () => {
  it("passes when only ANTHROPIC_API_KEY is set", () => {
    const r = evaluateEnv(prodEnv({ ANTHROPIC_API_KEY: "sk-ant-test" }));
    assert.equal(r.ok, true, r.errors.join("; "));
  });

  it("passes when only GEMINI_API_KEY is set", () => {
    const r = evaluateEnv(prodEnv({ GEMINI_API_KEY: "AIzaFakeKey1234567890123456789012345678901" }));
    assert.equal(r.ok, true, r.errors.join("; "));
  });

  it("passes when only OPENAI_API_KEY is set", () => {
    const r = evaluateEnv(prodEnv({ OPENAI_API_KEY: "sk-openai-test" }));
    assert.equal(r.ok, true, r.errors.join("; "));
  });

  it("passes when only DEEPSEEK_API_KEY is set", () => {
    const r = evaluateEnv(prodEnv({ DEEPSEEK_API_KEY: "dsk-test-key" }));
    assert.equal(r.ok, true, r.errors.join("; "));
  });

  it("fails when no AI provider key is set in production", () => {
    const r = evaluateEnv(prodEnv());
    assert.equal(r.ok, false);
    assert.match(r.errors.join("\n"), /AI provider key/i);
  });

  it("passes when multiple AI keys are set", () => {
    const r = evaluateEnv(prodEnv({
      ANTHROPIC_API_KEY: "sk-ant-test",
      OPENAI_API_KEY: "sk-openai-test",
      DEEPSEEK_API_KEY: "dsk-test",
    }));
    assert.equal(r.ok, true, r.errors.join("; "));
  });
});

// ─── isAIEnabled() / isAIConfigured() ────────────────────────────────────────
// These tests mock process.env directly and restore it after each test.

// These two used to assert that a DeepSeek-only or OpenAI-only environment
// counted as "AI configured". Both providers require paid access, so on this
// deployment neither can be contacted — and reporting AI as configured when the
// automatic chain has nothing to call is precisely the misreport that made
// every AI feature fail with "providers exhausted" instead of "none usable".
// They now assert the corrected meaning: configured means REACHABLE.
describe("isAIConfigured — reachability, not key presence", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore original env
    for (const key of ["ANTHROPIC_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY", "MISTRAL_API_KEY", "DEEPSEEK_API_KEY", "GROQ_API_KEY", "TOGETHER_API_KEY", "OPENROUTER_API_KEY", "ZAI_API_KEY", "CEREBRAS_API_KEY"]) {
      if (key in originalEnv) {
        process.env[key] = originalEnv[key as keyof typeof originalEnv] as string;
      } else {
        delete process.env[key];
      }
    }
  });

  it("returns FALSE when only DEEPSEEK_API_KEY is set — DeepSeek requires paid access", async () => {
    // "only" has to mean only — clear Z.ai and Cerebras too, or the case the
    // name describes is not the case being exercised.
    delete process.env.ZAI_API_KEY;
    delete process.env.CEREBRAS_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.MISTRAL_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.TOGETHER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    process.env.DEEPSEEK_API_KEY = "dsk-test-key";
    // isAIConfigured reads env at call time, so a cached module is fine.
    const { isAIConfigured, hasOnlyUnreachableProviderKeys } = await import("../lib/env-check");
    assert.equal(isAIConfigured(), false);
    assert.equal(hasOnlyUnreachableProviderKeys(), true, "the operator must be told the key is present but unusable");
  });

  it("returns FALSE when only OPENAI_API_KEY is set — OpenAI requires paid access", async () => {
    delete process.env.ZAI_API_KEY;
    delete process.env.CEREBRAS_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.MISTRAL_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.TOGETHER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    process.env.OPENAI_API_KEY = "sk-openai-test";
    const { isAIConfigured, hasOnlyUnreachableProviderKeys } = await import("../lib/env-check");
    assert.equal(isAIConfigured(), false);
    assert.equal(hasOnlyUnreachableProviderKeys(), true);
  });

  it("returns TRUE when a free provider is set", async () => {
    // The positive case, which is what "AI configured" has to mean for the
    // answer to be useful: a provider the chain may actually contact.
    for (const key of ["ZAI_API_KEY", "CEREBRAS_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "MISTRAL_API_KEY", "DEEPSEEK_API_KEY", "TOGETHER_API_KEY", "OPENROUTER_API_KEY", "OPENAI_API_KEY"]) {
      delete process.env[key];
    }
    process.env.GROQ_API_KEY = "gsk-test-key";
    const { isAIConfigured, hasOnlyUnreachableProviderKeys } = await import("../lib/env-check");
    assert.equal(isAIConfigured(), true);
    assert.equal(hasOnlyUnreachableProviderKeys(), false);
  });

  it("returns false when no AI provider is set", async () => {
    // Must clear ALL TEN providers in the canonical order, not the original
    // eight: this test predates Z.ai and Cerebras, and leaving either set made
    // the assertion depend on which key the surrounding environment happened to
    // export. CI exports GEMINI_API_KEY, which this list did delete, so the gap
    // stayed invisible there while the same test failed under a ZAI_API_KEY or
    // CEREBRAS_API_KEY environment.
    delete process.env.ZAI_API_KEY;
    delete process.env.CEREBRAS_API_KEY;
    delete process.env.MISTRAL_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.TOGETHER_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const { isAIConfigured } = await import("../lib/env-check");
    // isAIConfigured reads from process.env at call time
    assert.equal(isAIConfigured(), false);
  });

  it("returns TRUE when ONLY ZAI is set (Z.ai is now automatic rank 1)", async () => {
    // Delete ALL other provider keys
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.CEREBRAS_API_KEY;
    delete process.env.MISTRAL_API_KEY;
    delete process.env.TOGETHER_API_KEY;
    // Set ONLY ZAI — it is now automatic rank 1
    process.env.ZAI_API_KEY = "zai-test-key";
    const { isAIConfigured } = await import("../lib/env-check");
    assert.equal(isAIConfigured(), true, "Z.ai is automatic rank 1 and MUST satisfy isAIConfigured");
  });

  it("returns TRUE when ANY of the 10 providers is set", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ZAI_API_KEY;
    delete process.env.CEREBRAS_API_KEY;
    delete process.env.TOGETHER_API_KEY;
    process.env.MISTRAL_API_KEY = "mistral-test-key";
    const { isAIConfigured } = await import("../lib/env-check");
    assert.equal(isAIConfigured(), true, "Mistral is automatic rank 3 and MUST satisfy isAIConfigured");
  });
});

// ─── Error sanitisation: no secret leakage ───────────────────────────────────

describe("provider error sanitization", () => {
  it("DeepSeek key value is not leaked in sanitized error strings", () => {
    const fakeKey = "sk-deepseek-fake-secret-value-1234567890";
    const rawError = `{"error": "invalid_api_key", "key": "${fakeKey}"}`;
    const sanitized = rawError.replace(/sk-[^\s"']{8,}/g, "[REDACTED]");
    assert.ok(!sanitized.includes(fakeKey), "Raw key must not appear in sanitized output");
    assert.ok(sanitized.includes("[REDACTED]"), "REDACTED placeholder must appear");
  });

  it("Anthropic key value is redacted by sanitizer before logging", () => {
    const fakeKey = "sk-ant-api03-real-key-value-abcdefghijklmnop1234567890ABCDEF";
    // Simulate raw error that inadvertently contains the key
    const rawError = `Auth error: ${fakeKey}`;
    assert.ok(rawError.includes("sk-ant-api03"), "Raw error contains the key (pre-sanitization)");
    // After sanitization, key must be gone
    const sanitized = rawError.replace(/sk-ant-[^\s"'(]{8,}/g, "[REDACTED]");
    assert.ok(!sanitized.includes("sk-ant-api03"), "Key must not appear after sanitization");
    assert.ok(sanitized.includes("[REDACTED]"), "REDACTED placeholder must appear");
  });
});

// ─── env-check.ts: preview mode with DeepSeek only ───────────────────────────

describe("evaluateEnv — preview + DeepSeek only", () => {
  it("warns (does not error) in preview when only DEEPSEEK_API_KEY is set and strict=false", () => {
    const r = evaluateEnv({
      NODE_ENV: "production",
      VERCEL: "1",
      VERCEL_ENV: "preview",
      DATABASE_URL: BASE_DB,
      SESSION_SECRET: STRONG_SECRET,
      DEEPSEEK_API_KEY: "dsk-test",
    });
    assert.equal(r.ok, true, r.errors.join("; "));
  });
});

// ─── check-env.mjs alignment ─────────────────────────────────────────────────

describe("check-env.mjs — 10-provider automatic policy alignment", () => {
  it("includes all provider keys in the env-check descriptions (all 10 providers documented)", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(new URL("../scripts/check-env.mjs", import.meta.url), "utf8");
    for (const key of ["GEMINI_API_KEY", "GROQ_API_KEY", "MISTRAL_API_KEY", "ZAI_API_KEY", "OPENROUTER_API_KEY", "CEREBRAS_API_KEY", "OPENAI_API_KEY", "TOGETHER_API_KEY", "DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY"]) {
      assert.match(src, new RegExp(key));
    }
  });

  it("uses AI_PROVIDER_API_KEY_ENVS for hasAnyAIKey check (all 10 providers)", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(new URL("../scripts/check-env.mjs", import.meta.url), "utf8");
    // check-env.mjs uses AI_PROVIDER_API_KEY_ENVS (all 10 providers) for the
    // hasAnyAIKey check. All providers are now automatic.
    assert.match(src, /AI_PROVIDER_API_KEY_ENVS/);
    assert.match(src, /hasAnyAIKey/);
    // The catalog has all 10 providers in canonical order.
    const { AI_PROVIDER_API_KEY_ENVS } = await import("../lib/ai-provider-catalog.cjs");
    assert.deepEqual(AI_PROVIDER_API_KEY_ENVS, [
      "GEMINI_API_KEY", "GROQ_API_KEY", "MISTRAL_API_KEY", "ZAI_API_KEY", "OPENROUTER_API_KEY",
      "CEREBRAS_API_KEY", "OPENAI_API_KEY", "TOGETHER_API_KEY", "DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY",
    ]);
  });

  it("production error message is generated from AI_PROVIDER_KEYS (references all keys)", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(new URL("../scripts/check-env.mjs", import.meta.url), "utf8");
    assert.match(src, /AI_PROVIDER_KEYS_CHECK\.map\(\(k\) => k\.name\)\.join/);
  });
});

// ─── AIEnvironmentReadiness — 8-provider chain ───────────────────────────────

describe("getAIEnvironmentReadiness — DeepSeek support", () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    for (const key of ["ANTHROPIC_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY", "MISTRAL_API_KEY", "DEEPSEEK_API_KEY", "GROQ_API_KEY", "TOGETHER_API_KEY", "OPENROUTER_API_KEY"]) {
      if (key in savedEnv) {
        process.env[key] = savedEnv[key as keyof typeof savedEnv] as string;
      } else {
        delete process.env[key];
      }
    }
  });

  it("includes DeepSeek in providerChain when DEEPSEEK_API_KEY is set", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.DEEPSEEK_API_KEY = "dsk-test";
    const { getAIEnvironmentReadiness } = await import("../lib/ai-environment-readiness");
    const result = getAIEnvironmentReadiness();
    assert.ok(result.providerChain.some((p) => p.toLowerCase().includes("deepseek")), "DeepSeek must appear in providerChain");
  });

  it("no blockers when only DEEPSEEK_API_KEY is set and DB/session configured", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.DEEPSEEK_API_KEY = "dsk-test";
    process.env.DATABASE_URL = BASE_DB;
    process.env.SESSION_SECRET = STRONG_SECRET;
    const { getAIEnvironmentReadiness } = await import("../lib/ai-environment-readiness");
    const result = getAIEnvironmentReadiness();
    assert.ok(!result.blockers.some((b) => b.includes("No AI provider")), `Unexpected AI blocker: ${result.blockers.join("; ")}`);
  });

  it("returns DEEPSEEK_API_KEY as a variable entry", async () => {
    const { getAIEnvironmentReadiness } = await import("../lib/ai-environment-readiness");
    const result = getAIEnvironmentReadiness();
    const deepSeekVar = result.variables.find((v) => v.name === "DEEPSEEK_API_KEY");
    assert.ok(deepSeekVar, "DEEPSEEK_API_KEY must appear in variables list");
  });

  it("response contains no raw API key values", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-deepseek-real-secret-value-never-expose";
    const { getAIEnvironmentReadiness } = await import("../lib/ai-environment-readiness");
    const result = getAIEnvironmentReadiness();
    const json = JSON.stringify(result);
    assert.ok(!json.includes("sk-deepseek-real-secret-value-never-expose"), "Raw key must not appear in response");
  });
});
