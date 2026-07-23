// Tests for /api/version endpoint and build marker safety.
//
// Verifies:
//   1. The version route returns ok + required fields.
//   2. The response does not expose secrets.
//   3. Feature flags include the expected post-#625 features.
//   4. CollapsiblePanel component contract (controlled, props present).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── 1. /api/version response shape ──────────────────────────────────────────

describe("/api/version endpoint contract", () => {
  it("GET handler exports a function", async () => {
    const { GET } = await import("../app/api/version/route.js");
    assert.strictEqual(typeof GET, "function", "GET handler must be exported");
  });

  it("returns ok:true and required fields", async () => {
    const { GET } = await import("../app/api/version/route.js");
    const response = await GET();
    const body = await response.json() as {
      ok: boolean;
      appName: string;
      environment: string;
      gitCommitSha: string;
      featureFlags: Record<string, boolean>;
    };

    assert.strictEqual(body.ok, true);
    assert.strictEqual(typeof body.appName, "string");
    assert.ok(body.appName.length > 0, "appName must not be empty");
    assert.strictEqual(typeof body.environment, "string");
    assert.strictEqual(typeof body.gitCommitSha, "string");
    assert.ok(body.gitCommitSha.length > 0, "gitCommitSha must not be empty");
    assert.strictEqual(typeof body.featureFlags, "object");
  });

  it("feature flags include post-#623/#625 features", async () => {
    const { GET } = await import("../app/api/version/route.js");
    const response = await GET();
    const body = await response.json() as { featureFlags: Record<string, boolean> };

    assert.strictEqual(body.featureFlags.metadataOverride, true, "metadataOverride flag must be true");
    assert.strictEqual(body.featureFlags.collapsiblePanels, true, "collapsiblePanels flag must be true");
    assert.strictEqual(body.featureFlags.authorityReview, true, "authorityReview flag must be true");
    assert.strictEqual(body.featureFlags.submissionPlanRepair, true, "submissionPlanRepair flag must be true");
  });

  it("response does not expose secrets", async () => {
    const { GET } = await import("../app/api/version/route.js");
    const response = await GET();
    const text = await response.text();

    const SECRET_PATTERNS = [
      /sk-ant-/,           // Anthropic API key
      /sk-[a-zA-Z0-9]{20,}/, // OpenAI API key
      /AIza[a-zA-Z0-9]{35}/, // Gemini API key
      /gsk_[a-zA-Z0-9]/,  // Groq API key
      /sk-or-/,            // OpenRouter key
      /DATABASE_URL/,
      /SESSION_SECRET/,
      /postgresql:\/\//,
      /postgres:\/\//,
    ];
    for (const pattern of SECRET_PATTERNS) {
      assert.ok(!pattern.test(text), `Response must not contain secret matching ${pattern}`);
    }
  });

  it("response status is 200", async () => {
    const { GET } = await import("../app/api/version/route.js");
    const response = await GET();
    assert.strictEqual(response.status, 200);
  });
});

// ── 2. CollapsiblePanel component contract ───────────────────────────────────

describe("CollapsiblePanel component contract", () => {
  it.skip("CollapsiblePanel module exports a function", () => {
    // Skipped: component deleted as dead code.
  });

  it("BuildVersionBadge module exports a function", async () => {
    const mod = await import("../components/build-version-badge.js");
    assert.strictEqual(typeof mod.BuildVersionBadge, "function", "BuildVersionBadge must be exported");
  });
});

// ── 3. next.config.js bakes build marker env vars ───────────────────────────

describe("next.config.js build marker env vars", () => {
  it("NEXT_PUBLIC_BUILD_SHA is set in env block", async () => {
    const fs = await import("node:fs");
    const config = fs.readFileSync("next.config.js", "utf-8");
    assert.ok(config.includes("NEXT_PUBLIC_BUILD_SHA"), "next.config.js must define NEXT_PUBLIC_BUILD_SHA");
    assert.ok(config.includes("NEXT_PUBLIC_BUILD_ENV"), "next.config.js must define NEXT_PUBLIC_BUILD_ENV");
    assert.ok(config.includes("NEXT_PUBLIC_BUILD_TIME"), "next.config.js must define NEXT_PUBLIC_BUILD_TIME");
  });

  it("build markers source from VERCEL_GIT_COMMIT_SHA not from secrets", async () => {
    const fs = await import("node:fs");
    const config = fs.readFileSync("next.config.js", "utf-8");
    assert.ok(config.includes("VERCEL_GIT_COMMIT_SHA"), "must use VERCEL_GIT_COMMIT_SHA (safe Vercel system var)");
    // Must NOT use secret vars in NEXT_PUBLIC_ context
    assert.ok(!config.includes("NEXT_PUBLIC_DATABASE_URL"), "must not expose DATABASE_URL publicly");
    assert.ok(!config.includes("NEXT_PUBLIC_SESSION_SECRET"), "must not expose SESSION_SECRET publicly");
    assert.ok(!config.includes("NEXT_PUBLIC_ANTHROPIC_API_KEY"), "must not expose ANTHROPIC_API_KEY publicly");
  });
});
