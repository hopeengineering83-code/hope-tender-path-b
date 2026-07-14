# ADR 0002: 10-provider AI fallback chain with Anthropic last

**Status:** Accepted
**Date:** 2025-08-28
**Deciders:** Hope Engineering, initial codebase authors

## Context

The Hope Tender Engine depends on AI for:

- Tender document analysis (extract requirements, evaluation criteria,
  submission rules, client details).
- Proposal generation (cover letter, technical methodology, compliance matrix,
  risk register, work plan).
- Section regeneration and refinement.

Any single AI provider has:

- **Rate limits** (especially free tiers).
- **Outages** (cascading failures, regional issues).
- **Cost variability** (some providers are 10x more expensive than others).
- **Quality variability** (especially for tender-specific domain language).

Forces at play:

- **Vercel Hobby plan** limits function timeout to 60 seconds — AI calls must
  complete quickly or fail fast.
- **Tender deadlines are unforgiving** — a provider outage during bid
  preparation cannot delay submission.
- **Cost sensitivity** — Hope is a small consultancy; paying Anthropic Claude
  Opus for every request is unsustainable.
- **Quality bar** — generated proposals must meet a 70/100 quality score
  before they can be exported.

## Decision

Implement a **10-provider AI fallback chain** with this canonical order:

```
Z.ai → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Anthropic
```

Implementation:

- **Single source of truth:** `lib/ai-provider-registry.ts` exports
  `CANONICAL_AI_PROVIDER_ORDER`. Every other surface (health routes, UI, env
  checks, docs) derives from this.
- **Per-request fallback:** `analyzeWithAI()` in `lib/ai.ts` tries each
  configured provider in order. Provider is skipped if:
  - API key not configured.
  - Provider in cooldown (DB-backed `ProviderHealthSnapshot`).
  - Provider returned unrecoverable error in last 5 minutes.
- **Attempt budget:** `AI_MAX_PROVIDER_ATTEMPTS=3` caps actual outbound
  attempts per request/chunk (default 3 on Vercel Hobby).
- **Anthropic last:** intentionally last so Anthropic rate limits never block
  the app when earlier providers are configured.
- **OpenRouter restriction:** only `:free` models accepted (rejected otherwise
  with `CONFIGURATION_INVALID`).

## Alternatives considered

### Alternative 1: Single-provider (Anthropic only)

- **Pros:** simpler code; consistent quality.
- **Cons:** Anthropic outages = app down; high cost; rate limits under load.

### Alternative 2: Round-robin across configured providers

- **Pros:** load distribution.
- **Cons:** no quality ordering; cheaper providers used for sensitive
  generation; harder to reason about which provider generated which output.

### Alternative 3: Per-task provider routing (analysis vs generation vs refinement)

- **Pros:** optimal provider per task.
- **Cons:** significantly more complex; requires per-task quality measurement;
  not justified at current scale.

## Consequences

### Positive

- High availability: 10-provider chain means a single provider outage has
  no user-visible impact.
- Cost optimization: cheaper providers (Z.ai, Cerebras, Groq) preferred.
- Quality floor: deterministic fallback guarantees output even when all AI
  providers fail (but fallback is clearly labeled and cannot unlock
  authoritative export per rule #6, #7, #8).
- Auditability: every AI response records `provider` in `AiAnalyzeChunk`
  for audit trail.

### Negative

- Complex code: `lib/ai.ts` is 4,418 lines (split is GAP-ARCH-01).
- Provider health tracking: requires DB-backed `ProviderHealthSnapshot` +
  cooldown logic.
- Variable quality: same prompt may produce different output on different
  providers. Mitigated by deterministic post-processing (controlled-proposal-
  assembler, humanize, validate).

### Neutral

- `ANTHROPIC_TIER` env var declares which Anthropic tier the account is on
  (1/2/3) so the engine can pick appropriate token budget + timeout.

## Compliance

- **Rule #4 (canonical provider order):** ✓ — single source of truth in
  `lib/ai-provider-registry.ts`.
- **Rule #5 (Anthropic last):** ✓ — Anthropic is rank 10 in the chain.
- **Rule #6 (regex/deterministic fallback is not AI):** ✓ — fallback output
  is labeled `REGEX_FALLBACK_FROM_WEAK_EXTRACTION` and cannot unlock
  authoritative generation.
- **Rule #7 (partial/stale/failed/mixed/full-fallback cannot unlock
  authoritative generation):** ✓ — `canPromoteToCanonical()` enforces.
- **Rule #8 (human fallback approval is audit-only):** ✓ —
  `FallbackApprovalRecord` is audit-only; does not promote.

## Future considerations

- **External job queue (GAP-PERF-01):** when migrated to Inngest/Trigger.dev,
  the fallback chain logic stays the same; only the job lifecycle changes.
- **Provider-quality scoring:** if quality drift is observed, add per-provider
  quality scores that influence fallback order (but never override canonical
  order without an ADR).

## References

- `lib/ai-provider-registry.ts` — canonical order
- `lib/ai-provider-catalog.cjs` — shared catalog
- `lib/ai.ts` — fallback chain implementation
- `lib/ai-provider-health.ts` — cooldown tracking
- `lib/ai-provider-health-db.ts` — DB-backed health snapshots
- `prisma/schema.prisma` — `ProviderHealthSnapshot` model
- `CLAUDE.md` — canonical provider order documentation
- `AGENTS.md` — non-negotiable rule #4
- `.env.example` — provider configuration
