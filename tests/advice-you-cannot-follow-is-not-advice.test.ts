import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { testAutomaticChainCapabilities } from "../lib/ai-provider-capability-test";
import { CANONICAL_AI_PROVIDER_ORDER } from "../lib/ai-provider-registry";

/**
 * THE DEFECT, read off run 34778938488.
 * -------------------------------------
 * The live chain test is ten real, serial round-trips inside a 60s route. Z.ai
 * timed out after 45s, and six providers were never contacted:
 *
 *   NOT TESTED: cerebras -- Not tested — the diagnostic reached its request
 *   time limit before this provider was contacted. This is not a provider
 *   result; re-run the test for this provider on its own.
 *
 * That message is correct and well-written, and there was no way to do what it
 * says: the route took a `capability` filter and no `provider` filter. The two
 * providers under investigation (openai, deepseek) sat behind the timeout and
 * could not be reached at all.
 *
 * These tests use an env with no provider keys, so nothing here performs a
 * network call: what is pinned is WHICH providers the run selects, which is
 * the part that was missing.
 */

const NO_KEYS: NodeJS.ProcessEnv = { NODE_ENV: "test" };

describe("the chain test can be pointed at one provider", () => {
  it("selects only the providers named", async () => {
    const run = await testAutomaticChainCapabilities({
      env: NO_KEYS,
      capabilities: ["connectivity"],
      onlyProviders: ["openai", "deepseek"],
    });
    const seen = run.reports.map((r) => r.provider);
    assert.deepEqual([...seen].sort(), ["deepseek", "openai"]);
  });

  it("keeps canonical chain order however the names are given", async () => {
    // deepseek sits after openai in the canonical chain; asking in the other
    // order must not reorder the run.
    const run = await testAutomaticChainCapabilities({
      env: NO_KEYS,
      capabilities: ["connectivity"],
      onlyProviders: ["deepseek", "openai"],
    });
    const seen = run.reports.map((r) => r.provider);
    const canonical = CANONICAL_AI_PROVIDER_ORDER.filter((p) => seen.includes(p));
    assert.deepEqual(seen, canonical);
  });

  it("is case and whitespace tolerant, because operators type these by hand", async () => {
    const run = await testAutomaticChainCapabilities({
      env: NO_KEYS,
      capabilities: ["connectivity"],
      onlyProviders: [" OpenAI ", "DeepSeek"],
    });
    assert.deepEqual([...run.reports.map((r) => r.provider)].sort(), ["deepseek", "openai"]);
  });

  it("selects nothing for an unknown name rather than silently widening the run", async () => {
    // Fail closed: a typo must not quietly become "test everything", which is
    // the run that could not fit in the budget in the first place.
    const run = await testAutomaticChainCapabilities({
      env: NO_KEYS,
      capabilities: ["connectivity"],
      onlyProviders: ["not-a-provider"],
    });
    assert.equal(run.reports.length, 0);
  });

  it("runs the whole chain when no filter is given", async () => {
    const filtered = await testAutomaticChainCapabilities({
      env: NO_KEYS,
      capabilities: ["connectivity"],
      onlyProviders: ["openai"],
    });
    const all = await testAutomaticChainCapabilities({ env: NO_KEYS, capabilities: ["connectivity"] });
    assert.equal(filtered.reports.length, 1);
    assert.ok(all.reports.length > filtered.reports.length, "the unfiltered run must still cover the chain");
  });

  it("treats an empty filter as no filter", async () => {
    const empty = await testAutomaticChainCapabilities({
      env: NO_KEYS,
      capabilities: ["connectivity"],
      onlyProviders: [],
    });
    const all = await testAutomaticChainCapabilities({ env: NO_KEYS, capabilities: ["connectivity"] });
    assert.equal(empty.reports.length, all.reports.length);
  });
});
