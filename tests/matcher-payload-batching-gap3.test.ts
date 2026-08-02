// Source-text contract test: matcher payloads are bounded and batched so
// Groq never receives an oversized request.
//
// Gap 3 (AI runtime) — bound and batch matcher payloads:
// The matcher (lib/engine/ai-multi-perspective-matcher.ts) now exports
// MAX_CANDIDATES_PER_MATCHER_BATCH and slices the candidate pool into
// batches of that size. Each batch is a separate generateWithFallback
// call, so no single prompt can exceed Groq's 32K context window or
// 28K free-tier TPM limit. lib/ai-preflight.ts enforces both limits
// before any provider is called — Groq is skipped WITHOUT consuming an
// attempt if the payload would 413.
//
// The upstream PRE_FILTER_LIMIT in main-engine-ai-rematch.ts is already
// 20, so this is a defensive cap. If the upstream limit is ever raised,
// MAX_CANDIDATES_PER_MATCHER_BATCH triggers batching so no single
// payload can 413 Groq.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const matcher = readFileSync("lib/engine/ai-multi-perspective-matcher.ts", "utf8");

describe("matcher payloads are bounded and batched (Gap 3)", () => {
  it("exports MAX_CANDIDATES_PER_MATCHER_BATCH = 20", () => {
    assert.match(matcher, /export const MAX_CANDIDATES_PER_MATCHER_BATCH = 20;/);
  });

  it("aiRematchExperts slices candidates into batches of MAX_CANDIDATES_PER_MATCHER_BATCH", () => {
    const idx = matcher.indexOf("export async function aiRematchExperts(");
    assert.ok(idx > -1, "aiRematchExperts must exist");
    const region = matcher.slice(idx, idx + 2000);
    assert.match(region, /for \(let i = 0; i < opts\.candidates\.length; i \+= MAX_CANDIDATES_PER_MATCHER_BATCH\)/);
    assert.match(region, /opts\.candidates\.slice\(i, i \+ MAX_CANDIDATES_PER_MATCHER_BATCH\)/);
    // Each batch is a separate generateWithFallback call.
    assert.match(region, /generateWithFallback\(buildExpertUserPrompt\(batchOpts\)/);
  });

  it("aiRematchProjects slices candidates into batches of MAX_CANDIDATES_PER_MATCHER_BATCH", () => {
    const idx = matcher.indexOf("export async function aiRematchProjects(");
    assert.ok(idx > -1, "aiRematchProjects must exist");
    const region = matcher.slice(idx, idx + 2000);
    assert.match(region, /for \(let i = 0; i < opts\.candidates\.length; i \+= MAX_CANDIDATES_PER_MATCHER_BATCH\)/);
    assert.match(region, /opts\.candidates\.slice\(i, i \+ MAX_CANDIDATES_PER_MATCHER_BATCH\)/);
    assert.match(region, /generateWithFallback\(buildProjectUserPrompt\(batchOpts\)/);
  });

  it("returns partial results if a later batch fails but an earlier batch succeeded", () => {
    const idx = matcher.indexOf("export async function aiRematchExperts(");
    const region = matcher.slice(idx, idx + 2000);
    assert.match(region, /if \(allAssessments\.length > 0\) break;/);
  });
});

describe("provider attempt budget tries all eligible providers (Gap 3)", () => {
  const ai = readFileSync("lib/ai.ts", "utf8");

  it("default MAX_PROVIDER_ATTEMPTS_PER_REQUEST is 10 (try all eligible providers)", () => {
    assert.match(ai, /return 10;\s*\}\)\(\);/);
  });

  it("eliminates ATTEMPT_BUDGET_EXHAUSTED as a workflow blocker in the normal case", () => {
    // The comment must explain that ATTEMPT_BUDGET_EXHAUSTED now fires only
    // when the shared deadline hits mid-chain, not when eligible providers
    // remain untried.
    assert.match(ai, /eliminates ATTEMPT_BUDGET_EXHAUSTED as a workflow blocker/);
    assert.match(ai, /ALL_PROVIDERS_EXHAUSTED/);
    assert.match(ai, /genuine provider/);
  });
});
