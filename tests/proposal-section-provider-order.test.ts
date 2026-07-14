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

describe("proposal-generation provider chains include Z.ai/Cerebras (canonical ranks 1-2)", () => {
  it("generateOneSection tries Z.ai and Cerebras before Gemini/OpenAI/Mistral/Together/DeepSeek/Claude", () => {
    const body = sliceFunction("generateOneSection");
    const zaiIdx = body.indexOf("isZaiEnabled()");
    const cerebrasIdx = body.indexOf("isCerebrasEnabled()");
    const geminiIdx = body.indexOf('isProviderCooledDown("gemini")');
    const openaiIdx = body.indexOf("isOpenAIEnabled()");
    const claudeIdx = body.indexOf("isClaudeEnabled()");

    assert.ok(zaiIdx >= 0, "generateOneSection must check isZaiEnabled()");
    assert.ok(cerebrasIdx >= 0, "generateOneSection must check isCerebrasEnabled()");
    assert.ok(zaiIdx < cerebrasIdx, "Z.ai must be attempted before Cerebras (canonical rank 1 before 2)");
    assert.ok(cerebrasIdx < geminiIdx, "Cerebras must be attempted before Gemini");
    assert.ok(geminiIdx < openaiIdx, "Gemini must be attempted before OpenAI (existing tuned order preserved)");
    assert.ok(openaiIdx < claudeIdx, "Claude (Anthropic) must remain last");
    assert.ok(body.includes('source: "zai"'), "a successful Z.ai section result must be labeled source: zai");
    assert.ok(body.includes('source: "cerebras"'), "a successful Cerebras section result must be labeled source: cerebras");
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
