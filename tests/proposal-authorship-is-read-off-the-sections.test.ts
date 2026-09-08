import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveDominantAuthor } from "../lib/ai";
import { CANONICAL_AI_PROVIDER_ORDER } from "../lib/ai-provider-catalog.cjs";

/**
 * The proposal's recorded author could name a provider that wrote none of it.
 *
 * The canonical chain has ten providers. The summary that set the recorded
 * author was an if-chain over four of them — claude, gemini, openai, deepseek.
 * A proposal written entirely by Groq matched no branch, and because the
 * branch that clears the variable only ran when EVERY section fell back, the
 * module-level `lastProposalProvider` kept whatever an earlier call had left
 * there. The document was then labelled with that stale provider.
 *
 * This matters now rather than in the abstract: Groq is the second provider in
 * the chain and the first that a section-sized prompt reliably fits, so it is
 * the provider most likely to author a proposal.
 */

const sections = (...sources: string[]) => sources.map((source) => ({ source }));

test("a provider outside the old four-name if-chain is recorded as the author", () => {
  for (const provider of ["groq", "mistral", "zai", "cerebras", "openrouter", "together"]) {
    assert.equal(
      resolveDominantAuthor(sections(provider, provider, provider, provider)),
      provider,
      `${provider} wrote every section but was not recorded as the author`,
    );
  }
});

test("every provider in the canonical chain can be recorded as an author", () => {
  for (const provider of CANONICAL_AI_PROVIDER_ORDER) {
    const label = provider === "anthropic" ? "claude" : provider;
    assert.equal(resolveDominantAuthor(sections(label, label)), label);
  }
});

test("the provider that wrote the most sections is the author", () => {
  assert.equal(resolveDominantAuthor(sections("groq", "groq", "groq", "gemini")), "groq");
  assert.equal(resolveDominantAuthor(sections("gemini", "groq", "gemini", "gemini")), "gemini");
});

test("a tie is broken by canonical chain order, not by iteration order", () => {
  // Gemini is first in the chain, Groq second.
  assert.equal(resolveDominantAuthor(sections("groq", "gemini")), "gemini");
  assert.equal(resolveDominantAuthor(sections("gemini", "groq")), "gemini");
  // Same result whichever order the sections happen to arrive in.
  assert.equal(resolveDominantAuthor(sections("openai", "mistral")), "mistral");
});

test("sections that fell back do not count toward authorship", () => {
  assert.equal(resolveDominantAuthor(sections("fallback", "fallback", "groq")), "groq");
});

test("a wholly deterministic proposal reports no author rather than a stale one", () => {
  assert.equal(resolveDominantAuthor(sections("fallback", "fallback", "fallback", "fallback")), null);
  assert.equal(resolveDominantAuthor([]), null);
});
