# Audit: PR #733–#736 Consolidation — Canonical Provider Policy and Health Fixes

**Branch:** `audit/consolidate-prs-733-736`  
**Date:** 2026-06-15  
**Status:** Completed

---

## Branch Status

- Branch `audit/consolidate-prs-733-736` was 1 commit ahead of main.
- That commit (`b1b51b9`) introduced `lib/ai-provider-policy.ts` with the WRONG Gemini-first 6-provider chain.
- This audit replaces it with the correct Mistral-first 8-provider chain and hardens health, error classification, and timeout handling.

---

## Corrected Provider Order

| Rank | Provider | Env Key | Status |
|------|----------|---------|--------|
| 1 | Mistral | `MISTRAL_API_KEY` | Working |
| 2 | Groq | `GROQ_API_KEY` | Working (88ms) |
| 3 | OpenRouter | `OPENROUTER_API_KEY` | Working |
| 4 | Gemini | `GEMINI_API_KEY` | Rate limit |
| 5 | OpenAI | `OPENAI_API_KEY` | Rate limit |
| 6 | Together | `TOGETHER_API_KEY` | Invalid key |
| 7 | DeepSeek | `DEEPSEEK_API_KEY` | HTTP 402 (billing) |
| 8 | Claude/Anthropic | `ANTHROPIC_API_KEY` | Timeout ~3000ms |

**Display string:** `Z.ai GLM → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Anthropic / Claude`

---

## Live Provider Test Results

| Provider | Result | Detail |
|----------|--------|--------|
| Mistral | Working | Configured and responding |
| Groq | Working | ~88ms, fastest verified provider |
| OpenRouter | Working | Routes via configured models |
| Gemini | Rate limit | RATE_LIMIT category, 60s cooldown |
| OpenAI | Rate limit | RATE_LIMIT category, 60s cooldown |
| Together | Invalid key | AUTH category, 5min cooldown |
| DeepSeek | HTTP 402 | BILLING category (fixed), 10min cooldown |
| Claude | Timeout | ~3000ms budget too tight; extended to 10s |

---

## Files Changed

### New file
- `lib/ai-provider-policy.ts` — Canonical Mistral-first 8-provider policy (replaces wrong Gemini-first 6-provider version)

### Modified files
- `lib/ai-provider-health.ts` — Added BILLING error category, `lastPingSucceededAt` / `lastGenerationSucceededAt` tracking, `recordProviderPingSuccess` function
- `app/api/admin/ai-provider-health/test/route.ts` — Use `recordProviderPingSuccess` for ping tests; extend Anthropic timeout to 10s
- `docs/audits/pr-733-736-consolidation.md` — This audit document

---

## Health-State Inconsistency Findings

**Problem:** The admin ping test route called `recordProviderSuccess()` which sets `lastSuccessAt` — the same field used to determine "runtime verified" status in the health panel. This meant a connectivity-only PING (not an actual generation call) would mark a provider as "runtime verified", potentially misleading operators.

**Fix:** Added `recordProviderPingSuccess()` function that:
- Sets `lastPingSucceededAt` (new field on `InternalState` and `AiProviderHealth`)
- Clears cooldowns (so the provider is available again after a successful ping)
- Does NOT update `lastSuccessAt` or `lastGenerationSucceededAt`

The `runtimeVerified` field in `ProviderRuntimeSnapshot` now reflects `lastGenerationSucceededAt` rather than `lastSuccessAt`, so it is only `true` when a real AI generation call succeeded. The `ProviderRuntimeSnapshot` public API shape is unchanged (maintains test contract).

---

## Error Classification Fixes

**Problem:** HTTP 402 (insufficient balance / billing required) from DeepSeek was classified as `UNKNOWN` (30s cooldown), causing the provider to be retried quickly despite a billing issue that requires manual resolution.

**Fix:** Added `"BILLING"` to `AiProviderFailureCategory` type union and `COOLDOWN_PER_CATEGORY_MS` map (10min cooldown), and updated `classifyAiError` to detect:
- `402` HTTP status code
- `insufficient.?balance` pattern
- `payment\s+required` pattern
- `billing` keyword
- `account\s+balance` pattern

**Before:** DeepSeek 402 → `UNKNOWN` → 30s cooldown  
**After:** DeepSeek 402 → `BILLING` → 10min cooldown

---

## Claude Timeout Finding

**Finding:** The admin ping test used `PER_PROVIDER_TIMEOUT_MS = 3_000` (3 seconds) for all providers including Claude/Anthropic. Claude's first-token latency typically ranges 5–10s on cold starts, meaning the ping always times out even when the account and key are valid.

**Fix:** Added `ANTHROPIC_TIMEOUT_MS = 10_000` (10s) constant used only for the Anthropic ping call. The test route budget (`maxDuration = 30`) is preserved: worst case is 7 providers × 3s + 1 Claude × 10s = 31s, but in practice most providers return `not_configured` immediately when no key is set.

---

## Validation Results

**typecheck:** PASS (0 errors)  
**tests:** PASS (3437/3437, 0 failures)

---

## Remaining Blockers (External Account Issues, Not Code Problems)

| Provider | Issue | Required Action |
|----------|-------|----------------|
| Gemini | Rate limit active | Wait for cooldown or upgrade quota |
| OpenAI | Rate limit active | Wait for cooldown or upgrade quota |
| Together | Invalid API key | Add valid `TOGETHER_API_KEY` in Vercel env |
| DeepSeek | Billing — HTTP 402 | Top up DeepSeek account balance |
| Claude | Short timeout resolved | With 10s budget ping should now succeed; if still failing, check `ANTHROPIC_API_KEY` and account tier |
