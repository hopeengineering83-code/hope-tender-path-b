import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * THE DEFECT, traced from a screenshot to its line.
 * --------------------------------------------------
 * The provider-chain card showed, for two of ten providers:
 *
 *   Openai    Failed  gpt-4o          MALFORMED_RESPONSE
 *             Provider returned an empty response.
 *   Deepseek  Failed  deepseek-chat   MALFORMED_RESPONSE
 *             Provider returned an empty response.
 *
 * A scoped re-run (34779768516, provider=openai,deepseek) reached both and
 * still said only "Provider returned an empty response with no recorded
 * reason" — the fallback text, meaning `capture.error` was null.
 *
 * generateWithOpenAI and generateWithDeepSeek logged every failure to the
 * server console and returned null. `callProviderInner` records a failure only
 * when the call THROWS, so a null return recorded nothing, and the capability
 * test — seeing no text and no capture — could only say "empty response". A
 * 401, a 429, a 4xx body, a timeout and a genuine empty completion were all
 * reported with the same sentence. The real reason sat in a Vercel runtime log
 * that is behind a billing limit on this account, so it was not merely
 * inconvenient to reach: it was unreachable.
 *
 * `generateOpenAICompatible` has done this correctly all along via its `note()`
 * helper, which is why Together (401), Cerebras (402) and OpenRouter (402)
 * reported real, actionable reasons on the very same card. These two adapters
 * predate it and never got it.
 *
 * WHY THIS TEST IS STRUCTURAL
 * ---------------------------
 * Exercising these branches for real would require live keys and forced 401s,
 * 429s and timeouts against three vendors. The invariant that actually matters
 * is simpler and checkable: inside these adapters, no path may give up AFTER
 * contacting the provider without recording why. A future branch added without
 * a note() is the same defect returning, and this fails on it.
 */

const AI_SOURCE = readFileSync(join(process.cwd(), "lib", "ai.ts"), "utf8");

/** Extracts one top-level `async function <name>(` body by brace matching. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `${name} not found in lib/ai.ts`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces reading ${name}`);
}

/**
 * Every `return null` that happens after the request was sent, paired with
 * whether the preceding few lines record the reason. The key-missing guard at
 * the top is excluded deliberately: no provider was contacted, nothing failed,
 * and recording a failure there would invent provider-health evidence out of
 * an unconfigured key.
 */
function unrecordedGiveUps(body: string): string[] {
  const lines = body.split("\n");
  const offenders: string[] = [];
  lines.forEach((line, index) => {
    if (!/^\s*return null;/.test(line)) return;
    const preceding = lines.slice(Math.max(0, index - 6), index).join("\n");
    if (/if \(!\w*[Kk]ey\)/.test(line) || /Key\) return null;/.test(line)) return;
    if (/note\(|recordProviderFailure\(/.test(preceding)) return;
    offenders.push(`line ${index + 1}: ${lines.slice(Math.max(0, index - 2), index + 1).join(" | ").trim()}`);
  });
  return offenders;
}

describe("a provider that gives up silently is indistinguishable from a dead key", () => {
  for (const fn of ["generateWithOpenAI", "generateWithDeepSeek", "generateOpenAICompatible"]) {
    it(`${fn} records a reason on every path that gives up after contact`, () => {
      const offenders = unrecordedGiveUps(functionBody(AI_SOURCE, fn));
      assert.deepEqual(
        offenders,
        [],
        `${fn} has ${offenders.length} silent give-up(s); each reaches the operator as "empty response":\n${offenders.join("\n")}`,
      );
    });
  }

  it("the two repaired adapters cover every failure shape the third one does", () => {
    // Not a count of lines — a count of DISTINCT reasons, so the three stay in
    // step as branches are added.
    for (const fn of ["generateWithOpenAI", "generateWithDeepSeek"]) {
      const body = functionBody(AI_SOURCE, fn);
      for (const shape of [/auth error HTTP/, /rate limit HTTP 429/, /HTTP \$\{res\.status\}/, /API error:/, /timed out after/, /fetch failed:/]) {
        assert.match(body, shape, `${fn} does not report ${shape}`);
      }
    }
  });

  it("does not record a failure when no provider was ever contacted", () => {
    // An unconfigured key is not a provider failure, and recording one would
    // put false evidence into the health state that governs routing.
    //
    // The check is on the key-missing EARLY RETURN, not on everything above
    // `const controller`: the note() helper is declared up there, and its
    // declaration mentions recordProviderFailure without calling it. Matching
    // the declaration would fail the test for the fix that satisfies it.
    for (const fn of ["generateWithOpenAI", "generateWithDeepSeek"]) {
      const body = functionBody(AI_SOURCE, fn);
      const guard = /if \(!\w+\) return null;/.exec(body);
      assert.ok(guard, `${fn} has no key-missing guard`);
      const beforeGuard = body.slice(0, guard.index);
      assert.doesNotMatch(
        beforeGuard,
        /\bnote\(`|recordProviderFailure\("/,
        `${fn} records a failure before it has contacted anyone`,
      );
    }
  });

  it("uses the shared redactor, not a local subset of it", () => {
    // A local regex here knew only quoted sk- keys, and missed `Bearer
    // <token>` — the form a provider echoes back when quoting a rejected
    // Authorization header.
    for (const fn of ["generateWithOpenAI", "generateWithDeepSeek"]) {
      const body = functionBody(AI_SOURCE, fn);
      assert.match(body, /redactSecrets\(/, `${fn} must sanitise through lib/sanitize-error`);
      assert.doesNotMatch(body, /sk-\[\^/, `${fn} still carries a bespoke key regex`);
    }
  });
});
