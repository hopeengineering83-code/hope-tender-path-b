// Env validation policy alignment tests (Gap 5).
//
// The runtime env-check (lib/env-check.ts) and the build-time check
// (scripts/check-env.mjs) must agree:
//   - production requires DATABASE_URL, SESSION_SECRET, and two eligible
//     zero-paid AI providers
//   - SESSION_SECRET must be ≥32 chars in production
//   - DATABASE_URL must start with postgresql:// or postgres://
//   - preview deployments warn unless STRICT_PREVIEW_ENV_CHECK=true
//   - development always warns, never throws on AI-key absence

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { evaluateEnv } from "../lib/env-check";

const STRONG_SECRET = "x".repeat(40);

function baseEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://app:pw@db.example.com/app",
    SESSION_SECRET: STRONG_SECRET,
    GEMINI_API_KEY: "AIzaFakeKey1234567890123456789012345678901",
    MISTRAL_API_KEY: "mistral-test",
    ...overrides,
  };
}

describe("evaluateEnv — production policy", () => {
  it("ok=true with DATABASE_URL + SESSION_SECRET + two free providers", () => {
    const r = evaluateEnv(baseEnv());
    assert.equal(r.ok, true, r.errors.join("; "));
  });

  it("fails when free provider redundancy is missing", () => {
    const r = evaluateEnv(baseEnv({ GEMINI_API_KEY: undefined, MISTRAL_API_KEY: undefined }));
    assert.equal(r.ok, false);
    assert.match(r.errors.join("\n"), /AI provider key/i);
  });

  it("rejects a paid-only Anthropic configuration", () => {
    const r = evaluateEnv(baseEnv({ GEMINI_API_KEY: undefined, MISTRAL_API_KEY: undefined, ANTHROPIC_API_KEY: "sk-ant-test" }));
    assert.equal(r.ok, false);
  });

  it("fails when DATABASE_URL is missing", () => {
    const r = evaluateEnv(baseEnv({ DATABASE_URL: undefined }));
    assert.equal(r.ok, false);
    assert.match(r.errors.join("\n"), /DATABASE_URL/);
  });

  it("fails when DATABASE_URL has the wrong scheme", () => {
    const r = evaluateEnv(baseEnv({ DATABASE_URL: "sqlite://./dev.db" }));
    assert.equal(r.ok, false);
    assert.match(r.errors.join("\n"), /postgresql:\/\//);
  });

  it("fails when SESSION_SECRET is missing", () => {
    const r = evaluateEnv(baseEnv({ SESSION_SECRET: undefined }));
    assert.equal(r.ok, false);
    assert.match(r.errors.join("\n"), /SESSION_SECRET/);
  });

  it("fails when SESSION_SECRET is shorter than 32 chars in production", () => {
    const r = evaluateEnv(baseEnv({ SESSION_SECRET: "tooShort" }));
    assert.equal(r.ok, false);
    assert.match(r.errors.join("\n"), /SESSION_SECRET/);
  });

  it("fails when SESSION_SECRET is a banned placeholder in production", () => {
    const r = evaluateEnv(baseEnv({ SESSION_SECRET: "replace-this-with-a-64-character-random-hex-string" }));
    assert.equal(r.ok, false);
    assert.match(r.errors.join("\n"), /banned/);
  });
});

describe("evaluateEnv — preview policy", () => {
  it("warns (does not throw) when AI key missing on preview without strict flag", () => {
    const r = evaluateEnv({
      NODE_ENV: "production",
      VERCEL: "1",
      VERCEL_ENV: "preview",
      DATABASE_URL: "postgresql://app:pw@db/app",
      SESSION_SECRET: STRONG_SECRET,
    });
    assert.equal(r.ok, true, r.errors.join("; "));
    assert.match(r.warnings.join("\n"), /AI provider key/i);
  });

  it("fails when STRICT_PREVIEW_ENV_CHECK=true on preview and AI key missing", () => {
    const r = evaluateEnv({
      NODE_ENV: "production",
      VERCEL: "1",
      VERCEL_ENV: "preview",
      STRICT_PREVIEW_ENV_CHECK: "true",
      DATABASE_URL: "postgresql://app:pw@db/app",
      SESSION_SECRET: STRONG_SECRET,
    });
    assert.equal(r.ok, false);
    assert.match(r.errors.join("\n"), /AI provider key/i);
  });
});

describe("evaluateEnv — development policy", () => {
  it("ok=true when AI key is missing in development", () => {
    const r = evaluateEnv({
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://app:pw@db/app",
      SESSION_SECRET: STRONG_SECRET,
    });
    assert.equal(r.ok, true, r.errors.join("; "));
    assert.match(r.warnings.join("\n"), /AI provider key/i);
  });

  it("warns (does not throw) when SESSION_SECRET is short in development", () => {
    const r = evaluateEnv({
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://app:pw@db/app",
      SESSION_SECRET: "shortpw",
      GEMINI_API_KEY: "AIzaFakeKey1234567890123456789012345678901",
    });
    assert.equal(r.ok, true);
    assert.match(r.warnings.join("\n"), /SESSION_SECRET/);
  });
});

describe("check-env.mjs operational warnings (Gap 5 — non-blocking)", () => {
  it("AI_JOBS_WORKER_SECRET and CRON_SECRET are NOT marked PRODUCTION_REQUIRED", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(new URL("../scripts/check-env.mjs", import.meta.url), "utf8");
    // The list is named OPERATIONAL_WARNINGS — never elevated to errors.
    assert.match(src, /OPERATIONAL_WARNINGS/);
    assert.match(src, /AI_JOBS_WORKER_SECRET/);
    assert.match(src, /CRON_SECRET/);
  });

  it("check-env.mjs aligns AI-key requirement with env-check.ts", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(new URL("../scripts/check-env.mjs", import.meta.url), "utf8");
    assert.match(src, /AI_PROVIDER_KEYS/);
    // Production push to errors[] for missing AI key.
    assert.match(src, /errors\.push.*AI_PROVIDER_KEYS/);
  });
});
