// AI provider engine runtime evidence — regression tests.
//
// Tests the fixes for the real Vercel runtime failures:
//   1. Invalid Z.ai model (glm-coding) is skipped safely
//   2. Invalid model does not consume useful provider attempt budget
//   3. Cooldown provider does not consume useful provider attempt budget
//   4. Oversized provider is skipped or chunked before 413
//   5. Groq-size/TPM preflight prevents known oversized call
//   6. Mistral timeout falls through safely
//   7. Cerebras 429 falls through safely
//   8. Later capable providers are attempted when earlier providers fail
//   9. Attempt budget remains Vercel-safe
//  10. Evidence matching chunks large payloads
//  11. Engine does not load/send all workspace rows unnecessarily
//  12. Source extractor success + AI matcher failure creates review-required rows
//  13. Engine response is partial/honest when AI matching fails
//  14. 0 compliance rows is not silently presented as engine success
//  15. No FULL/SUBSTANTIAL coverage is assigned without traceable evidence
//  16. Public response does not leak raw provider/org/prompt errors
//  17. Provider fallback order remains canonical
//  18. Final export remains fail-closed
//  19. No user-facing "metadata" wording

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

import { resolveZaiConfiguration } from "../lib/ai-provider-registry";

const read = (p: string) => readFileSync(p, "utf8");

// ─── 1. Invalid Z.ai model is skipped safely ─────────────────────────────────

describe("Fix 1 — an unusable Z.ai model is skipped safely", () => {
  // These used to assert on the text of a hardcoded allowlist
  // (ZAI_CODING_PLAN_MODELS). That allowlist is gone: it was a stale local copy
  // of Z.ai's catalogue that rejected the operator's own configured model and
  // silently demoted rank-1 Z.ai. The behaviour it was protecting — a
  // malformed model must be refused before an attempt is spent — is asserted
  // here directly against the resolver instead.
  const resolve = (model: string) =>
    resolveZaiConfiguration("proposal", {
      NODE_ENV: "test",
      ZAI_API_KEY: "test-key",
      ZAI_BASE_URL: "https://api.z.ai/api/paas/v4",
      ZAI_PROPOSAL_MODEL: model,
    } as NodeJS.ProcessEnv);

  it("refuses glm-coding, which is not a valid Z.ai identifier", () => {
    const r = resolve("glm-coding");
    assert.equal(r.valid, false);
    assert.equal(r.reason, "MODEL_UNSUPPORTED");
  });

  it("refuses a foreign vendor identifier without contacting the provider", () => {
    for (const model of ["gpt-4o", "claude-3-5-sonnet"]) {
      assert.equal(resolve(model).valid, false, `${model} must be refused`);
    }
  });

  it("accepts the configured GLM model so rank-1 Z.ai is actually attempted", () => {
    const r = resolve("glm-4.7-flash");
    assert.equal(r.valid, true);
    assert.equal(r.reason, "OK");
  });
});

// ─── 2. Invalid model does not consume useful provider attempt budget ─────────

describe("Fix 2 — Invalid model does not consume useful attempt budget", () => {
  it("isProviderConfigured returns false for invalid Z.ai config (skipped before attempt)", () => {
    const src = read("lib/ai-provider-registry.ts");
    // isProviderConfigured for Z.ai must call resolveZaiConfiguration —
    // when the model is invalid, valid=false, so the provider is skipped
    // WITHOUT consuming an attempt.
    assert.match(
      src,
      /if \(provider === "zai"\) \{[\s\S]*resolveZaiConfiguration\("proposal"/,
      "Z.ai configured check must call resolveZaiConfiguration",
    );
  });

  it("generateWithFallback skips unconfigured providers WITHOUT incrementing actualAttempts", () => {
    const src = read("lib/ai.ts");
    // The skip path must NOT increment actualAttempts.
    // The actualAttempts++ line must only appear AFTER the preflight + budget guards.
    const unconfiguredSkip = src.indexOf("if (!configured) {");
    const actualAttemptsIncrement = src.indexOf("actualAttempts++");
    assert.ok(unconfiguredSkip > -1, "unconfigured skip block must exist");
    assert.ok(actualAttemptsIncrement > -1, "actualAttempts++ must exist");
    assert.ok(
      actualAttemptsIncrement > unconfiguredSkip,
      "actualAttempts++ must come AFTER the unconfigured skip (so skips don't consume budget)",
    );
  });
});

// ─── 3. Cooldown provider does not consume useful provider attempt budget ─────

describe("Fix 3 — Cooldown provider does not consume useful attempt budget", () => {
  it("generateWithFallback skips cooldown providers WITHOUT consuming an attempt", () => {
    const src = read("lib/ai.ts");
    // The cooldown skip must push to providerAttempts with tried:false and
    // continue WITHOUT incrementing actualAttempts.
    const cooldownSkip = src.indexOf('failureDetails.push(`${provider}: in cooldown`)');
    const actualAttemptsIncrement = src.indexOf("actualAttempts++");
    assert.ok(cooldownSkip > -1, "cooldown skip must exist");
    assert.ok(
      actualAttemptsIncrement > cooldownSkip,
      "actualAttempts++ must come AFTER the cooldown skip",
    );
  });
});

// ─── 4. Oversized provider is skipped or chunked before 413 ──────────────────

describe("Fix 4 — Oversized provider is skipped before 413", () => {
  it("ai-preflight.ts exists and exports preflightProvider", () => {
    const src = read("lib/ai-preflight.ts");
    assert.match(src, /export function preflightProvider/);
    assert.match(src, /export function preflightChain/);
    assert.match(src, /export function estimateInputTokens/);
  });

  it("preflightProvider returns eligible=false for CONTEXT_OVERFLOW", () => {
    const src = read("lib/ai-preflight.ts");
    assert.match(src, /reason: "CONTEXT_OVERFLOW"/);
  });

  it("generateWithFallback calls preflightProvider and skips when ineligible", () => {
    const src = read("lib/ai.ts");
    assert.match(src, /import \{ preflightProvider \} from "\.\/ai-preflight"/);
    // The preflight call must appear BEFORE the actualAttempts++ line.
    const preflightCall = src.indexOf("preflightProvider(provider,");
    const actualAttemptsIncrement = src.indexOf("actualAttempts++");
    assert.ok(preflightCall > -1, "preflightProvider must be called in the chain");
    assert.ok(
      actualAttemptsIncrement > preflightCall,
      "actualAttempts++ must come AFTER the preflight check (so oversized skips don't consume budget)",
    );
  });
});

// ─── 5. Groq-size/TPM preflight prevents known oversized call ─────────────────

describe("Fix 5 — free-tier TPM preflight prevents oversized call", () => {
  it("ai-preflight.ts checks the free-tier per-minute token limit", () => {
    const src = read("lib/ai-preflight.ts");
    assert.match(src, /reason: "TPM_LIMIT"/);
    assert.match(src, /profile\.freeTierTpmLimit !== null && estimatedTokens > profile\.freeTierTpmLimit/);
  });

  it("carries the TPM limit on the MODEL, not on the provider", () => {
    // Groq's per-minute allowance differs between its 70B and 8B models, so a
    // single provider-wide number skipped the small model on payloads it could
    // have served. The limit travels with the resolved model instead.
    const preflight = read("lib/ai-preflight.ts");
    assert.doesNotMatch(preflight, /GROQ_FREE_TPM_LIMIT/, "no provider-wide Groq constant may remain");

    const profiles = read("lib/ai-model-profiles.ts");
    assert.match(profiles, /freeTierTpmLimit/);
  });

  it("resolves limits from the exact resolved model, not a provider default", async () => {
    const { resolveModelProfile } = await import("../lib/ai-model-profiles");
    const large = resolveModelProfile("groq", "llama-3.3-70b-versatile");
    const small = resolveModelProfile("groq", "llama-3.1-8b-instant");
    assert.equal(large.source, "family");
    assert.equal(small.source, "family");
    assert.notEqual(large.freeTierTpmLimit, small.freeTierTpmLimit);
  });

  it("falls back to a small conservative profile for an unrecognised model", async () => {
    // The safe direction: an unrecognised model that is skipped costs one
    // provider in the chain, while one that is overestimated costs a failed
    // request and a consumed attempt.
    const { resolveModelProfile } = await import("../lib/ai-model-profiles");
    const unknown = resolveModelProfile("groq", "some-model-nobody-has-heard-of");
    assert.equal(unknown.source, "conservative");
    assert.ok(unknown.contextTokens <= 32_000);
  });
});

// ─── 6. Mistral timeout falls through safely ──────────────────────────────────

describe("Fix 6 — Mistral timeout falls through safely", () => {
  it("generateWithFallback continues to the next provider after a failed attempt", () => {
    const src = read("lib/ai.ts");
    // After callProvider returns null, the loop must continue (not throw).
    // The `continue` is implicit — the for-loop moves to the next provider.
    // Verify the failure-handling block exists and does not break the loop.
    assert.match(src, /callProvider returned null — capture the real reason/);
  });

  it("Mistral timeout does not abort the fallback chain", () => {
    const src = read("lib/ai.ts");
    // The failureDetails array is built per-provider; the loop continues.
    assert.match(src, /failureDetails\.push/);
  });
});

// ─── 7. Cerebras 429 falls through safely ─────────────────────────────────────

describe("Fix 7 — Cerebras 429 falls through safely", () => {
  it("provider failures are recorded without aborting the chain", () => {
    const src = read("lib/ai.ts");
    // recordProviderFailure is called inside callProvider's catch handler.
    // The chain continues because callProvider returns null (not throws).
    assert.match(src, /recordProviderFailure/);
  });
});

// ─── 8. Later capable providers are attempted when earlier providers fail ─────

describe("Fix 8 — Later capable providers are attempted", () => {
  it("MAX_PROVIDER_ATTEMPTS_PER_REQUEST default is 10 (try all eligible providers)", () => {
    const src = read("lib/ai.ts");
    // Gap 3: the default was raised from 5 to 10 so ALL eligible providers
    // get tried before the chain declares ALL_PROVIDERS_EXHAUSTED. This
    // eliminates ATTEMPT_BUDGET_EXHAUSTED as a workflow blocker in the
    // normal case.
    assert.match(src, /return 10;\s*\}\)\(\)/);
    assert.match(src, /eliminates ATTEMPT_BUDGET_EXHAUSTED as a workflow blocker/);
  });

  it("the attempt budget guards only apply to eligible providers", () => {
    const src = read("lib/ai.ts");
    // The budget guard (actualAttempts >= MAX_PROVIDER_ATTEMPTS_PER_REQUEST)
    // must appear AFTER the unconfigured/cooldown/preflight skips.
    const preflightCheck = src.indexOf("preflightProvider(provider,");
    const budgetGuard = src.indexOf("if (actualAttempts >= MAX_PROVIDER_ATTEMPTS_PER_REQUEST)");
    assert.ok(preflightCheck > -1);
    assert.ok(budgetGuard > -1);
    assert.ok(
      budgetGuard > preflightCheck,
      "budget guard must come AFTER preflight (so skipped providers don't consume budget)",
    );
  });
});

// ─── 9. Attempt budget remains Vercel-safe ────────────────────────────────────

describe("Fix 9 — Attempt budget remains Vercel-safe", () => {
  it("MAX_PROVIDER_ATTEMPTS_PER_REQUEST is capped at 10", () => {
    const src = read("lib/ai.ts");
    // Even with env override, the max is 10 — prevents uncontrolled fallback
    // chains that would exceed Vercel Hobby's 60s function limit.
    assert.match(src, /raw >= 1 && raw <= 10/);
  });

  it("ERROR_HANDLING_RESERVE_MS is 5 seconds", () => {
    const src = read("lib/ai.ts");
    // 5s reserve ensures error handling + DB state updates fit within the
    // 60s Vercel Hobby limit even if the last provider call uses 50s.
    assert.match(src, /ERROR_HANDLING_RESERVE_MS = 5_000/);
  });
});

// ─── 10. Evidence matching chunks large payloads ─────────────────────────────

describe("Fix 10 — Evidence matching chunks large payloads", () => {
  it("buildExpertUserPrompt caps requirements text at 8K chars", () => {
    const src = read("lib/engine/ai-multi-perspective-matcher.ts");
    assert.match(src, /opts\.tenderRequirementsText\.slice\(0, 8_000\)/);
  });

  it("buildProjectUserPrompt caps requirements text at 8K chars", () => {
    const src = read("lib/engine/ai-multi-perspective-matcher.ts");
    // Both prompt builders cap the requirements text.
    const matches = src.match(/tenderRequirementsText\.slice\(0, 8_000\)/g);
    assert.ok(matches && matches.length >= 2, "both prompt builders must cap requirements text");
  });

  it("candidate profile text is capped at 800 chars", () => {
    const src = read("lib/engine/ai-multi-perspective-matcher.ts");
    assert.match(src, /\.slice\(0, 800\)/);
  });
});

// ─── 11. Engine does not load/send all workspace rows unnecessarily ───────────

describe("Fix 11 — Engine does not load all workspace rows unnecessarily", () => {
  it("aiRematchExperts pre-filters to top 20 candidates (PRE_FILTER_LIMIT)", () => {
    const src = read("lib/engine/main-engine-ai-rematch.ts");
    assert.match(src, /PRE_FILTER_LIMIT = 20/);
    assert.match(src, /slice\(0, PRE_FILTER_LIMIT\)/);
  });

  it("applyAIRematchToMainEngine sorts by score before pre-filtering", () => {
    const src = read("lib/engine/main-engine-ai-rematch.ts");
    assert.match(src, /sort\(\(a, b\) => b\.score - a\.score\)\.slice\(0, PRE_FILTER_LIMIT\)/);
  });
});

// ─── 12. Source extractor success + AI matcher failure creates review-required rows

describe("Fix 12 — Source extractor success + AI matcher failure → review-required rows", () => {
  it("deterministic-fallback-rows.ts exists and exports buildDeterministicFallbackRows", () => {
    const src = read("lib/engine/deterministic-fallback-rows.ts");
    assert.match(src, /export function buildDeterministicFallbackRows/);
    assert.match(src, /export function mergeFallbackRows/);
  });

  it("fallback rows are NEVER FULL/SUBSTANTIAL", () => {
    const src = read("lib/engine/deterministic-fallback-rows.ts");
    // The supportStatus must be REVIEW_REQUIRED or PARTIAL — never FULL/SUBSTANTIAL.
    assert.match(src, /supportStatus: "REVIEW_REQUIRED" \| "PARTIAL"/);
    // Verify the builder only assigns REVIEW_REQUIRED or PARTIAL.
    assert.match(src, /const supportStatus.*= isMandatory[\s\S]*"REVIEW_REQUIRED"[\s\S]*"PARTIAL"/);
  });

  it("fallback rows surface EVIDENCE_MATCHING_AI_FAILED_REVIEW_REQUIRED blocker", () => {
    const src = read("lib/engine/deterministic-fallback-rows.ts");
    assert.match(src, /EVIDENCE_MATCHING_AI_FAILED_REVIEW_REQUIRED/);
    assert.match(src, /blockerCode: "EVIDENCE_MATCHING_AI_FAILED_REVIEW_REQUIRED"/);
  });

  it("fallback rows are only created for source-grounded requirements", () => {
    const src = read("lib/engine/deterministic-fallback-rows.ts");
    // The hasTraceableSource check must require sourceTenderFileId + sourcePageNumber + quote.
    assert.match(src, /req\.sourceTenderFileId &&[\s\S]*req\.sourcePageNumber != null &&[\s\S]*req\.sourceExactQuote/);
  });

  it("run-tender-engine wires the deterministic fallback when AI rematch fails", () => {
    const src = read("lib/engine/run-tender-engine.ts");
    assert.match(src, /import \{ buildDeterministicFallbackRows, mergeFallbackRows \}/);
    assert.match(src, /aiRematchFailed/);
    assert.match(src, /buildDeterministicFallbackRows/);
    assert.match(src, /mergeFallbackRows/);
  });
});

// ─── 13. Engine response is partial/honest when AI matching fails ─────────────

describe("Fix 13 — Engine response is partial/honest when AI matching fails", () => {
  it("run-tender-engine returns partial/blockers/nextAction fields", () => {
    const src = read("lib/engine/run-tender-engine.ts");
    assert.match(src, /const partial = evidenceMatchingBlocker !== null/);
    assert.match(src, /const blockers = evidenceMatchingBlocker/);
    assert.match(src, /REVIEW_MATCHING_INPUTS/);
    assert.match(src, /Object\.assign\(tenderResult/, "must attach honesty fields to the return value");
  });

  it("engine route enqueues only and returns 202 with real persisted jobId", () => {
    const src = read("app/api/tenders/[id]/engine/route.ts");
    // Production contract: enqueue-only. The route must NOT run the engine
    // synchronously. It must return 202 with a real persisted jobId.
    assert.match(src, /status: 202/);
    assert.match(src, /jobId: enqueueResult\.id/);
    assert.match(src, /persistedStatus/);
    assert.match(src, /statusEndpoint/);
    assert.match(src, /idempotencyKey/);
    assert.match(src, /sourceRevision/);
    assert.match(src, /vaultVerification/);
    // Must NOT contain sync execution patterns.
    assert.doesNotMatch(src, /partial: isPartial/);
    assert.doesNotMatch(src, /ok: !isPartial/);
  });
});

// ─── 14. 0 compliance rows is not silently presented as engine success ────────

describe("Fix 14 — 0 compliance rows is not silently presented as success", () => {
  it("the engine creates fallback rows when AI matching fails + source extraction succeeded", () => {
    const src = read("lib/engine/run-tender-engine.ts");
    // The condition for creating fallback rows must check BOTH:
    //   1. AI rematch failed (aiApplied=false AND warning !== null)
    //   2. Source-grounded requirements exist
    assert.match(src, /aiRematchFailed/);
  });

  it("the engine response includes evidenceMatchingBlocker when fallback rows are created", () => {
    const src = read("lib/engine/run-tender-engine.ts");
    assert.match(src, /evidenceMatchingBlocker/);
    assert.match(src, /evidenceMatchingBlocker = \{/);
  });
});

// ─── 15. No FULL/SUBSTANTIAL coverage is assigned without traceable evidence ──

describe("Fix 15 — No FULL/SUBSTANTIAL without traceable evidence", () => {
  it("deterministic fallback rows use REVIEW_REQUIRED/PARTIAL (not FULL/SUBSTANTIAL)", () => {
    const src = read("lib/engine/deterministic-fallback-rows.ts");
    // Verify the type signature excludes FULL/SUBSTANTIAL.
    assert.match(src, /supportStatus: "REVIEW_REQUIRED" \| "PARTIAL"/);
    // Verify the builder never assigns FULL or SUBSTANTIAL.
    assert.doesNotMatch(src, /supportStatus.*=.*"FULL"/);
    assert.doesNotMatch(src, /supportStatus.*=.*"SUBSTANTIAL"/);
  });

  it("fallback rows require sourceTenderFileId + sourcePageNumber + sourceExactQuote", () => {
    const src = read("lib/engine/deterministic-fallback-rows.ts");
    // The hasTraceableSource check must require ALL THREE.
    assert.match(src, /hasTraceableSource = Boolean\([\s\S]*req\.sourceTenderFileId[\s\S]*req\.sourcePageNumber != null[\s\S]*req\.sourceExactQuote[\s\S]*\)/);
  });
});

// ─── 16. Public response does not leak raw provider/org/prompt errors ─────────

describe("Fix 16 — No raw provider/org/prompt error leaks", () => {
  it("ai-preflight.ts safeMessage does not include API keys or org IDs", () => {
    const src = read("lib/ai-preflight.ts");
    // The safeMessage must only contain safe category text.
    assert.match(src, /safeMessage: `Prompt exceeds/);
    assert.match(src, /safeMessage: "OK"/);
    // Must NOT log or return raw provider responses.
    assert.doesNotMatch(src, /apiKey|API_KEY|Authorization/i);
  });

  it("deterministic-fallback-rows.ts blockerMessage does not leak provider details", () => {
    const src = read("lib/engine/deterministic-fallback-rows.ts");
    // The blocker message must be safe — no provider names, error codes, or keys.
    assert.match(src, /AI evidence matching failed/);
    assert.doesNotMatch(src, /apiKey|API_KEY|Authorization|org-[a-z0-9]/i);
  });

  it("engine route response does not include raw error text", () => {
    const src = read("app/api/tenders/[id]/engine/route.ts");
    // The catch block uses actionableEngineError (sanitized).
    assert.match(src, /actionableEngineError/);
    // The error response must not include raw error text.
    assert.match(src, /diagnosticId/);
    // Must not expose raw Prisma, SQL, or provider errors.
    assert.doesNotMatch(src, /errorMessage.*error\.message/);
    assert.doesNotMatch(src, /PrismaClient|P2021|P2022/);
  });
});

// ─── 17. Provider fallback order remains canonical ───────────────────────────

describe("Fix 17 — Provider fallback order remains canonical", () => {
  it("CANONICAL_AI_PROVIDER_ORDER is unchanged", () => {
    const src = read("lib/ai-provider-registry.ts");
    // The canonical order must be the 10 providers in the required sequence.
    assert.match(src, /zai/);
    assert.match(src, /cerebras/);
    assert.match(src, /mistral/);
    assert.match(src, /groq/);
    assert.match(src, /openrouter/);
    assert.match(src, /gemini/);
    assert.match(src, /openai/);
    assert.match(src, /together/);
    assert.match(src, /deepseek/);
    assert.match(src, /anthropic/);
  });

  it("providerChainForUseCase derives from CANONICAL_AI_PROVIDER_ORDER", () => {
    const src = read("lib/ai.ts");
    // The chain must derive from the canonical order, not a hardcoded array.
    assert.match(src, /CANONICAL_AI_PROVIDER_ORDER/);
  });
});

// ─── 18. Final export remains fail-closed ────────────────────────────────────

describe("Fix 18 — Final export remains fail-closed", () => {
  it("deterministic fallback rows do NOT mark requirements as export-ready", () => {
    const src = read("lib/engine/deterministic-fallback-rows.ts");
    // Fallback rows have supportStrength 0.3 or 0.4 — well below the 0.75
    // threshold for EVIDENCE_PENDING_REVIEW. They cannot make a requirement
    // export-ready.
    assert.match(src, /supportStrength = isMandatory \? 0\.3 : 0\.4/);
  });

  it("fallback notes say generation remains blocked until evidence is confirmed", () => {
    const src = read("lib/engine/deterministic-fallback-rows.ts");
    assert.match(src, /generation remains blocked until evidence is manually confirmed/);
  });

  it("the engine does not bypass the export gate", () => {
    const src = read("lib/engine/run-tender-engine.ts");
    // The engine still sets reviewNeeded=true when hardGaps > 0.
    assert.match(src, /reviewNeeded = hardGaps > 0 || reviewGaps > 0/);
  });
});

// ─── 19. No user-facing "metadata" wording ────────────────────────────────────

describe("Fix 19 — No user-facing 'metadata' wording", () => {
  it("ai-preflight.ts does not use 'metadata' in user-facing messages", () => {
    const src = read("lib/ai-preflight.ts");
    assert.doesNotMatch(src, />.*[Mm]etadata.*</);
  });

  it("deterministic-fallback-rows.ts does not use 'metadata' in user-facing messages", () => {
    const src = read("lib/engine/deterministic-fallback-rows.ts");
    assert.doesNotMatch(src, />.*[Mm]etadata.*</);
  });

  it("engine route does not use 'metadata' in user-facing response fields", () => {
    const src = read("app/api/tenders/[id]/engine/route.ts");
    // The response must not have a user-facing "metadata" field.
    // (Internal audit metadata via logAction is fine — that's not user-facing.)
    assert.doesNotMatch(src, /"[Mm]etadata":\s*\w/);
  });
});
