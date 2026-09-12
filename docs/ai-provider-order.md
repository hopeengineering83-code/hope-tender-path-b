# AI provider order

This document is the operator-facing description of the app's current AI provider priority. It is NOT the source of truth: `lib/ai-provider-catalog.cjs` (`CANONICAL_AI_PROVIDER_ORDER`) is, re-exported by `lib/ai-provider-registry.ts`. The numbered list below is checked against that catalog by `tests/ai-provider-doc-drift.test.ts`, so this page cannot silently disagree with the runtime again. Every other surface — `lib/ai.ts`, `lib/ai-provider-policy.ts`, `lib/ai-provider-health.ts`, `/api/ai/health`, admin health routes, environment checks, and the AI Health panel — derives its order from that registry. There are no separate hardcoded order arrays.

## Runtime provider chain

The app uses this canonical fallback order for AI analysis, extraction, proposal generation, validation, fast, and reasoning use cases:

1. Gemini (`gemini`)
2. Groq (`groq`)
3. Mistral (`mistral`)
4. Z.ai GLM (`zai`)
5. Cerebras (`cerebras`)
6. OpenRouter (`openrouter`)
7. OpenAI (`openai`)
8. Together (`together`)
9. DeepSeek (`deepseek`)
10. Anthropic / Claude (`anthropic`)
11. Deterministic draft fallback — only after every configured AI provider has failed, returned no usable result, or is in cooldown. The deterministic fallback is NOT an AI provider and its output is never exportable as a final proposal.

Every configured provider participates automatically, in this order. There is no free-only routing mode, no minimum number of free providers, and no exclusion of paid providers; configured model identifiers are used exactly as given and are never silently replaced.

Anthropic / Claude is intentionally the last AI provider in the chain (an emergency-only, last-resort provider) so Anthropic rate limits do not block the app when earlier providers are configured and available. Do not change this order anywhere except in the registry.

## Outbound attempt budget

Per single request or AI Analyze chunk:

- Up to **10 actual outbound provider attempts** are made (`AI_MAX_PROVIDER_ATTEMPTS`, default 10 — the whole canonical chain). The default is deliberately the full chain length so that "everything failed" is reported as a genuine provider outage (`ALL_PROVIDERS_EXHAUSTED`) rather than as a self-imposed budget limit that left eligible providers untried.
- Unconfigured and cooled-down providers are **skipped without consuming an attempt**.
- Only real outbound provider requests count toward the budget.
- One shared deadline applies per route/chunk; at least 5s is reserved for error handling and DB state updates, every provider adapter aborts at `min(its static timeout, time left before that deadline)`, and fallback providers never run in parallel.
- Invalid API keys and billing-blocked providers are never retried; rate-limit and transient network failures fail over to the next eligible provider.
- `ATTEMPT_BUDGET_EXHAUSTED` is therefore raised only when the shared deadline hits mid-chain, not in the normal exhaustion case.

## OpenRouter model policy

OpenRouter has no default model and the app never guesses one: set `OPENROUTER_PROPOSAL_MODEL` / `OPENROUTER_ANALYSIS_MODEL` / `OPENROUTER_FAST_MODEL` explicitly. There is **no `:free` suffix requirement** — whatever model you configure is the model that is sent, so choose one your OpenRouter account is entitled to. An OpenRouter key with no configured model is treated as not configured and skipped.

## Preferred provider

The preferred provider is the first CONFIGURED provider in the canonical chain. For example:

- if `GEMINI_API_KEY` is configured, preferred provider is `gemini`;
- else if `GROQ_API_KEY` is configured, preferred provider is `groq`;
- else if `MISTRAL_API_KEY` is configured, preferred provider is `mistral`;
- else if `ZAI_API_KEY` is configured, preferred provider is `zai`;
- else if `CEREBRAS_API_KEY` is configured, preferred provider is `cerebras`;
- else if `OPENROUTER_API_KEY` is configured (with an explicitly configured model), preferred provider is `openrouter`;
- else if `OPENAI_API_KEY` is configured, preferred provider is `openai`;
- else if `TOGETHER_API_KEY` is configured, preferred provider is `together`;
- else if `DEEPSEEK_API_KEY` is configured, preferred provider is `deepseek`;
- else if `ANTHROPIC_API_KEY` is configured, preferred provider is `anthropic`;
- else preferred provider is `none`, and AI calls fall back to the deterministic draft fallback.

## Configured is not the same as runtime-verified

A provider can be in one of the following health states. The dashboard provider-health panel and `/api/ai/health` use these states:

- `not_configured` — the provider's required env var (e.g. `MISTRAL_API_KEY`) is missing or empty. The provider is skipped at runtime.
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

## Documentation note

Older text or comments that say "Z.ai is first", "Mistral is first", "Claude is preferred", that require an OpenRouter `:free` model, that describe a zero-paid-only routing mode, that require two free providers, or that exclude paid providers from automatic routing are **stale and withdrawn**. `lib/ai-provider-catalog.cjs` (`CANONICAL_AI_PROVIDER_ORDER`) is the single source of truth: Gemini is first, Groq second, and Anthropic / Claude remains the last AI provider, followed by the deterministic draft fallback.

Historical audits and dated session logs elsewhere in `docs/` record the withdrawn policy as history. They are evidence of what was once true and are deliberately left unedited; this page and the other active operator instructions (`.env.example`, `README.md`, `docs/ai-provider-runbook.md`, `scripts/check-env.mjs`) are the current ones.

Do not change provider fallback order anywhere except in the catalog, and only via an explicit product decision.
