// Regression test for a real gap: the per-section proposal generator
// (generateOneSection) and the deep-critique/rewrite pass
// (critiqueProposalWithAI / rewriteProposalWithCritique) each used to
// hand-roll their own provider fallback chain instead of using
// generateWithFallback, and that hand-rolled chain never attempted Z.ai or
// Cerebras at all — despite them being canonical ranks 1-2 in
// lib/ai-provider-catalog.cjs. That meant the "multi-provider resilience"
// story was untrue for the exact code path that writes the document a
// user downloads.
//
// generateOneSection keeps a hand-rolled per-provider Promise.race chain
// (it needs a structured SectionResult with per-provider timeouts, unlike
// the other two), so its order is still pinned at the source-text level.
// critiqueProposalWithAI and rewriteProposalWithCritique now delegate
// entirely to generateWithFallback — the single canonical iterator in
// lib/ai.ts — instead of duplicating provider order, so this test verifies
// delegation rather than re-checking isZaiEnabled()/isCerebrasEnabled()
// calls that no longer exist in those two functions.
//
// generateOneSection/critiqueProposalWithAI/rewriteProposalWithCritique
// call real provider HTTP endpoints and are not easily unit-testable
// without live keys, so this pins the fix at the source-text level.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const src = readFileSync(path.join(process.cwd(), "lib/ai.ts"), "utf8");

function sliceFunction(name: string): string {
  const start = src.indexOf(`function ${name}`);
  assert.ok(start >= 0, `${name} must exist in lib/ai.ts`);
  // Slice to the next top-level "async function " or "export " after this
  // point as a cheap function-body boundary — good enough for order checks.
  const next = src.indexOf("\nasync function ", start + 20);
  const end = next > start ? next : start + 10000;
  return src.slice(start, end);
}

describe("every proposal path derives its provider order from one place", () => {
  // This block used to assert the opposite, and in doing so kept the defect
  // alive. It required generateOneSection to contain `isZaiEnabled()` before
  // `isCerebrasEnabled()` before the Gemini check — pinning BOTH a hand-rolled
  // chain and an order that had since been superseded. The owner's chain leads
  // with Gemini and places Z.ai fourth, so a test enforcing "Z.ai first" made
  // the correct order impossible to adopt: fixing the code would have failed
  // the suite.
  //
  // Worth stating plainly, because it is the general lesson: a test that pins
  // an implementation's SHAPE rather than its PROPERTY becomes an argument for
  // keeping the shape. The property here is "one order, defined once".

  it("generateOneSection resolves the chain at call time instead of hand-rolling it", () => {
    const body = sliceFunction("generateOneSection");
    assert.match(
      body,
      /for \(const provider of getAutomaticProviderOrder\(\)\)/,
      "per-section generation must walk the canonical order",
    );
    assert.match(
      body,
      /callProvider\(provider,/,
      "…and dispatch through the shared adapter, not per-provider helpers",
    );
  });

  it("names no provider in generateOneSection's routing", () => {
    // The strongest available statement that the order is not duplicated here:
    // the function should not mention a specific provider at all, except for
    // the one label mapping kept for historical records.
    const body = sliceFunction("generateOneSection");
    for (const helper of [
      "isZaiEnabled()", "isCerebrasEnabled()", "isMistralEnabled()",
      "isGroqEnabled()", "isOpenRouterEnabled()", "isOpenAIEnabled()",
      "isTogetherEnabled()", "isDeepSeekEnabled()", "isClaudeEnabled()",
      "generateWithZai(", "generateWithCerebras(", "generateWithClaude(",
      "generateWithBestModel(",
    ]) {
      assert.ok(
        !body.includes(helper),
        `generateOneSection must not reach for ${helper} — that is a second chain`,
      );
    }
  });

  it("still bounds each section's output budget", () => {
    // The per-section cap is what keeps four concurrent calls inside the
    // serverless timeout. Routing through the shared adapter must not silently
    // adopt the whole-proposal budget, which is up to 16K tokens.
    //
    // The bound is now the MINIMUM of the section's own cap and what preflight
    // says the chosen provider can emit, which is strictly tighter. The
    // section cap must still appear — dropping it in favour of the provider's
    // headroom would let a generous provider pull one section past its share
    // of the concurrent budget.
    const body = sliceFunction("generateOneSection");
    assert.match(body, /maxOutputTokens: Math\.min\(spec\.maxOutputTokens \?\? 4096, preflight\.maxOutputTokens/);
  });

  it("keeps Anthropic last, by position in the order rather than by a special case", () => {
    const { getAutomaticProviderOrder } = require("../lib/ai-provider-registry");
    const order = getAutomaticProviderOrder();
    assert.equal(order[order.length - 1], "anthropic");
  });

  it("critiqueProposalWithAI delegates to generateWithFallback (the canonical iterator) for the proposal useCase", () => {
    const body = sliceFunction("critiqueProposalWithAI").split("export async function rewriteProposalWithCritique")[0];
    assert.ok(body.includes('generateWithFallback(prompt, {'), "critiqueProposalWithAI must call the shared canonical iterator");
    assert.ok(body.includes('useCase: "proposal"'), "must use the proposal useCase so providerChainForUseCase returns the full canonical order");
    // No duplicated per-provider branch logic — Z.ai/Cerebras/OpenAI etc. are
    // now ALL handled inside generateWithFallback, not re-checked here.
    assert.ok(!body.includes("isZaiEnabled()"), "must NOT duplicate isZaiEnabled() — generateWithFallback owns that check now");
    assert.ok(!body.includes("isCerebrasEnabled()"), "must NOT duplicate isCerebrasEnabled() — generateWithFallback owns that check now");
  });

  it("rewriteProposalWithCritique delegates to generateWithFallback (the canonical iterator) for the proposal useCase", () => {
    const start = src.indexOf("export async function rewriteProposalWithCritique");
    assert.ok(start >= 0);
    const body = src.slice(start, start + 4000);
    assert.ok(body.includes('generateWithFallback(prompt, {'), "rewriteProposalWithCritique must call the shared canonical iterator");
    assert.ok(body.includes('useCase: "proposal"'), "must use the proposal useCase so providerChainForUseCase returns the full canonical order");
    assert.ok(!body.includes("isZaiEnabled()"), "must NOT duplicate isZaiEnabled() — generateWithFallback owns that check now");
    assert.ok(!body.includes("isCerebrasEnabled()"), "must NOT duplicate isCerebrasEnabled() — generateWithFallback owns that check now");
    assert.ok(body.includes("onProviderUsed"), "must track which provider was actually used via generateWithFallback's onProviderUsed hook");
  });
});
