# AI Provider Operator Runbook

Operational guide for the AI provider architecture. The single source of truth
for provider identity, order, and configuration is `lib/ai-provider-catalog.cjs`
(`CANONICAL_AI_PROVIDER_ORDER`), re-exported by `lib/ai-provider-registry.ts`.
The order printed below is checked against that catalog by
`tests/ai-provider-doc-drift.test.ts`.

## Canonical order

```
Gemini → Groq → Mistral → Z.ai GLM → Cerebras → OpenRouter → OpenAI → Together → DeepSeek → Anthropic/Claude → deterministic draft fallback
```

Every configured provider participates automatically in this order — there is no
free-only routing mode, no minimum number of free providers, and no exclusion of
paid providers. Configured model identifiers are used exactly as given.
Anthropic/Claude is the last-resort, emergency-only provider. The deterministic
draft fallback is NOT an AI provider and its output can never pass final
proposal export gates.

## Environment variables (set in Vercel → Settings → Environment Variables)

| Provider | API key | Base URL (optional) | Models (optional) |
| --- | --- | --- | --- |
| Gemini | `GEMINI_API_KEY` | — | `GEMINI_MODEL` / `GEMINI_ANALYSIS_MODEL` (default `gemini-2.5-flash`) / `GEMINI_EXTRACTION_MODEL` (fast default `gemini-2.0-flash`) |
| Groq | `GROQ_API_KEY` | `GROQ_BASE_URL` | `GROQ_PROPOSAL_MODEL` (no default — must be set) |
| Mistral | `MISTRAL_API_KEY` | `MISTRAL_BASE_URL` | `MISTRAL_PROPOSAL_MODEL` / `MISTRAL_ANALYSIS_MODEL` / `MISTRAL_FAST_MODEL` |
| Z.ai GLM | `ZAI_API_KEY` | `ZAI_BASE_URL` (default `https://api.z.ai/api/paas/v4`) | `ZAI_PROPOSAL_MODEL` / `ZAI_ANALYSIS_MODEL` / `ZAI_FAST_MODEL` (default `glm-4.7-flash`) |
| Cerebras | `CEREBRAS_API_KEY` | `CEREBRAS_BASE_URL` (default `https://api.cerebras.ai/v1`) | `CEREBRAS_PROPOSAL_MODEL` / `CEREBRAS_ANALYSIS_MODEL` / `CEREBRAS_FAST_MODEL` (default `gpt-oss-120b`) |
| OpenRouter | `OPENROUTER_API_KEY` | `OPENROUTER_BASE_URL` | `OPENROUTER_PROPOSAL_MODEL` — no default; set it explicitly. No `:free` requirement |
| OpenAI | `OPENAI_API_KEY` | `OPENAI_BASE_URL` | `OPENAI_PROPOSAL_MODEL` |
| Together | `TOGETHER_API_KEY` | `TOGETHER_BASE_URL` | `TOGETHER_PROPOSAL_MODEL` / `TOGETHER_ANALYSIS_MODEL` / `TOGETHER_FAST_MODEL` |
| DeepSeek | `DEEPSEEK_API_KEY` | `DEEPSEEK_BASE_URL` | `DEEPSEEK_PROPOSAL_MODEL` |
| Anthropic | `ANTHROPIC_API_KEY` | — | `ANTHROPIC_PROPOSAL_MODELS` |

Optional: `AI_MAX_PROVIDER_ATTEMPTS` (default `10`, i.e. the whole canonical
chain) caps actual outbound attempts per request/chunk. Lowering it means a
request can report exhaustion with eligible providers still untried.

Never paste real keys into git. Set them only in the Vercel dashboard.

## Outbound attempt budget

- Up to **10 actual outbound provider attempts** per request or AI Analyze
  chunk — the full canonical chain, so that "everything failed" is reported as
  a genuine outage (`ALL_PROVIDERS_EXHAUSTED`) rather than as a self-imposed
  budget limit that left eligible providers untried.
- Skipped providers (unconfigured, cooling down) do not consume an attempt.
- One shared deadline per route/chunk; at least 5s is reserved for error
  handling and DB state updates, and every adapter aborts at `min(its static
  timeout, time left before the deadline)`. Fallback providers never run in
  parallel.
- Invalid API keys and billing-blocked providers are never retried; rate-limit
  and transient network failures fail over to the next eligible provider.
- `ATTEMPT_BUDGET_EXHAUSTED` is raised only when the shared deadline hits
  mid-chain, not in the normal exhaustion case.

## OpenRouter model policy

OpenRouter has no default model and the app never guesses one — set
`OPENROUTER_PROPOSAL_MODEL` / `OPENROUTER_ANALYSIS_MODEL` /
`OPENROUTER_FAST_MODEL` explicitly. There is **no `:free` suffix requirement**;
the configured model is the model that is sent, so choose one the account is
entitled to. A key with no configured model is treated as not configured.

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
- **OpenRouter shows CONFIGURATION_INVALID:** no model is configured. Set
  `OPENROUTER_PROPOSAL_MODEL` (and the analysis/fast variants) to an explicit
  model the account can call.
- **A provider shows UNAUTHORIZED:** the key is invalid — rotate it in Vercel.
- **Reset cooldowns after fixing a key:** `POST /api/admin/ai-provider-health`
  with `{ "reset": true }` (ADMIN only).

## Do not

- Do not add a second provider-order array anywhere — change the registry only.
- Do not add Cohere or any provider requiring a payment-card workflow.
- Do not restore monolithic 16K-token proposal calls — generation stays
  section-based.
- Do not let deterministic fallback output pass final export gates.
