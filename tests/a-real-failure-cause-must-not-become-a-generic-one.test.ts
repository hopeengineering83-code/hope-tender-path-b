import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * THE DEFECT, read off the owner's own diagnostics.
 * -------------------------------------------------
 * On 2026-09-14 the live provider chain reported:
 *
 *   anthropic  CONFIGURED  analyze=False  model=claude-sonnet-4-5
 *       analysis: MALFORMED_RESPONSE -- empty response
 *
 * Anthropic had not returned a malformed response. `generateWithClaude`
 * collected each model's real error, logged it, and then returned null,
 * discarding every one of them. Its caller could not tell "the provider
 * refused us" from "the provider answered with nothing", so it recorded the
 * only thing it had: `new Error("empty response")`. Worse, the anthropic
 * branch recorded the real error in its `.catch` and then recorded
 * "empty response" unconditionally underneath, overwriting it.
 *
 * The cost of that is not cosmetic. MALFORMED_RESPONSE points an operator at
 * our own JSON handling; the real cause was the provider account. It hides a
 * one-click fix behind a hunt through code that is working correctly.
 *
 * The rule under test is general: a real cause must never be replaced by a
 * generic one, and "threw" must never collapse into "returned empty".
 */

const ai = readFileSync("lib/ai.ts", "utf8");

function region(start: string, end: string): string {
  const from = ai.indexOf(start);
  assert.ok(from >= 0, `expected to find ${start}`);
  const to = ai.indexOf(end, from);
  assert.ok(to > from, `expected to find ${end} after ${start}`);
  return ai.slice(from, to);
}

describe("a real failure cause must not become a generic one", () => {
  it("the Claude model loop surfaces every collected cause, not only rate limits", () => {
    const exhausted = region("All Claude models exhausted", "function isModelUnavailableError");

    // The pre-existing narrow branch must remain: rate limits carry their own
    // cooldown semantics and the chain depends on them being classified.
    assert.match(exhausted, /Claude rate-limited \(all models in chain returned 429/);

    // And every other cause must reach the caller too.
    assert.match(
      exhausted,
      /throw new Error\(`Claude unavailable \(all models in chain failed\): \$\{errors\.join\(" \| "\)\}`\)/,
      "collected errors must be thrown, not discarded by a bare `return null`",
    );

    // The bare `return null` may only be reached when nothing was collected —
    // that is, a genuinely empty answer with no error at all.
    const afterThrow = exhausted.slice(exhausted.indexOf("Claude unavailable"));
    assert.doesNotMatch(
      afterThrow.slice(0, afterThrow.indexOf("}")),
      /return null/,
      "a collected-errors path must not fall through to `return null`",
    );
  });

  it("'it threw' and 'it returned nothing' do not collapse into one record", () => {
    const branch = region('case "anthropic": {', 'case "gemini": {');

    // A throw is recorded once, by the catch, with the real error.
    assert.match(branch, /\.catch\(\(err\) => \{[\s\S]*recordProviderFailure\("anthropic", err\)/);

    // "empty response" is recorded ONLY when the call did not throw.
    assert.match(
      branch,
      /if \(!threw\) recordProviderFailure\("anthropic", new Error\("empty response"\)\)/,
      "an unconditional empty-response record overwrites the real cause",
    );
    assert.doesNotMatch(
      branch,
      /^\s*recordProviderFailure\("anthropic", new Error\("empty response"\)\);\s*$/m,
      "the unconditional overwrite must be gone",
    );
  });

  it("the rule is about causes, not about one provider or one sector", () => {
    const exhausted = region("EVERY OTHER CAUSE MUST SURVIVE", "throw new Error(`Claude unavailable");
    for (const word of ["hospital", "healthcare", "medical", "clinical", "pharo"]) {
      assert.ok(!exhausted.toLowerCase().includes(word), `the rule must not name ${word}`);
    }
  });
});
