# AI provider order

This document is the canonical operator-facing description of the app's current AI provider priority. It mirrors the runtime chain defined in `lib/ai.ts` (`CANONICAL_PROVIDER_CHAIN` / `PROVIDER_CHAINS`) and the policy module `lib/ai-provider-policy.ts` (`CANONICAL_AI_PROVIDER_CHAIN`).

## Runtime provider chain

The app uses this canonical fallback order for AI analysis, extraction, proposal generation, validation, fast, and reasoning use cases:

1. Z.ai GLM
2. Cerebras
3. Mistral
4. Groq
5. OpenRouter
6. Gemini
7. OpenAI
8. Together
9. DeepSeek
10. Claude / Anthropic
11. Deterministic draft fallback — only after every configured AI provider has failed, returned no usable result, or is in cooldown. The deterministic fallback is NOT an AI provider and its output is never exportable as a final proposal.

Claude / Anthropic is intentionally the last AI provider in the chain so Anthropic rate limits do not block the app when earlier providers are configured and available. It is not "preferred"; it is a last-resort AI provider. Do not change this order unless there is an explicit product decision to reorder the AI chain.

## Preferred provider

The preferred provider is the first CONFIGURED provider in the canonical chain. For example:

- if `ZAI_API_KEY` is configured, preferred provider is `zai`;
- else if `CEREBRAS_API_KEY` is configured, preferred provider is `cerebras`;
- else if `MISTRAL_API_KEY` is configured, preferred provider is `mistral`;
- else if `GROQ_API_KEY` is configured, preferred provider is `groq`;
- else if `OPENROUTER_API_KEY` is configured, preferred provider is `openrouter`;
- else if `GEMINI_API_KEY` is configured, preferred provider is `gemini`;
- else if `OPENAI_API_KEY` is configured, preferred provider is `openai`;
- else if `TOGETHER_API_KEY` is configured, preferred provider is `together`;
- else if `DEEPSEEK_API_KEY` is configured, preferred provider is `deepseek`;
- else if `ANTHROPIC_API_KEY` is configured, preferred provider is `claude`;
- else preferred provider is `none`, and AI calls fall back to the deterministic draft fallback.

## Configured is not the same as runtime-verified

A provider can be in one of the following health states. The dashboard provider-health panel and `/api/ai/health` use these states:

- `not_configured` — the provider's required env var (e.g. `ZAI_API_KEY`) is missing or empty. The provider is skipped at runtime.
- `configured` — the key is present, but no successful runtime response has been recorded on this serverless instance yet. The provider is NOT healthy/Ready. It will be tried in the chain, but the dashboard must not display a green "Available" pill for it.
- `runtime_verified` (a.k.a. `usable`) — the provider has produced a recent successful safe runtime response (a real generation call, not just a connectivity ping). Only this state should be shown as Ready / Available / green.
- `rate_limited` — the most recent failure was a rate-limit (HTTP 429 / quota). The provider is in cooldown and is skipped until the cooldown window expires.
- `unauthorized` — the most recent failure was an auth failure (HTTP 401 / 403 / invalid API key). The provider is in cooldown; the operator needs to fix the key.
- `timeout` — the most recent failure was a request timeout or abort. The provider is in a short cooldown.
- `unavailable` — the most recent failure was a model-unavailable / billing / network error. The provider is in cooldown.
- `unknown` — the most recent failure could not be classified, or no state has been recorded yet (but the key is present). Must NOT be shown as green/healthy.

A provider card showing `Configured — not yet tested on this instance` means the key is present, but the current serverless instance has not recorded a successful runtime response yet. This is the `configured` state, NOT `runtime_verified`.

A provider becomes `runtime_verified` only after AI Analyze, proposal generation, or the provider test action records a successful provider response. Admin connectivity pings (`recordProviderPingSuccess`) clear cooldown but do NOT flip the provider to `runtime_verified` — only a real generation success (`recordProviderSuccess`) does.

The deterministic draft fallback is not a provider health state. It is the final non-AI fallback that runs only after every configured AI provider has failed or is unavailable.

## Attempt budget

Each request/chunk is capped at **3 actual outbound provider attempts** (see `MAX_PROVIDER_ATTEMPTS` in `lib/ai-provider-policy.ts`). Skipping an unconfigured or cooled-down provider does NOT consume an attempt — only real network calls do. This bounds wall-clock time per request even when the chain has 10 eligible providers.

When the budget is exhausted AND eligible providers remain untried, the error surfaces as `ATTEMPT_BUDGET_EXHAUSTED` (vs `ALL_PROVIDERS_EXHAUSTED` when every eligible provider was actually tried). The distinction lets operators tell "all configured providers are broken" apart from "the chain has more providers but we stopped at 3 to bound latency".

## OpenRouter `:free` model requirement

The OpenRouter provider only accepts models whose name ends with `:free`. The default `openrouter/auto` is **rejected** at runtime — it routes to an arbitrary model that may not be free-tier and may not support JSON mode, breaking extraction. Non-`:free` models are also rejected so the chain only uses OpenRouter's free-tier inventory (no surprise billing). Set `OPENROUTER_PROPOSAL_MODEL` to a model like `meta-llama/llama-3.3-70b-instruct:free` to make OpenRouter eligible.

## Documentation note

Older README text or comments that say "Gemini is first", "OpenAI is second", "Claude is preferred", "Mistral is first", or that imply any other ordering are stale. The live AI Health panel, `/api/ai/health` route, and `lib/ai.ts` (`CANONICAL_PROVIDER_CHAIN`) are the runtime source of truth: Z.ai is first and Claude / Anthropic remains the last AI provider, followed by the deterministic draft fallback.

Do not change provider fallback order unless there is an explicit product decision to reorder the AI chain.
