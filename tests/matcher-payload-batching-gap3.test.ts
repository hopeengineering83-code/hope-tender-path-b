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

  // This assertion used to require the literal source of a fixed-stride loop —
  // `i += MAX_CANDIDATES_PER_MATCHER_BATCH` — which pinned the defect as if it
  // were the requirement. A batch of 20 measured 9,097 input tokens against a
  // 6,397-token budget, so Groq refused every EXPERT batch on the exact head
  // while this test stayed green. The requirement is that payloads are BOUNDED
  // and batched, which is what "Gap 3" means; the bound is the provider budget,
  // not a candidate count.
  it("aiRematchExperts sizes each batch to the provider budget", () => {
    const idx = matcher.indexOf("async function aiRematchExpertsImpl(");
    assert.ok(idx > -1, "aiRematchExpertsImpl must exist (the exported name is a thin runAsAdvisory wrapper; the batching lives in the impl)");
    const region = matcher.slice(idx, idx + 2000);
    assert.match(region, /matcherBatchSizing\(buildExpertPrompt, opts\.candidates\)/);
    assert.match(region, /largestFittingBatch\(/);
    assert.match(region, /i \+= batch\.length;/);
    assert.doesNotMatch(region, /i \+= MAX_CANDIDATES_PER_MATCHER_BATCH/);
    // Each batch is still a separate generateWithFallback call.
    assert.match(region, /generateWithFallback\(buildExpertPrompt\(batch\)/);
  });

  it("aiRematchProjects sizes each batch to the provider budget", () => {
    const idx = matcher.indexOf("async function aiRematchProjectsImpl(");
    assert.ok(idx > -1, "aiRematchProjectsImpl must exist (the exported name is a thin runAsAdvisory wrapper; the batching lives in the impl)");
    const region = matcher.slice(idx, idx + 2000);
    assert.match(region, /matcherBatchSizing\(buildProjectPrompt, opts\.candidates\)/);
    assert.match(region, /largestFittingBatch\(/);
    assert.match(region, /i \+= batch\.length;/);
    assert.doesNotMatch(region, /i \+= MAX_CANDIDATES_PER_MATCHER_BATCH/);
    assert.match(region, /generateWithFallback\(buildProjectPrompt\(batch\)/);
  });

  it("returns partial results if a later batch fails but an earlier batch succeeded", () => {
    const idx = matcher.indexOf("async function aiRematchExpertsImpl(");
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
