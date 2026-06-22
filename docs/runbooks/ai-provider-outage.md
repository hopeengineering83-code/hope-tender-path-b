# Runbook: AI Provider Outage (All Providers Down)

## When to use

Use this runbook when **every** configured AI provider is unavailable at the
same time. The Hope Tender Path app depends on at least one working provider in
the canonical chain (`Z.ai GLM → Cerebras → Mistral → Groq → OpenRouter → …`).
When the entire chain is exhausted, the app degrades to the deterministic draft
fallback, which **cannot** pass final proposal export gates.

Trigger this runbook when `/api/ai/health` returns `allProvidersCooling: true`,
`noAiProviderReady: true`, or when AI Analyze results show
`REGEX_FALLBACK_UNAPPROVED` for multiple tenders in a row.

## Symptoms

- `/api/ai/health` returns `success: false`, `ok: false`, or
  `allProvidersCooling: true`.
- `nextAction` field equals `ALL_PROVIDERS_COOLING` or `NO_AI_PROVIDER_READY`.
- AI Analyze returns `analysisSource: "REGEX_FALLBACK_UNAPPROVED"` and the
  `ai-analyze-recovery-panel` shows a fallback banner.
- `/api/admin/ai-provider-health` shows every provider in `COOLING_DOWN`,
  `UNAUTHORIZED`, `BILLING_BLOCKED`, or `MODEL_UNAVAILABLE` state.
- Generation requests return `ALL_PROVIDERS_EXHAUSTED` or
  `ATTEMPT_BUDGET_EXHAUSTED`.
- Users see "AI Analyze unavailable — using fallback" banners across the
  dashboard.

## Immediate steps (first 5 minutes)

1. **Confirm scope** — open the AI Health page (or hit the API directly):
   ```bash
   curl -s https://YOUR_DEPLOYMENT_URL/api/ai/health | jq .
   ```
   Verify `allProvidersCooling` and the per-provider `status` / `coolingDown`
   flags. Note `blockers` and `warnings`.

2. **Check provider dashboards** — log into each provider console (Z.ai,
   Cerebras, Mistral, Groq, OpenRouter) and check for outages, quota
   exhaustion, or billing suspensions. Cross-reference against the
   `ProviderHealthSnapshot` failure categories shown in
   `/api/admin/ai-provider-health`.

3. **Verify keys are still valid in Vercel** — go to Vercel → Project →
   Settings → Environment Variables. Confirm `ZAI_API_KEY`, `CEREBRAS_API_KEY`,
   `MISTRAL_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY` are present and have
   not been rotated out from under the deployment.

4. **Do NOT trigger mass re-runs yet.** Re-running AI Analyze while every
   provider is cooling down will only burn the attempt budget and surface more
   fallbacks. Communicate to users: "AI providers are degraded — analysis is
   running in fallback mode. No action needed; we will re-run when service is
   restored."

5. **Record the incident** — note timestamp, deployment URL
   (from Vercel dashboard), and the failure categories of each provider.
   This is needed for the post-mortem.

## Recovery steps

1. **Wait for cooldowns to expire.** Cooldowns are time-windowed and clear
   automatically — do not manually clear them while the underlying provider is
   still failing or you will immediately re-trigger the cooldown.

2. **If a key was the problem**, rotate it in Vercel (Settings → Environment
   Variables → Update for Production / Preview / Development), then redeploy
   (push an empty commit or click "Redeploy"):
   ```bash
   git commit --allow-empty -m "chore: redeploy after AI key rotation" && git push
   ```

3. **After cooldowns expire and keys are confirmed**, reset persisted provider
   health so the app stops surfacing stale cooldowns:
   ```bash
   # Admin only — requires ADMIN session cookie
   curl -X POST https://YOUR_DEPLOYMENT_URL/api/admin/ai-provider-health \
     -H "Cookie: $ADMIN_COOKIE" \
     -H "Content-Type: application/json" \
     -d '{"reset": true}'
   ```

4. **Smoke-test the chain** — run a single provider test against the lowest-risk
   configured provider:
   ```bash
   curl -s https://YOUR_DEPLOYMENT_URL/api/admin/ai-provider-health/test \
     -H "Cookie: $ADMIN_COOKIE" | jq .
   ```
   Expect `ANALYSIS_VERIFIED` / `GENERATION_VERIFIED` for at least one provider.

5. **Re-run AI Analyze** on the most recently affected tender. The recovery
   panel in the tender detail page exposes a "Re-run AI Analyze" action;
   confirm `analysisSource` switches from `REGEX_FALLBACK_UNAPPROVED` to an
   AI-backed source.

## Verification

- `/api/ai/health` returns `ok: true`, `allProvidersCooling: false`,
  `noAiProviderReady: false`, and `nextAction: READY` or
  `REVIEW_AI_CONFIGURATION`.
- At least one provider shows `runtimeVerified: true` and
  `lastSuccessAt` within the last few minutes.
- AI Analyze on a fresh tender returns `analysisSource` other than
  `REGEX_FALLBACK_UNAPPROVED`.
- Generation requests succeed without `ALL_PROVIDERS_EXHAUSTED`.
- Users stop seeing the AI fallback banner.

## Escalation

- **On-call engineer:** page if `/api/ai/health` is still failing 30 minutes
  after keys are confirmed valid and cooldowns should have expired.
- **Provider support tickets:** open a ticket with the provider(s) showing
  `UNAUTHORIZED` / `BILLING_BLOCKED` after confirming the key is correct in
  Vercel.
- **Comms:** if the outage exceeds 60 minutes, post an update to the in-app
  notification banner (`/api/notifications`) and email affected users.
- **Post-mortem:** file an incident report within 48 hours covering root cause,
  blast radius, mitigation, and prevention. Reference the
  `ProviderHealthSnapshot` records from the incident window.
