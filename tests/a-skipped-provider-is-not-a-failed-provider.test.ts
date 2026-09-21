import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  PROPOSAL_SECTION_MIN_WRITE_MS,
  COOLDOWN_WAIT_SETTLE_MS,
} from "../lib/timeout-config";

/**
 * THE DEFECT.
 * -----------
 * 2026-09-21, acceptance run 35603378101 on a Preview serving the exact head.
 * PROPOSAL_GENERATION succeeded, and the proposal's recorded provenance said:
 *
 *   AI_SECTION_PARTIAL_FALLBACK: 4 of 4 section(s) used deterministic
 *   fallback. Failed: cover-and-summary "all AI providers failed or
 *   unavailable for this section" | company-and-experience "..." |
 *   technical-approach "..." | additional-and-declaration "..."
 *
 * Read literally that says ten providers were contacted and all ten refused,
 * four times over. It is not what happened. The detail carried NO
 * failureCategory, NO model, NO token counts and NO attempts -- and both the
 * skip branches that precede dispatch push to `attempts`. An empty attempts
 * list therefore means the provider loop ran ZERO iterations: not one provider
 * was ever called.
 *
 * Two bare `continue`s in lib/ai.ts were the cause:
 *
 *   if (!providerAutomaticEligibility(provider).eligible) continue;
 *   if (isProviderCooledDown(provider)) continue;
 *
 * Seven of the ten providers were billing- or auth-dead and cooling down for
 * up to 160 minutes (BILLING 10min x backoff 16). The three live ones --
 * gemini, groq, zai -- were cooling down for 15-60s, because AI Analyze runs
 * immediately before generation and consumes exactly the same providers.
 *
 * TWO RULES ARE PINNED HERE.
 *
 * 1. A SKIP IS NOT A FAILURE. Whatever the outcome, the chain records what it
 *    did to each provider, so provenance can never again print "all providers
 *    failed" about a chain that dispatched nothing.
 *
 * 2. A COOLDOWN IS "TRY AGAIN IN N SECONDS", NOT A VERDICT. When nothing was
 *    dispatched and the earliest cooldown expires inside the budget, the
 *    section waits and re-walks rather than committing the whole proposal to
 *    the deterministic draft. AI Analyze already treats cooldowns this way via
 *    getMinCooldownExpiryMs(); generation did not.
 *
 * These are properties of the provider chain, so they hold for every tender in
 * every sector -- an architecture bid, a road supervision EOI, a borehole
 * investigation. Nothing here is tender-, client- or sector-specific, and the
 * last test enforces that.
 */

const AI_SRC = readFileSync("lib/ai.ts", "utf8");
const ELITE_SRC = readFileSync("lib/engine/generate-elite.ts", "utf8");

/**
 * The per-section writer only. lib/ai.ts also holds the older whole-proposal
 * walk, which has the same two bare `continue`s and no attempts telemetry at
 * all. Asserting against the whole module would pass or fail for the wrong
 * reason, so every source assertion below is scoped to this function.
 */
const SECTION_WRITER = (() => {
  const start = AI_SRC.indexOf("async function generateOneSection");
  if (start < 0) throw new Error("generateOneSection not found in lib/ai.ts");
  const end = AI_SRC.indexOf("\nfunction ", start + 1);
  return AI_SRC.slice(start, end > start ? end : start + 14_000);
})();

describe("a skipped provider is not a failed provider", () => {
  it("records an ineligible provider instead of skipping it silently", () => {
    assert.match(SECTION_WRITER, /outcome: "SKIPPED_INELIGIBLE"/);
    assert.equal(
      /if \(!providerAutomaticEligibility\(provider\)\.eligible\) continue;/.test(SECTION_WRITER),
      false,
      "the silent eligibility skip is still there",
    );
  });

  it("records a cooling-down provider instead of skipping it silently", () => {
    assert.match(SECTION_WRITER, /outcome: "SKIPPED_COOLING_DOWN"/);
    assert.equal(
      /if \(isProviderCooledDown\(provider\)\) continue;/.test(SECTION_WRITER),
      false,
      "the silent cooldown skip is still there",
    );
  });

  it("distinguishes every outcome a walked provider can have", () => {
    for (const outcome of [
      "SKIPPED_NO_CAPACITY",
      "SKIPPED_INELIGIBLE",
      "SKIPPED_COOLING_DOWN",
      "WAITED_FOR_COOLDOWN",
      "FAILED",
    ]) {
      assert.match(SECTION_WRITER, new RegExp(`"${outcome}"`), `attempts cannot express ${outcome}`);
    }
  });
});

describe("a cooldown is a wait, not a verdict", () => {
  it("consults the same cooldown-expiry authority AI Analyze uses", () => {
    assert.match(SECTION_WRITER, /getMinCooldownExpiryMs\(\)/);
    const analyze = readFileSync("lib/engine/analysis-orchestrator.ts", "utf8");
    assert.match(analyze, /getMinCooldownExpiryMs\(\)/);
  });

  it("waits only when nothing was dispatched", () => {
    // A provider that was actually called and refused is not waiting on a
    // cooldown, so waiting cannot be the remedy.
    assert.match(SECTION_WRITER, /const dispatched = attempts\.some\(\(attempt\) => attempt\.outcome === "FAILED"\);/);
    assert.match(SECTION_WRITER, /dispatched \? null : getMinCooldownExpiryMs\(\)/);
  });

  it("waits at most one round, so it cannot loop", () => {
    assert.match(SECTION_WRITER, /for \(let round = 0; round < 2; round \+= 1\)/);
    assert.match(SECTION_WRITER, /if \(round === 0\)/);
  });

  it("only waits when the wait AND a usable writing window fit the budget", () => {
    assert.match(SECTION_WRITER, /PROPOSAL_SECTION_MIN_WRITE_MS/);
    assert.match(SECTION_WRITER, /const needMs = retryAfterMs \+ PROPOSAL_SECTION_MIN_WRITE_MS;/);
    assert.match(SECTION_WRITER, /grantedMs >= needMs/);
    // A wait that consumed the whole remaining budget would reach the same
    // fallback one round later, having learned nothing.
    assert.ok(PROPOSAL_SECTION_MIN_WRITE_MS > 0);
  });

  it("weighs the wait against the worker deadline, not the section's writing budget", () => {
    // 2026-09-21, run 35607631874. The same invocation logged "budget=220s"
    // and finished all four sections in 17.1s, yet three of them refused a
    // 16s wait:
    //
    //   technical-approach          Waiting 16s (section budget 42s, 22s affordable)
    //   cover-and-summary           does not fit the remaining section budget — falling back
    //
    // A section's budget is how long it may spend WRITING. A cooldown wait is
    // idle time, bounded by the invocation, and makeSectionTimeout builds a
    // fresh timeout per attempt so waiting costs the writing window nothing.
    // Charging the wait to the section budget left ~200s of worker budget
    // unspent and sent the proposal to the deterministic draft.
    assert.equal(
      /const affordableMs = sectionBudgetMs/.test(SECTION_WRITER),
      false,
      "the wait is still charged against the section's own writing budget",
    );
    // resolveEffectiveTimeoutMs clamps to the armed worker deadline, so it is
    // the authority that owns this answer.
    assert.match(SECTION_WRITER, /const grantedMs = resolveEffectiveTimeoutMs\(needMs\);/);
  });

  it("lands after the expiry rather than exactly on it", () => {
    // isProviderCooledDown compares against Date.now(); waking exactly at the
    // expiry can still observe the provider as cooling down.
    assert.ok(COOLDOWN_WAIT_SETTLE_MS > 0);
    assert.match(SECTION_WRITER, /retryAfterMs \+ COOLDOWN_WAIT_SETTLE_MS/);
  });

  it("cannot push a section past the platform ceiling", () => {
    // The wait is granted by resolveEffectiveTimeoutMs, which clamps to the
    // armed worker deadline, so it can never exceed what the invocation has
    // left — and a raw constant is never used in its place.
    assert.match(SECTION_WRITER, /resolveEffectiveTimeoutMs\(needMs\)/);
  });
});

describe("the fallback reason names the walk", () => {
  it("renders attempts rather than stringifying the array", () => {
    // `${array}` on objects yields "[object Object]" — the one field naming
    // which providers were tried reached the operator as noise.
    assert.equal(
      /attempts=\$\{section\.attempts\}/.test(ELITE_SRC),
      false,
      "attempts is still interpolated as a raw array",
    );
    assert.match(ELITE_SRC, /a\.provider.*a\.outcome.*a\.reason/);
  });

  it("no longer claims every provider failed when none was tried", () => {
    assert.match(
      SECTION_WRITER,
      /All providers failed, were skipped, or were still cooling down/,
      "the fallback comment still asserts failure for a chain that may have dispatched nothing",
    );
  });
});

describe("the repair is a property of the chain, not of any tender", () => {
  it("carries no sector, client or benchmark vocabulary in the changed logic", () => {
    // Scope to the section writer, not the whole 5k-line module.
    const code = SECTION_WRITER
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    for (const forbidden of [/\bPharo\b/i, /\bhospital/i, /\bhealthcare/i, /\bEthiopia/i, /\bmedical\b/i]) {
      assert.equal(forbidden.test(code), false, `section writer code mentions ${forbidden}`);
    }
  });
});
