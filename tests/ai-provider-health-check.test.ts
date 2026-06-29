/**
 * Tests for the AI provider health check.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

describe("AI provider health check", () => {
  const src = readFileSync("lib/ai-provider-health-check.ts", "utf8");

  it("exports checkAiProviderHealth function", () => {
    assert.ok(src.includes("export function checkAiProviderHealth"), "Must export checkAiProviderHealth");
  });

  it("returns healthy=true when at least one provider is configured", () => {
    assert.ok(src.includes("healthy: true"), "Must return healthy: true when providers configured");
  });

  it("returns healthy=false when no providers are configured", () => {
    assert.ok(src.includes("healthy: false"), "Must return healthy: false when no providers");
  });

  it("returns list of configured providers", () => {
    assert.ok(src.includes("configuredProviders"), "Must return configuredProviders list");
  });

  it("includes a human-readable message", () => {
    assert.ok(src.includes("message"), "Must return a message");
  });
});
