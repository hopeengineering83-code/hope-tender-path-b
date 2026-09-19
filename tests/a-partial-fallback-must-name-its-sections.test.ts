import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * THE DEFECT.
 * -----------
 * 2026-09-16. Three confirm=accept runs delivered the proposal as
 * "deterministic benchmark fallback", while the provider sweep reported
 * groq GENERATION_VERIFIED with proposal='openai/gpt-oss-120b'. The cause,
 * once the acceptance printer was taught to read it, was the writer's own
 * guard:
 *
 *   AI_SECTION_PARTIAL_FALLBACK: one or more sections used deterministic
 *   fallback. Output is not fully AI-generated.
 *
 * The guard is deliberate — it refuses to ship a partially-AI document — and
 * it is NOT changed here. What it did wrong was throw a boolean's worth of
 * information while `sectionResult.sections` already held, for every section:
 * id, source, error, model, estimatedInputTokens, contextLimit,
 * maxOutputTokens, failureCategory and attempts.
 *
 * That detail decides whether ONE section fails for a specific fixable reason —
 * a token budget, a context limit, one provider's rate limit — or whether the
 * writer is broadly unable to produce a section. Those are different problems
 * with different fixes, and "one or more sections" cannot tell them apart. So
 * three full acceptance runs were spent without anyone able to say which
 * section caused the fallback.
 *
 * The message reaches the operator: generate-elite appends it to
 * contentSummary as "AI fallback reason: ...", which the acceptance inspection
 * now prints.
 */
describe("a partial fallback must name its sections", () => {
  const source = readFileSync("lib/engine/generate-elite.ts", "utf8");

  it("no longer throws the bare boolean message", () => {
    assert.equal(
      /one or more sections used deterministic fallback\. Output is not fully AI-generated\./.test(source),
      false,
      "the uninformative message must not come back",
    );
  });

  it("still refuses a partially-AI document — the guard is unchanged", () => {
    // The point of this file is that naming the cause did NOT relax the rule.
    assert.match(source, /if \(sectionResult\.anyFallback\) \{/);
    assert.match(source, /throw new Error\(\s*`AI_SECTION_PARTIAL_FALLBACK:/);
  });

  it("reports how many sections of how many failed", () => {
    assert.match(source, /\$\{failed\.length\} of \$\{sectionResult\.sections\.length\} section\(s\)/);
  });

  it("names each failed section and the fields that explain it", () => {
    const guard = source.slice(source.indexOf("if (sectionResult.anyFallback)"));
    for (const field of ["section.id", "section.failureCategory", "section.model", "section.estimatedInputTokens", "section.contextLimit", "section.maxOutputTokens", "section.attempts", "section.error"]) {
      assert.ok(guard.includes(field), `guard must report ${field}`);
    }
  });

  it("says so explicitly when no per-section detail was recorded", () => {
    // Silence here would be the same defect one level down: an empty list read
    // as "nothing failed" when something plainly did.
    assert.match(source, /\(no per-section detail recorded\)/);
  });

  it("selects the failed sections rather than reporting all of them", () => {
    assert.match(source, /sectionResult\.sections\.filter\(\(section\) => section\.source === "fallback"\)/);
  });
});
