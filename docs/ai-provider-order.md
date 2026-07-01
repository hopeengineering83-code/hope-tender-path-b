# AI provider order

This document is the canonical operator-facing description of the app's current AI provider priority. The single source of truth is the authoritative registry `lib/ai-provider-registry.ts` (`CANONICAL_AI_PROVIDER_ORDER`). Every automatic fallback surface — `lib/ai.ts`, `lib/ai-provider-policy.ts`, `lib/ai-provider-health.ts`, `/api/ai/health`, admin health routes, environment checks, and the AI Health panel — derives its order from that registry. There are no separate hardcoded automatic order arrays.

## Automatic runtime provider chain

The app uses this canonical automatic fallback order for AI analysis, extraction, proposal generation, validation, fast, and reasoning use cases:

1. Gemini (`gemini`)
2. OpenRouter (`openrouter`)
3. OpenAI (`openai`)
4. Groq (`groq`)
5. DeepSeek (`deepseek`)
6. Anthropic / Claude (`anthropic`)
7. Deterministic draft fallback — only after every configured automatic AI provider has failed, returned no usable result, or is in cooldown. The deterministic fallback is NOT an AI provider and its output is never exportable as a final proposal.

Z.ai GLM (`zai`), Cerebras (`cerebras`), Mistral (`mistral`), and Together (`together`) remain available as manual diagnostics/adapters where explicitly selected, but they are not automatic fallbacks and must not satisfy automatic runtime readiness.

Anthropic / Claude is intentionally the last automatic AI provider in the chain so earlier providers are preferred. Do not change this order anywhere except in the registry.

## Vercel Hobby attempt budget

The app runs on Vercel Hobby. Per single request or AI Analyze chunk:

- A maximum of **3 actual outbound provider attempts** are made (`AI_MAX_PROVIDER_ATTEMPTS`, default 3).
- Unconfigured providers, cooled-down providers, manual-only providers, and OpenRouter with an invalid (non-`:free`) model are **skipped without consuming an attempt**.
- Only real outbound provider requests count toward the budget.
- One shared deadline applies per route/chunk; at least 5s is reserved for error handling and DB state updates, and fallback providers never run in parallel.
- Invalid API keys and billing-blocked providers are never retried; rate-limit and transient network failures fail over to the next eligible provider.
- When the budget is consumed before a provider succeeds, the error code is `ATTEMPT_BUDGET_EXHAUSTED` (distinct from `ALL_PROVIDERS_EXHAUSTED`).

## OpenRouter free-model policy

OpenRouter must use an explicit free model. `openrouter/auto` is rejected, and any model whose identifier does not end in `:free` is rejected (`CONFIGURATION_INVALID` / `MODEL_UNAVAILABLE`). The app never sends an OpenRouter request that could create paid usage; an invalid OpenRouter configuration is treated as "not configured" and skipped.

## Preferred provider

The preferred provider is the first CONFIGURED provider in the canonical automatic chain. For example:

- if `GEMINI_API_KEY` is configured, preferred provider is `gemini`;
- else if `OPENROUTER_API_KEY` is configured (with a valid `:free` model), preferred provider is `openrouter`;
- else if `OPENAI_API_KEY` is configured, preferred provider is `openai`;
- else if `GROQ_API_KEY` is configured, preferred provider is `groq`;
- else if `DEEPSEEK_API_KEY` is configured, preferred provider is `deepseek`;
- else if `ANTHROPIC_API_KEY` is configured, preferred provider is `anthropic`;
- else preferred provider is `none`, and AI calls fall back to the deterministic draft fallback.

Manual-only keys (`ZAI_API_KEY`, `CEREBRAS_API_KEY`, `MISTRAL_API_KEY`, `TOGETHER_API_KEY`) do not make a provider preferred and do not unlock automatic fallback readiness.

## Configured is not the same as runtime-verified

A provider can be in one of the following health states. The dashboard provider-health panel and `/api/ai/health` use these states:

- `not_configured` — the provider's required env var (e.g. `GEMINI_API_KEY`) is missing or empty. The provider is skipped at runtime.
- `configured` — the key is present, but no successful runtime response has been recorded on this serverless instance yet. The provider is NOT healthy/Ready. It will be tried in the chain, but the dashboard must not display a green "Available" pill for it.
- `runtime_verified` (a.k.a. `usable`) — the provider has produced a recent successful safe runtime response (a real generation call, not just a connectivity ping). Only this state should be shown as Ready / Available / green.
- `rate_limited` — the most recent failure was a rate-limit (HTTP 429 / quota). The provider is in cooldown and is skipped until the cooldown window expires.
- `unauthorized` — the most recent failure was an auth failure (HTTP 401 / 403 / invalid API key). The provider is in cooldown; the operator needs to fix the key.
- `timeout` — the most recent failure was a request timeout or abort. The provider is in a short cooldown.
- `unavailable` — the most recent failure was a model-unavailable / billing / network error. The provider is in cooldown.
- `unknown` — the most recent failure could not be classified, or no state has been recorded yet (but the key is present). Must NOT be shown as green/healthy.

A provider card showing `Configured — not yet tested on this instance` means the key is present, but the current serverless instance has not recorded a successful runtime response yet. This is the `configured` state, NOT `runtime_verified`.

A provider becomes `runtime_verified` only after AI Analyze, proposal generation, or the provider test action records a successful provider response. Admin connectivity pings (`recordProviderPingSuccess`) clear cooldown but do NOT flip the provider to `runtime_verified` — only a real generation success (`recordProviderSuccess`) does.

The deterministic draft fallback is not a provider health state. It is the final non-AI fallback that runs only after every configured automatic AI provider has failed or is unavailable.

## Documentation note

Older README text or comments that say "Z.ai is first", "Mistral is first", "Claude is preferred", or that imply any other automatic ordering are stale. The authoritative registry `lib/ai-provider-registry.ts` (`CANONICAL_AI_PROVIDER_ORDER`) is the single source of truth: Gemini is first, OpenRouter second, OpenAI third, Groq fourth, DeepSeek fifth, and Anthropic / Claude remains the last automatic AI provider, followed by the deterministic draft fallback.

Do not change provider fallback order anywhere except in the registry, and only via an explicit product decision.
