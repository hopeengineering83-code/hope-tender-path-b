import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveModelProfile } from "../lib/ai-model-profiles";
import { preflightProvider } from "../lib/ai-preflight";

/**
 * THE DEFECT, read off durable AiJob 01b06b0f.
 * --------------------------------------------
 * That AI Analyze contacted ZERO of ten configured providers:
 *
 *   Contacted 0 of 10 configured provider(s) for use-case "extraction" and
 *   none succeeded (tried: none — all skipped).
 *     cerebras: Prompt exceeds the configured model context budget (7242 input tokens).
 *     together: Prompt exceeds the configured model context budget (7242 input tokens).
 *
 * 7,242 tokens is a small request. Nothing in the chain has a context window
 * that low — but an UNRECOGNISED model does, because CONSERVATIVE_PROFILE
 * describes it as an 8K model, and 8K minus an extraction output floor and a
 * safety margin leaves less than 7,242. Cerebras is configured with
 * `qwen-3.8-27b` and carries exactly one family rule, `^(gpt-oss|llama)`.
 * Nothing matched, so a capable provider was refused before contact on every
 * run, for every real tender, behind a message that reads like a genuine
 * provider limit.
 *
 * The answer was already in the same file. OpenRouter identities are resolved
 * by matching the model against EVERY provider's families, because a model
 * family is a property of the model, not of the road taken to reach it. That
 * comment names the consequence of not doing it — "the configuration, not the
 * account, was what made the provider impossible" — which is precisely what
 * happened to Cerebras. The scan was simply never reached by the other nine.
 *
 * A cross-vendor match is weaker evidence than a provider's own rule, so it is
 * consulted only after that rule misses, and it must never carry another
 * vendor's free-tier throughput ceiling.
 */

/** The exact input size the live job was refused at. */
const LIVE_PROMPT = "x".repeat(7242 * 4);

describe("an unknown model must not become an 8K model", () => {
  it("the live refusal no longer happens: cerebras/qwen fits the request it was skipped for", () => {
    const before = 8_192; // what CONSERVATIVE_PROFILE claimed
    const profile = resolveModelProfile("cerebras", "qwen-3.8-27b");
    assert.equal(profile.source, "family-cross-vendor");
    assert.ok(
      profile.contextTokens > before,
      `qwen must not be described as a ${before}-token model; got ${profile.contextTokens}`,
    );

    const preflight = preflightProvider("cerebras", LIVE_PROMPT, {
      useCase: "extraction",
      modelOverride: "qwen-3.8-27b",
    });
    assert.equal(preflight.eligible, true);
    assert.equal(preflight.reason, "OK");
  });

  it("a provider's OWN rule always wins over another vendor's", () => {
    // cerebras lists ^(gpt-oss|llama) at 128K. Groq also describes a llama
    // family, at its own 8K deployment limit. The provider's own rule is the
    // better evidence and must not be displaced.
    const profile = resolveModelProfile("cerebras", "llama-3.3-70b");
    assert.equal(profile.source, "family");
    assert.equal(profile.contextTokens, 128_000);
  });

  it("another vendor's free-tier throughput ceiling is never inherited", () => {
    // Groq's qwen rule carries freeTierTpmLimit 6,000 — a fact about Groq's
    // account, not about every deployment of the qwen family.
    const profile = resolveModelProfile("cerebras", "qwen-3.8-27b");
    assert.equal(profile.source, "family-cross-vendor");
    assert.equal(
      profile.freeTierTpmLimit,
      null,
      "a cross-vendor match must not import the matching vendor's TPM ceiling",
    );
  });

  it("every provider's own resolution is unchanged", () => {
    const unchanged: Array<[Parameters<typeof resolveModelProfile>[0], string, number]> = [
      ["gemini", "gemini-3.5-flash", 1_000_000],
      ["groq", "openai/gpt-oss-120b", 131_072],
      ["mistral", "mistral-small-latest", 131_072],
      ["zai", "glm-4.7-flash", 128_000],
      ["openai", "gpt-4o", 128_000],
      ["together", "meta-llama/Llama-3.3-70B-Instruct-Turbo", 131_072],
      ["deepseek", "deepseek-chat", 65_536],
      ["anthropic", "claude-sonnet-4-5", 200_000],
    ];
    for (const [provider, model, contextTokens] of unchanged) {
      const profile = resolveModelProfile(provider, model);
      assert.equal(profile.source, "family", `${provider}/${model} must still match its own rule`);
      assert.equal(profile.contextTokens, contextTokens, `${provider}/${model} context changed`);
    }
  });

  it("groq keeps the free-tier TPM ceiling its own rule states", () => {
    const profile = resolveModelProfile("groq", "openai/gpt-oss-120b");
    assert.equal(profile.freeTierTpmLimit, 8_000);
  });

  it("groq's genuine throughput exclusion is preserved, not engineered away", () => {
    // The owner's instruction is explicit: if Groq truly cannot fit the
    // request, keep the exclusion rather than forcing an impossible call.
    const preflight = preflightProvider("groq", LIVE_PROMPT, {
      useCase: "extraction",
      modelOverride: "openai/gpt-oss-120b",
    });
    assert.equal(preflight.eligible, false);
    assert.equal(preflight.reason, "TPM_LIMIT");
  });

  it("a genuinely unrecognised model still falls to the conservative profile", () => {
    const profile = resolveModelProfile("cerebras", "totally-unknown-model-xyz");
    assert.equal(profile.source, "conservative");
    assert.equal(profile.contextTokens, 8_192);
  });

  it("the scan is provider-agnostic — no provider is special-cased", () => {
    // The same unknown-to-its-own-vendor family must resolve for any provider.
    for (const provider of ["cerebras", "together", "openai", "deepseek"] as const) {
      const profile = resolveModelProfile(provider, "mixtral-8x7b");
      assert.equal(
        profile.source,
        "family-cross-vendor",
        `${provider} must reach the cross-vendor scan like any other`,
      );
    }
  });

  it("openrouter still resolves through its own vendor-aware path", () => {
    // The generalisation must not disturb the routed resolution that already
    // worked, including the :free ceiling.
    const paid = resolveModelProfile("openrouter", "anthropic/claude-3.5-sonnet");
    assert.equal(paid.contextTokens, 200_000);
    const free = resolveModelProfile("openrouter", "anthropic/claude-3.5-sonnet:free");
    assert.equal(free.contextTokens, 32_768);
  });
});
