import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { describeEmptyCompletion } from "../lib/ai";
import { classifyProviderError } from "../lib/ai-provider-classification";

/**
 * THE DEFECT, read off the provider-chain test at commit 39a37526.
 * -----------------------------------------------------------------
 * Two of the ten canonical providers reported, in full:
 *
 *   Openai    Failed  gpt-4o          1085 ms  MALFORMED_RESPONSE
 *             Provider returned an empty response.
 *   Deepseek  Failed  deepseek-chat    639 ms  MALFORMED_RESPONSE
 *             Provider returned an empty response.
 *
 * Both had completed real round-trips. That one sentence covers a refusal, a
 * content filter, an output budget that ran out before the first token, and a
 * model that spent its whole budget reasoning -- four problems with different
 * owners, one of which is a config change on our side. Reported identically,
 * they were indistinguishable from a dead key, and the chain looked uniformly
 * broken when part of it was ours to fix.
 *
 * The response already carried the answer in `finish_reason`,
 * `message.refusal` and `message.reasoning_content`. Every OpenAI-compatible
 * adapter read `choices[0].message.content` and discarded the rest.
 */

describe("an empty completion says which kind of empty it is", () => {
  it("names a refusal, and quotes it", () => {
    const why = describeEmptyCompletion({
      message: { content: "", refusal: "I can't help with that request." },
      finish_reason: "stop",
    });
    assert.match(why, /declined to answer/);
    assert.match(why, /I can't help with that request/);
  });

  it("names an output budget that ran out before any content", () => {
    const why = describeEmptyCompletion({ message: { content: "" }, finish_reason: "length" }, 1200);
    assert.match(why, /output token budget/);
    assert.match(why, /max_tokens=1200/);
  });

  it("distinguishes a budget spent on reasoning from one spent on output", () => {
    const why = describeEmptyCompletion(
      { message: { content: "", reasoning_content: "x".repeat(800) }, finish_reason: "length" },
      1200,
    );
    assert.match(why, /reasoning/);
    assert.match(why, /non-reasoning model|raise the budget/);
  });

  it("names a content filter", () => {
    const why = describeEmptyCompletion({ message: { content: "" }, finish_reason: "content_filter" });
    assert.match(why, /content filter/);
  });

  it("names reasoning-only output that finished normally", () => {
    const why = describeEmptyCompletion({
      message: { content: "", reasoning_content: "y".repeat(812) },
      finish_reason: "stop",
    });
    assert.match(why, /812 characters of reasoning/);
  });

  it("says so when there were no choices at all", () => {
    assert.match(describeEmptyCompletion(undefined), /no choices at all/);
  });

  it("still reports a plain empty answer, with whatever finish_reason came back", () => {
    assert.match(describeEmptyCompletion({ message: { content: "" }, finish_reason: "stop" }), /finish_reason=stop/);
    assert.match(describeEmptyCompletion({ message: { content: "" } }), /no finish_reason/);
  });

  it("never returns an empty description — the point is that something is said", () => {
    for (const choice of [
      undefined,
      {},
      { message: {} },
      { message: { content: null }, finish_reason: null },
      { finish_reason: "" },
    ]) {
      const why = describeEmptyCompletion(choice as Parameters<typeof describeEmptyCompletion>[0]);
      assert.ok(why.trim().length > 0, JSON.stringify(choice));
    }
  });
});

describe("each kind of empty lands in the category that matches who must fix it", () => {
  it("treats an exhausted output budget as OUR defect, not provider ill-health", () => {
    // REQUEST_TOO_LARGE carries a zero cooldown, and the reason is documented
    // on the category itself: cooling a provider for our own budgeting defect
    // would turn it into false provider-health evidence.
    for (const why of [
      describeEmptyCompletion({ message: { content: "" }, finish_reason: "length" }, 1200),
      describeEmptyCompletion({ message: { content: "", reasoning_content: "z".repeat(50) }, finish_reason: "length" }, 1200),
    ]) {
      assert.equal(classifyProviderError(new Error(`OpenAI gpt-4o ${why}`)), "REQUEST_TOO_LARGE", why);
    }
  });

  it("treats an unusable answer as MALFORMED_RESPONSE", () => {
    for (const why of [
      describeEmptyCompletion({ message: { content: "", refusal: "no" }, finish_reason: "stop" }),
      describeEmptyCompletion({ message: { content: "" }, finish_reason: "content_filter" }),
      describeEmptyCompletion({ message: { content: "", reasoning_content: "q".repeat(30) }, finish_reason: "stop" }),
      describeEmptyCompletion({ message: { content: "" }, finish_reason: "stop" }),
      describeEmptyCompletion(undefined),
    ]) {
      assert.equal(classifyProviderError(new Error(`OpenAI gpt-4o ${why}`)), "MALFORMED_RESPONSE", why);
    }
  });

  it("does not reclassify a genuine provider or credential fault as ours", () => {
    // The negative that matters: widening REQUEST_TOO_LARGE must not swallow
    // failures that are the provider's or the owner's to fix.
    assert.equal(classifyProviderError(new Error("Together auth error HTTP 401: Invalid API key")), "AUTH");
    assert.equal(classifyProviderError(new Error("Cerebras HTTP 402: Payment required to access this resource")), "BILLING");
    assert.equal(classifyProviderError(new Error("Mistral rate limit HTTP 429: Rate limit exceeded")), "RATE_LIMIT");
    assert.equal(classifyProviderError(new Error("OpenRouter HTTP 402: This request requires more credits")), "BILLING");
  });
});
