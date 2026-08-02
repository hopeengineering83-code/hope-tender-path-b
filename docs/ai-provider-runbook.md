# AI Provider Operator Runbook

Operational guide for the AI provider architecture. The single source of truth
for provider identity, order, and configuration is the authoritative registry
`lib/ai-provider-registry.ts` (`CANONICAL_AI_PROVIDER_ORDER`).

## Canonical order

```
Z.ai GLM → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Anthropic/Claude → deterministic draft fallback
```

The first five are the currently-working providers. Anthropic/Claude is the
last-resort, emergency-only provider. The deterministic draft fallback is NOT
an AI provider and its output can never pass final proposal export gates.

## Environment variables (set in Vercel → Settings → Environment Variables)

| Provider | API key | Base URL (optional) | Models (optional) |
| --- | --- | --- | --- |
| Z.ai GLM | `ZAI_API_KEY` | `ZAI_BASE_URL` (default `https://api.z.ai/api/paas/v4`) | `ZAI_PROPOSAL_MODEL` / `ZAI_ANALYSIS_MODEL` / `ZAI_FAST_MODEL` (default `glm-4.7-flash`) |
| Cerebras | `CEREBRAS_API_KEY` | `CEREBRAS_BASE_URL` (default `https://api.cerebras.ai/v1`) | `CEREBRAS_PROPOSAL_MODEL` / `CEREBRAS_ANALYSIS_MODEL` / `CEREBRAS_FAST_MODEL` (default `gpt-oss-120b`) |
| Mistral | `MISTRAL_API_KEY` | `MISTRAL_BASE_URL` | `MISTRAL_PROPOSAL_MODEL` / `MISTRAL_ANALYSIS_MODEL` / `MISTRAL_FAST_MODEL` |
| Groq | `GROQ_API_KEY` | `GROQ_BASE_URL` | `GROQ_PROPOSAL_MODEL` |
| OpenRouter | `OPENROUTER_API_KEY` | `OPENROUTER_BASE_URL` | `OPENROUTER_PROPOSAL_MODEL` — **must end in `:free`** |
| Gemini | `GEMINI_API_KEY` | — | `GEMINI_MODEL` / `GEMINI_ANALYSIS_MODEL` |
| OpenAI | `OPENAI_API_KEY` | `OPENAI_BASE_URL` | `OPENAI_PROPOSAL_MODEL` |
| Together | `TOGETHER_API_KEY` | `TOGETHER_BASE_URL` | `TOGETHER_PROPOSAL_MODEL` / `TOGETHER_ANALYSIS_MODEL` / `TOGETHER_FAST_MODEL` |
| DeepSeek | `DEEPSEEK_API_KEY` | `DEEPSEEK_BASE_URL` | `DEEPSEEK_PROPOSAL_MODEL` |
| Anthropic | `ANTHROPIC_API_KEY` | — | `ANTHROPIC_PROPOSAL_MODELS` |

Optional: `AI_MAX_PROVIDER_ATTEMPTS` (default `3`) caps actual outbound attempts
per request/chunk.

Never paste real keys into git. Set them only in the Vercel dashboard.

## Vercel Hobby attempt budget

- Max **3 actual outbound provider attempts** per request or AI Analyze chunk.
- Skipped providers (unconfigured, cooling down, invalid OpenRouter model) do
  not consume an attempt.
- One shared deadline per route/chunk; at least 5s is reserved for error
  handling and DB state updates. Fallback providers never run in parallel.
- Invalid API keys and billing-blocked providers are never retried; rate-limit
  and transient network failures fail over to the next eligible provider.
- Budget exhausted before success → error code `ATTEMPT_BUDGET_EXHAUSTED`
  (distinct from `ALL_PROVIDERS_EXHAUSTED`).

## OpenRouter free-model policy

OpenRouter must use an explicit `:free` model. `openrouter/auto` and any
non-`:free` model are rejected (`CONFIGURATION_INVALID` / `MODEL_UNAVAILABLE`)
and the provider is skipped so no paid usage is ever created.

## Health & diagnostics

- **AI Health page / `/api/ai/health`** — shows canonical rank, configured
  status, runtime-verified status, last provider used, model used, safe last
  failure category, cooldown, and whether each provider is inactive / skipped /
  attempted. The fallback order is generated directly from the registry.
- **Admin diagnostics** — `GET /api/admin/ai-provider-health` (in-memory) and
  `GET /api/admin/provider-health` (DB-backed). `GET /api/admin/ai-provider-health/test`
  runs per-capability provider tests (ping/analysis/generation).
- **Persisted health** — `ProviderHealthSnapshot` (PostgreSQL) stores only safe
  metadata (provider, failure category, safe message, cooldown, success times).
  API keys, Authorization headers, raw provider bodies, full prompts, and full
  tender text are never persisted, logged, rendered, or returned.

### Provider health states

`NOT_CONFIGURED` · `CONFIGURED` · `CONNECTIVITY_VERIFIED` · `ANALYSIS_VERIFIED`
· `GENERATION_VERIFIED` · `RATE_LIMITED` · `UNAUTHORIZED` · `BILLING_BLOCKED` ·
`MODEL_UNAVAILABLE` · `TIMEOUT` · `NETWORK_ERROR` · `MALFORMED_RESPONSE` ·
`COOLING_DOWN` · `CONFIGURATION_INVALID` · `UNKNOWN`.

## Smoke test

After setting keys locally (never commit them), run:

```bash
node scripts/provider-smoke-test.mjs
```

It sends one small structured-analysis request per configured provider against
a synthetic tender excerpt, validates the JSON locally, and reports OK / FAILED
/ INVALID_JSON / SKIPPED per provider. It never deploys, writes to the DB, or
prints secrets.

## Common operator actions

- **A provider is rate-limited:** it cools down automatically; requests skip it
  until the window expires. No action needed unless persistent.
- **OpenRouter shows CONFIGURATION_INVALID:** set `OPENROUTER_PROPOSAL_MODEL` to
  an explicit `:free` model.
- **A provider shows UNAUTHORIZED:** the key is invalid — rotate it in Vercel.
- **Reset cooldowns after fixing a key:** `POST /api/admin/ai-provider-health`
  with `{ "reset": true }` (ADMIN only).

## Do not

- Do not add a second provider-order array anywhere — change the registry only.
- Do not add Cohere or any provider requiring a payment-card workflow.
- Do not restore monolithic 16K-token proposal calls — generation stays
  section-based.
- Do not let deterministic fallback output pass final export gates.
