// A provider that is merely BUSY must not be quarantined like a broken one.
//
// Reproduced defect (hosted acceptance, 2026-09-09, run 34386062480)
// ─────────────────────────────────────────────────────────────────
// Gemini — first in the canonical chain and the only provider that passed the
// real generation capability test that day — answered the engine's optional
// matcher work with:
//
//   [503 Service Unavailable] This model is currently experiencing high demand.
//   Spikes in demand are usually temporary. Please try again later.
//
// That body says "high demand", never "overloaded", so it matched no overload
// phrase and fell to the classifier's `status >= 500` catch-all: PROVIDER_ERROR,
// 30s base cooldown, doubled again by backoffFactor when the identical 503 came
// back on the next optional batch. The MANDATORY proposal writer started while
// that cooldown was still running and logged:
//
//   cover-and-summary=fallback(1.5s) company-and-experience=fallback(2s)
//   technical-approach=fallback(1.8s) additional-and-declaration=fallback(1.8s)
//
// Four fallback sections in under two seconds — the writer never placed a single
// provider call, on an account whose Gemini key was working.
//
// This is not a Gemini rule and not a benchmark rule. Every vendor below phrases
// a capacity shortage without the word "overloaded", and each is a real response
// body. Capacity is PROVIDER_OVERLOAD: the shortest backoff there is, because
// the identical request typically succeeds moments later. It must never be read
// as AUTH, BILLING, MODEL_UNAVAILABLE or CONFIGURATION_INVALID, none of which
// clear on their own.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { classifyAiError } from "../lib/ai-provider-health";
import { COOLDOWN_PER_CATEGORY_MS } from "../lib/ai-provider-health";

const CAPACITY_MESSAGES: ReadonlyArray<{ vendor: string; message: string }> = [
  {
    vendor: "gemini",
    message:
      "[GoogleGenerativeAI Error]: Error fetching from " +
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent: " +
      "[503 Service Unavailable] This model is currently experiencing high demand. " +
      "Spikes in demand are usually temporary. Please try again later.",
  },
  {
    vendor: "gemini (short form)",
    message: "HTTP 503: The model is overloaded. Please try again later.",
  },
  {
    vendor: "anthropic",
    message: 'HTTP 529: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
  },
  {
    vendor: "openai",
    message: "HTTP 503: That model is currently overloaded with other requests.",
  },
  {
    vendor: "zai",
    message: 'HTTP 503: {"error":{"code":"1305","message":"The service may be temporarily overloaded, please try again later"}}',
  },
];

describe("a busy provider is capacity, not a fault", () => {
  for (const { vendor, message } of CAPACITY_MESSAGES) {
    it(`${vendor}: classified PROVIDER_OVERLOAD`, () => {
      assert.equal(classifyAiError(new Error(message)), "PROVIDER_OVERLOAD");
    });
  }

  it("Google's 'high demand' wording specifically is not PROVIDER_ERROR", () => {
    // The exact regression. Before the fix this returned PROVIDER_ERROR and
    // cost the run its only working provider.
    const category = classifyAiError(
      new Error(
        "[503 Service Unavailable] This model is currently experiencing high demand. " +
          "Spikes in demand are usually temporary. Please try again later.",
      ),
    );
    assert.notEqual(category, "PROVIDER_ERROR");
    assert.equal(category, "PROVIDER_OVERLOAD");
  });

  it("overload cools down for strictly less time than a provider fault", () => {
    // The whole point of the distinction: a busy provider must come back sooner
    // than a broken one, or the next stage inherits an outage that never was.
    assert.ok(
      COOLDOWN_PER_CATEGORY_MS.PROVIDER_OVERLOAD < COOLDOWN_PER_CATEGORY_MS.PROVIDER_ERROR,
      "PROVIDER_OVERLOAD must back off for less time than PROVIDER_ERROR",
    );
  });

  it("capacity never reads as an unrecoverable account problem", () => {
    // AUTH, BILLING and CONFIGURATION_INVALID all quarantine for minutes and
    // imply an operator must act. A momentary capacity dip implies neither.
    const unrecoverable = new Set(["AUTH", "BILLING", "CONFIGURATION_INVALID", "MODEL_UNAVAILABLE"]);
    for (const { vendor, message } of CAPACITY_MESSAGES) {
      const category = classifyAiError(new Error(message));
      assert.ok(
        !unrecoverable.has(category),
        `${vendor} capacity message must not classify as ${category}`,
      );
    }
  });

  it("a genuine 5xx with no capacity wording is still PROVIDER_ERROR", () => {
    // Guard against widening the vocabulary into a catch-all: their software
    // really can break, and that must keep the longer backoff.
    assert.equal(
      classifyAiError(new Error("HTTP 500: Internal Server Error")),
      "PROVIDER_ERROR",
    );
  });

  it("a rate limit is still RATE_LIMIT even when the body mentions demand", () => {
    // Rule order matters: our own throughput cap is not the provider's capacity.
    assert.equal(
      classifyAiError(
        new Error(
          "HTTP 429: Rate limit reached for model `openai/gpt-oss-120b` on tokens per minute (TPM): Limit 8000",
        ),
      ),
      "RATE_LIMIT",
    );
  });

  it("a billing refusal is still BILLING even at 503", () => {
    assert.equal(
      classifyAiError(
        new Error('HTTP 402: {"message":"Payment required to access this resource.","code":"payment_required"}'),
      ),
      "BILLING",
    );
  });
});
