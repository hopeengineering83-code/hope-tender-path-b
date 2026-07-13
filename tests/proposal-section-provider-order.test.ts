// Regression test for a real gap: the per-section proposal generator
// (generateOneSection) and the deep-critique/rewrite pass
// (critiqueProposalWithAI / rewriteProposalWithCritique) each hand-roll
// their own provider fallback chain instead of using generateWithFallback,
// and that hand-rolled chain never attempted Z.ai or Cerebras at all —
// despite them being canonical ranks 1-2 in lib/ai-provider-catalog.cjs.
// That meant the "multi-provider resilience" story was untrue for the
// exact code path that writes the document a user downloads.
//
// generateOneSection/critiqueProposalWithAI/rewriteProposalWithCritique
// call real provider HTTP endpoints and are not easily unit-testable
// without live keys, so this pins the fix at the source-text level: Z.ai
// and Cerebras must now be checked, and checked before every other
// provider tier, in all three functions.

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

  it("critiqueProposalWithAI tries Z.ai and Cerebras before OpenAI/Gemini/Mistral/DeepSeek/Claude", () => {
    const body = sliceFunction("critiqueProposalWithAI").split("export async function rewriteProposalWithCritique")[0];
    const zaiIdx = body.indexOf("isZaiEnabled()");
    const cerebrasIdx = body.indexOf("isCerebrasEnabled()");
    const openaiIdx = body.indexOf("isOpenAIEnabled()");

    assert.ok(zaiIdx >= 0, "critiqueProposalWithAI must check isZaiEnabled()");
    assert.ok(cerebrasIdx >= 0, "critiqueProposalWithAI must check isCerebrasEnabled()");
    assert.ok(zaiIdx < cerebrasIdx && cerebrasIdx < openaiIdx, "Z.ai then Cerebras must be attempted before OpenAI");
  });

  it("rewriteProposalWithCritique tries Z.ai and Cerebras before OpenAI/Gemini/Mistral/DeepSeek/Claude", () => {
    const start = src.indexOf("export async function rewriteProposalWithCritique");
    assert.ok(start >= 0);
    const body = src.slice(start, start + 4000);
    const zaiIdx = body.indexOf("isZaiEnabled()");
    const cerebrasIdx = body.indexOf("isCerebrasEnabled()");
    const openaiIdx = body.indexOf("isOpenAIEnabled()");

    assert.ok(zaiIdx >= 0, "rewriteProposalWithCritique must check isZaiEnabled()");
    assert.ok(cerebrasIdx >= 0, "rewriteProposalWithCritique must check isCerebrasEnabled()");
    assert.ok(zaiIdx < cerebrasIdx && cerebrasIdx < openaiIdx, "Z.ai then Cerebras must be attempted before OpenAI");
    assert.ok(body.includes('lastProposalProvider = "zai"'));
    assert.ok(body.includes('lastProposalProvider = "cerebras"'));
  });
});
