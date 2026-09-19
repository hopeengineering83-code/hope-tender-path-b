import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ONE RULE, APPLIED EVERYWHERE A PROMPT IS SIZED.
 * ----------------------------------------------
 * A capacity decision must be taken against the bytes that will actually be
 * sent. Preflighting one string and dispatching another is how a provider gets
 * handed a request that preflight has just certified and then refuses.
 *
 * This is not theoretical. The AI Analyze planner preflighted the raw analysis
 * prompt while `generateWithFallback` sends `protectPrompt(prompt).protectedPrompt`
 * — the same text inside the trust-boundary header, two nonce fence markers and
 * a footer, costing a fixed ~198 estimated input tokens. The owner's retained
 * 12,122-character source measured 7,044 tokens raw (inside Groq's 7,088-token
 * free-tier budget, so it was certified) and 7,242 fenced. The durable AiJob
 * recorded exactly that: "groq: Prompt exceeds the configured provider
 * throughput budget (7242 input tokens)", with Groq absent from `tried:`.
 *
 * The per-section proposal writer had the same split, plus a security edge: it
 * preflighted AND dispatched `spec.userPrompt` with no fence at all, while the
 * whole-proposal path in the same file fences its prompt (audit C-3) precisely
 * because it mixes trusted application instructions with untrusted tender text,
 * evidence and project profiles. Untrusted material reached the provider able
 * to issue directives, and injection inspection never ran on it.
 *
 * These assertions read the source because the call sites are module-private.
 * They pin the shape that makes the defect impossible, not a token count.
 */

const ai = readFileSync("lib/ai.ts", "utf8");

/** The body of a named function, up to the next top-level declaration. */
function functionBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `expected to find ${signature} in lib/ai.ts`);
  const rest = source.slice(start + signature.length);
  const end = rest.search(/\n(?:export )?(?:async )?function /);
  return end >= 0 ? rest.slice(0, end) : rest;
}

describe("every provider call weighs the bytes it sends", () => {
  it("the analysis planner preflights the prompt as sent, never the bare prompt", () => {
    const planner = ai.slice(ai.indexOf("function providersEligibleForEveryChunk"), ai.indexOf("export function planAnalysisChunks"));
    assert.match(planner, /buildAnalysisPromptAsSent\(/);
    assert.doesNotMatch(
      planner,
      /preflightProvider\([^)]*buildAnalysisPrompt\(/,
      "the planner must not preflight the unfenced analysis prompt",
    );

    const single = functionBody(ai, "export function analysisChunkPreflight(");
    assert.match(single, /buildAnalysisPromptAsSent\(/);
    assert.doesNotMatch(single, /preflightProvider\([^)]*buildAnalysisPrompt\(content/);
  });

  it("the prompt-as-sent helper is the fenced prompt, not a renamed raw one", () => {
    const helper = functionBody(ai, "export function buildAnalysisPromptAsSent(");
    assert.match(helper, /protectPrompt\(/);
    assert.match(helper, /\.protectedPrompt/);
  });

  it("the per-section writer fences its prompt before it measures or sends it", () => {
    const section = functionBody(ai, "async function generateOneSection(");
    assert.match(
      section,
      /const sectionTrustBoundary = protectPrompt\(spec\.userPrompt\)/,
      "untrusted section material must be fenced, as the whole-proposal path already does",
    );
    assert.match(section, /sectionTrustBoundary\.suspicious/, "injection inspection must run on section prompts");
  });

  it("the per-section writer preflights and dispatches the SAME string", () => {
    const section = functionBody(ai, "async function generateOneSection(");

    const preflighted = section.match(/preflightProvider\(provider,\s*([A-Za-z0-9_.]+)\s*,/);
    assert.ok(preflighted, "generateOneSection must preflight before dispatch");
    const dispatched = section.match(/callProvider\(provider,\s*([A-Za-z0-9_.]+)\s*,/);
    assert.ok(dispatched, "generateOneSection must dispatch through callProvider");

    assert.equal(
      preflighted[1],
      dispatched[1],
      `preflight weighs ${preflighted[1]} but dispatch sends ${dispatched[1]} — a request can be certified and then refused`,
    );
    assert.equal(preflighted[1], "fencedSectionPrompt");

    // The raw prompt must not survive as a dispatch or sizing argument.
    assert.doesNotMatch(section, /callProvider\(provider,\s*spec\.userPrompt/);
    assert.doesNotMatch(section, /preflightProvider\(provider,\s*spec\.userPrompt/);
  });

  it("the whole-proposal path still fences, so this is one rule and not a local patch", () => {
    assert.match(ai, /const proposalTrustBoundary = protectPrompt\(prompt\)/);
    assert.match(ai, /callProvider\(provider, fencedProposalPrompt/);
  });

  it("the rule names no provider and no sector", () => {
    const section = functionBody(ai, "async function generateOneSection(");
    const fenceRegion = section.slice(section.indexOf("SECURITY + SIZING"), section.indexOf("const preflight ="));
    for (const word of ["hospital", "healthcare", "medical", "clinical", "pharo"]) {
      assert.ok(!fenceRegion.toLowerCase().includes(word), `the shared rule must not name ${word}`);
    }
  });
});
