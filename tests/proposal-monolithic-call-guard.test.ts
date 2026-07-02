// Hard regression guard: proposal generation must stay SECTION-BASED on Vercel
// Hobby and must never issue a monolithic 16K-token proposal call.
//
// The registry's STANDARD_CAPS.proposal is 16000 (used by the legacy single-
// call escape hatch on higher tiers), so this test proves:
//   1. the DEFAULT generation mode is the parallel/section path, not single;
//   2. every per-section output-token budget is well under 16000;
//   3. each section call passes a bounded per-section budget (never a 16K const).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SECTION_BUDGET_CEILING = 12_000; // any single section must stay well under 16K

describe("proposal generation stays section-based (no monolithic 16K call)", () => {
  it("defaults to the parallel (section-based) generation mode", () => {
    const src = readFileSync("lib/engine/generate-elite.ts", "utf8");
    assert.match(src, /PROPOSAL_GENERATION_MODE\s*\|\|\s*"parallel"/);
    assert.match(src, /generateProposalSectionsParallel\(aiInput\)/);
  });

  it("every per-section output-token budget is well under 16000", () => {
    const src = readFileSync("lib/engine/proposal-sections.ts", "utf8");
    // Extract every numeric budget assigned to cover/ab/c/d/drillDown in both
    // tierBudget() and chunkedTierBudget().
    const budgetNumbers = [
      ...src.matchAll(/\b(?:cover|ab|c|d|drillDown):\s*(?:deep\s*\?\s*)?(\d{3,})/g),
    ].map((m) => Number(m[1]));
    assert.ok(budgetNumbers.length >= 8, `expected to find section budget values, found ${budgetNumbers.length}`);
    for (const n of budgetNumbers) {
      assert.ok(n < 16000, `per-section budget ${n} must be < 16000 (monolithic-call guard)`);
      assert.ok(n <= SECTION_BUDGET_CEILING, `per-section budget ${n} exceeds the safe ceiling ${SECTION_BUDGET_CEILING}`);
    }
  });

  it("section generator passes the bounded per-section budget (never a 16K constant)", () => {
    const src = readFileSync("lib/ai.ts", "utf8");
    const fn = src.match(/async function generateOneSection[\s\S]*?\n}\n/);
    assert.ok(fn, "generateOneSection not found");
    const body = fn![0];
    // Each provider call inside section generation uses spec.maxOutputTokens
    // (with a bounded 4096 fallback) — not a 16000 literal.
    assert.match(body, /spec\.maxOutputTokens \?\? 4096/);
    assert.doesNotMatch(body, /16000|16_000/);
  });

  it("the registry proposal cap (16K) is only reachable on the gated single-call path", () => {
    // The single-call path exists only as an escape hatch behind
    // PROPOSAL_GENERATION_MODE=single; it is never the default.
    const src = readFileSync("lib/engine/generate-elite.ts", "utf8");
    assert.match(src, /useParallel\s*\n?\s*\?\s*generateProposalSectionsParallel/);
    assert.match(src, /:\s*generateBenchmarkProposalWithAI/);
    // And the default ternary resolves to parallel.
    assert.match(src, /const useParallel = generationMode === "parallel"/);
  });

  it("all direct section regeneration paths pass the bounded per-section budget", () => {
    const route = readFileSync("app/api/tenders/[id]/regenerate-section/route.ts", "utf8");
    const engine = readFileSync("lib/engine/sectioned-generation-engine.ts", "utf8");
    for (const source of [route, engine]) {
      assert.match(source, /generateWithFallback/);
      assert.match(source, /useCase:\s*"proposal"/);
      assert.match(source, /maxOutputTokens:\s*spec\.maxOutputTokens \?\? 4096/);
    }
  });
});
