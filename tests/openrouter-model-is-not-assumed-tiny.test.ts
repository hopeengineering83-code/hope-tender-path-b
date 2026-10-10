/**
 * A configured OpenRouter model must be judged by what it actually is.
 *
 * The OpenRouter family table held exactly one rule, matching `:free`.
 * Everything else — every paid model, and every free one written without the
 * suffix — fell through to the 8K conservative profile, so an operator who
 * configured OpenRouter with a 200K-context model got a provider that preflight
 * skipped for any real tender prompt, permanently, reporting "Prompt exceeds
 * the configured model context budget". The account was fine; the app's own
 * idea of the model was what made the provider impossible.
 *
 * That single `:free` rule also encoded, as capability data, the free-only
 * routing policy the provider contract forbids: the only OpenRouter model the
 * app could believe in was a free one.
 *
 * OpenRouter is a router. `anthropic/claude-3.5-sonnet` is Anthropic's model
 * reached by a different road, so it is resolved through the family rules that
 * already describe that model — no second table of limits, which is the drift
 * this module exists to prevent.
 *
 * Nothing here asserts that any particular model is configured. What is pinned
 * is that a known family is recognised as itself.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { resolveModelProfile } from "../lib/ai-model-profiles";

const or = (model: string) => resolveModelProfile("openrouter", model);

describe("an OpenRouter identity resolves to the model it routes to", () => {
  it("recognises large-context vendor models instead of capping them at 8K", () => {
    for (const [model, atLeast] of [
      ["anthropic/claude-3.5-sonnet", 200_000],
      ["openai/gpt-4o", 128_000],
      ["google/gemini-2.0-flash-exp", 1_000_000],
      ["mistralai/mistral-small-latest", 131_072],
      ["meta-llama/llama-3.3-70b-instruct", 131_072],
      ["z-ai/glm-4.5-air", 128_000],
      ["deepseek/deepseek-chat", 65_536],
    ] as const) {
      const profile = or(model);
      assert.equal(profile.source, "family", `${model} must be recognised, not treated as unknown`);
      assert.equal(
        profile.contextTokens,
        atLeast,
        `${model} must carry its real context window`,
      );
    }
  });

  it("does not let one vendor's deployment limits answer for another's model", () => {
    // Groq publishes `^llama-3` at its own 8K deployment limit and a DeepSeek
    // distillation at 32K. A first-match scan across vendors let those answer
    // for OpenRouter's Llama 3.3 70B and DeepSeek Chat, which are 131K and 64K.
    assert.equal(or("meta-llama/llama-3.3-70b-instruct").contextTokens, 131_072);
    assert.equal(or("deepseek/deepseek-chat").contextTokens, 65_536);
  });

  it("still caps the free variants OpenRouter genuinely reduces", () => {
    const free = or("deepseek/deepseek-chat-v3.1:free");
    assert.equal(free.contextTokens, 32_768, "a :free variant is not the full endpoint");
    assert.equal(free.maxOutputTokens, 4_096);

    // The ceiling is a cap on the real family limit, not a replacement for it:
    // a small-context model does not gain context by being free.
    const paid = or("deepseek/deepseek-chat");
    assert.ok(paid.contextTokens > free.contextTokens);
  });

  it("does not apply a vendor's own free-tier throughput ceiling to OpenRouter", () => {
    // Groq's TPM ceiling is a fact about a Groq plan. The same model reached
    // through OpenRouter is metered by OpenRouter, so carrying that ceiling
    // across would skip a provider for a limit that does not apply to it.
    assert.equal(or("qwen/qwen-2.5-72b-instruct").freeTierTpmLimit, null);
    assert.equal(or("meta-llama/llama-3.3-70b-instruct").freeTierTpmLimit, null);
  });

  it("still treats a genuinely unknown model conservatively", () => {
    // Underestimating an unrecognised model costs one skipped provider;
    // overestimating costs a hard context-overflow failure and a consumed
    // attempt. The safe direction is unchanged for anything not recognised.
    const unknown = or("some-vendor/unknown-model-9000");
    assert.equal(unknown.source, "conservative");
    assert.equal(unknown.contextTokens, 8_192);
  });

  it("carries no free-only routing policy in its capability data", () => {
    // A paid identity must be as resolvable as a free one. The provider
    // contract forbids free-only modes, mandatory :free models, and
    // paid-provider exclusion; capability data must not reintroduce any of
    // them by being unable to describe a paid model.
    const paid = or("anthropic/claude-3.5-sonnet");
    assert.equal(paid.source, "family");
    assert.ok(paid.contextTokens > 8_192);
  });
});

describe("a paid plan's throughput can be stated", () => {
  const { resolveActiveModelProfile } = require("../lib/ai-model-profiles");

  const env = (extra: Record<string, string>) => ({
    GROQ_API_KEY: "k",
    ...extra,
  }) as unknown as NodeJS.ProcessEnv;

  it("keeps the conservative free-tier ceiling by default", () => {
    // The default must not change: an operator who sets nothing keeps exactly
    // the behaviour that protects a free key from a guaranteed 429.
    const profile = resolveActiveModelProfile("groq", "proposal", env({}));
    assert.ok(
      profile.freeTierTpmLimit === null || profile.freeTierTpmLimit > 0,
      "the free-tier ceiling is unchanged unless an operator states otherwise",
    );
  });

  it("honours a stated ceiling", () => {
    const profile = resolveActiveModelProfile("groq", "proposal", env({ GROQ_TPM_LIMIT: "300000" }));
    assert.equal(profile.freeTierTpmLimit, 300_000);
  });

  it("treats zero as no binding ceiling", () => {
    const profile = resolveActiveModelProfile("groq", "proposal", env({ GROQ_TPM_LIMIT: "0" }));
    assert.equal(profile.freeTierTpmLimit, null);
  });

  it("ignores nonsense rather than trusting it", () => {
    for (const value of ["", "   ", "abc", "-5"]) {
      const stated = resolveActiveModelProfile("groq", "proposal", env({ GROQ_TPM_LIMIT: value }));
      const base = resolveActiveModelProfile("groq", "proposal", env({}));
      assert.equal(
        stated.freeTierTpmLimit,
        base.freeTierTpmLimit,
        `"${value}" must not change the ceiling`,
      );
    }
  });
});
