// ─── A credit refusal that states a ceiling is a refusal of SIZE ─────────────
//
// THE DEFECT, verbatim from run 35643865544 (Vercel runtime logs):
//
//   [ai] OpenRouter error 402 on google/gemini-2.5-pro:
//        {"error":{"message":"This request requires more credits, or fewer
//        max_tokens. You requested up to 4000 tokens, but can only afford
//        892. To increase, visit https://openrouter.ai/settings/credits ..."
//        — skipping.
//
// The account HAS credit. The adapter asked for 4000 output tokens, was told
// the affordable ceiling is 892, discarded that number, recorded a BILLING
// failure and skipped the provider. It has done so on every run.
//
// Preflight cannot prevent this. It sizes requests from static per-model
// profiles (context window, free-tier TPM) and has no way to know a live
// credit balance. The only authority on that balance is the provider's own
// refusal, and the adapter was throwing it away.
//
// THE RULE PINNED HERE: when a provider refuses and states what it CAN carry,
// re-ask once inside that ceiling before giving it up. Bounded to exactly one
// retry, floored so a ceiling too small for a usable answer is not worth an
// attempt, and it must not record a failure first — cooling a provider that is
// about to answer would put its own remedy out of reach for ten minutes.
//
// Shape-based, not provider-specific: any OpenAI-compatible endpoint that
// answers in these terms gets the same treatment, and a refusal naming no
// ceiling behaves exactly as before.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseAffordableOutputTokens, MIN_AFFORDABLE_OUTPUT_TOKENS } from "../lib/ai";

describe("a provider that names its ceiling is refusing the size, not the request", () => {
  it("reads the ceiling out of the exact refusal the Preview received", () => {
    const body = JSON.stringify({
      error: {
        message:
          "This request requires more credits, or fewer max_tokens. You requested up to 4000 tokens, "
          + "but can only afford 892. To increase, visit https://openrouter.ai/settings/credits and upgrade.",
      },
    });
    assert.equal(parseAffordableOutputTokens(body), 892);
  });

  it("reads a reduce-to instruction as well", () => {
    assert.equal(
      parseAffordableOutputTokens("maximum context length exceeded; reduce max_tokens to 1500"),
      1500,
    );
    assert.equal(
      parseAffordableOutputTokens("please reduce your max_tokens to 640 and retry"),
      640,
    );
  });

  it("returns null when the refusal names no ceiling", () => {
    // These must keep behaving exactly as before: skip to the next provider.
    for (const body of [
      JSON.stringify({ error: { message: "Insufficient Balance" } }),
      JSON.stringify({ message: "Payment required to access this resource. Visit your billing tab." }),
      JSON.stringify({ error: { message: "Invalid API key provided." } }),
      JSON.stringify({ error: { message: "This model is not available in your subscription tier" } }),
      "",
    ]) {
      assert.equal(parseAffordableOutputTokens(body), null, `wrongly parsed a ceiling from: ${body.slice(0, 60)}`);
    }
  });

  it("does not mistake other numbers in the message for the ceiling", () => {
    // "You requested up to 4000 tokens" must not be read as the affordance.
    const body = "You requested up to 4000 tokens, but can only afford 892.";
    assert.equal(parseAffordableOutputTokens(body), 892);
  });

  it("ignores a nonsensical ceiling", () => {
    assert.equal(parseAffordableOutputTokens("can only afford 0"), null);
  });

  it("floors the retry so a useless ceiling is not worth an attempt", () => {
    // A ceiling below the floor is parsed but must not trigger a re-ask: the
    // completion could not carry an answer.
    const tiny = parseAffordableOutputTokens("can only afford 12");
    assert.equal(tiny, 12);
    assert.ok(tiny !== null && tiny < MIN_AFFORDABLE_OUTPUT_TOKENS);
    assert.ok(MIN_AFFORDABLE_OUTPUT_TOKENS > 0);
  });
});

describe("the re-ask is bounded and does not poison provider health", () => {
  const src = require("node:fs").readFileSync("lib/ai.ts", "utf8") as string;

  it("retries at most once", () => {
    assert.match(src, /withinStatedAffordance \? null : parseAffordableOutputTokens\(body\)/);
    assert.match(src, /withinStatedAffordance: true/);
  });

  it("only re-asks for a strictly smaller, usable ceiling", () => {
    assert.match(src, /affordable < maxTokens && affordable >= MIN_AFFORDABLE_OUTPUT_TOKENS/);
  });

  it("does not record a failure before the re-ask", () => {
    // The affordance branch must sit BEFORE the note()/return null that cools
    // the provider, or the remedy the provider just handed us is unreachable.
    //
    // Scoped to generateOpenAICompatible: three adapters in this file emit the
    // same note(`HTTP ...`) line, and an unscoped indexOf finds the FIRST one,
    // in a different function entirely — which is a fact about this file's
    // shape, not about the ordering being asserted.
    const fnStart = src.indexOf("async function generateOpenAICompatible");
    assert.ok(fnStart > -1, "generateOpenAICompatible not found");
    const fnEnd = src.indexOf("\n}\n", fnStart);
    const fn = src.slice(fnStart, fnEnd);

    const affordanceBranch = fn.indexOf("parseAffordableOutputTokens(body)");
    const genericNote = fn.indexOf("note(`HTTP ${res.status} on ${model}");
    assert.ok(affordanceBranch > -1, "the affordance branch is not in the adapter");
    assert.ok(genericNote > -1, "the generic failure note is not in the adapter");
    assert.ok(
      affordanceBranch < genericNote,
      "the failure is recorded before the provider's stated remedy is tried",
    );
  });

  it("carries no provider name in the parsing rule", () => {
    const fn = src.slice(
      src.indexOf("export function parseAffordableOutputTokens"),
      src.indexOf("async function generateOpenAICompatible"),
    );
    const code = fn.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    for (const forbidden of [/openrouter/i, /cerebras/i, /deepseek/i, /anthropic/i]) {
      assert.equal(forbidden.test(code), false, `the rule is specific to ${forbidden}`);
    }
  });
});
