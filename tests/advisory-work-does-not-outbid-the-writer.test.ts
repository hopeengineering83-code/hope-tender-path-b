// Optional AI work must not spend a scarce provider budget the mandatory
// proposal writer needs.
//
// Reproduced defect (hosted acceptance, 2026-09-09, runs 34386062480 and
// 34388287833 — two consecutive runs, same shape)
// ────────────────────────────────────────────────────────────────────────────
// Gemini is first in the canonical chain and, on both runs, the only provider
// not blocked by an external billing wall. Its free tier is rate-limited per
// minute. The run spent that budget like this:
//
//   18:20:48  Rate limit hit (attempt 1/3) … (2/3) …   EXPERT re-rank  OPTIONAL
//   18:20:55  Gemini failed: rate limit reached after retries
//   18:20:58  Rate limit hit (attempt 1/3) … (2/3) …   PROJECT re-rank OPTIONAL
//   18:21:05  Gemini failed: rate limit reached after retries
//   18:22:32  semantic aligner                          OPTIONAL — "in cooldown"
//   18:22:35  section-parallel generation … fallback x4 MANDATORY
//
// The engine's own log calls that work disposable — "optional AI reranking
// failed or was skipped; authoritative deterministic selection remains valid",
// "falling through to legacy lexical match only" — yet each optional call took
// three attempts at a provider that answers a limited number of calls per
// minute. The writer, whose output IS the deliverable, then had nothing left to
// call and authored all four sections from the deterministic fallback.
//
// Retrying is how a caller says "I need this answer". A caller that discards
// the answer has not earned three attempts at it. Advisory mode narrows exactly
// one thing — the retry budget — and leaves routing, cooldowns, provider order
// and model selection untouched.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

import { isAdvisoryContext, runAsAdvisory } from "../lib/ai";

const read = (p: string) => readFileSync(p, "utf8");

describe("advisory AI work is bounded", () => {
  it("advisory context is off by default", () => {
    assert.equal(isAdvisoryContext(), false);
  });

  it("runAsAdvisory marks its whole async call tree", async () => {
    await runAsAdvisory(async () => {
      assert.equal(isAdvisoryContext(), true);
      // Survives await boundaries — the retry helper sits several frames deep.
      await Promise.resolve();
      assert.equal(isAdvisoryContext(), true);
      await (async () => {
        await Promise.resolve();
        assert.equal(isAdvisoryContext(), true);
      })();
    });
  });

  it("the context does not leak back out", async () => {
    await runAsAdvisory(async () => Promise.resolve());
    assert.equal(isAdvisoryContext(), false);
  });

  it("concurrent mandatory work is not marked advisory", async () => {
    // AsyncLocalStorage, not a module flag: an advisory call running next to
    // real work must not silence the real work's retries.
    let mandatorySawAdvisory: boolean | null = null;
    await Promise.all([
      runAsAdvisory(async () => {
        await new Promise((r) => setTimeout(r, 5));
        assert.equal(isAdvisoryContext(), true);
      }),
      (async () => {
        await new Promise((r) => setTimeout(r, 1));
        mandatorySawAdvisory = isAdvisoryContext();
      })(),
    ]);
    assert.equal(mandatorySawAdvisory, false);
  });

  it("the retry helper honours advisory mode", () => {
    // Source-level: the retry loop must bound itself by the advisory-aware
    // count, not the raw parameter, or the whole mechanism is decorative.
    const src = read("lib/ai.ts");
    assert.match(
      src,
      /const effectiveRetries = isAdvisoryContext\(\) \? 1 : maxRetries;/,
      "withRateLimitRetry must derive its attempt count from advisory context",
    );
    assert.match(
      src,
      /for \(let attempt = 0; attempt < effectiveRetries; attempt\+\+\)/,
      "the retry loop must iterate on effectiveRetries",
    );
    assert.doesNotMatch(
      src,
      /attempt < maxRetries - 1/,
      "the continue-guard must also use effectiveRetries, or advisory calls still retry",
    );
  });

  it("both self-declared-optional call sites run as advisory", () => {
    // These are the two the engine itself logs as discardable. If someone
    // unwraps one, the writer starves again exactly as it did on both runs.
    const src = read("lib/engine/generate-elite.ts");
    assert.match(src, /runAsAdvisory\(\(\) => aiRematchExperts\(/, "expert re-rank must be advisory");
    assert.match(src, /runAsAdvisory\(\(\) => aiRematchProjects\(/, "project re-rank must be advisory");
    assert.match(src, /runAsAdvisory\(\(\) => alignMatchesToEvaluatorCriteria\(/, "semantic aligner must be advisory");
  });

  it("the mandatory section writer is NOT advisory", () => {
    // The whole point. The writer must keep its full retry budget.
    const src = read("lib/engine/generate-elite.ts");
    assert.doesNotMatch(
      src,
      /runAsAdvisory\(\(\) => generateProposalSectionsParallel\(/,
      "the section writer must never be demoted to advisory",
    );
    assert.doesNotMatch(
      src,
      /runAsAdvisory\(\(\) => generateBenchmarkProposalWithAI\(/,
      "benchmark proposal generation must never be demoted to advisory",
    );
  });

  it("advisory mode changes ONLY the retry budget", () => {
    // Guard against scope creep into routing. Advisory work is real traffic:
    // if it finds a provider rate-limited that is true for everyone, so it must
    // still record health. Only runAsDiagnostic suppresses that.
    const src = read("lib/ai.ts");
    const advisoryBlock = src.slice(
      src.indexOf("const advisoryStore"),
      src.indexOf("const providerDeadlineStore"),
    );
    assert.ok(advisoryBlock.length > 0, "advisory block not found");
    for (const forbidden of ["recordProviderFailure", "cooldown", "CANONICAL_AI_PROVIDER_ORDER"]) {
      assert.ok(
        !advisoryBlock.includes(forbidden),
        `advisory mode must not touch ${forbidden} — that is diagnostic mode's job`,
      );
    }
  });
});
