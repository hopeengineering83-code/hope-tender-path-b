# Release Integrity Ledger

This file is the canonical register of non-negotiable application behaviours. A pull request that changes one of these areas must update the mapped test or explain why the rule is unaffected.

## Severity definitions

- **P0** — security breach, data loss, invalid tender package, or broken production workflow.
- **P1** — major reliability or operational failure.
- **P2** — important quality, performance, or maintainability deficiency.

## Protected rules

| Rule ID | Severity | Non-negotiable behaviour | Enforcement |
|---|---:|---|---|
| RI-001 | P0 | A successful tender intake must persist at least one validated `TenderFile`. No empty tender may be reported as successful. | `lib/tender-upload-first.ts`; tender-intake regression tests |
| RI-002 | P0 | Both upload entry points use the same storage policy and upload-security primitives. No route may mutate storage environment variables per request. | `lib/storage.ts`; `scripts/audit-release-integrity.mjs` |
| RI-003 | P0 | Upload must not fail merely because `RateLimitBucket` is absent during a migration gap; only the specific missing-table error may use the bounded in-memory fallback. | `lib/rate-limit.ts`; rate-limit regression tests |
| RI-004 | P0 | Generated-document reads, reviews, comments, and mutations must be scoped through the owning tender and authenticated user. | document review route; tenant-isolation tests; release audit |
| RI-005 | P0 | Production deployment must fail when required tables, columns, migration history, or database guard functions are missing. | `scripts/check-critical-schema.mjs`; `vercel-build`; CI migration-path job |
| RI-006 | P0 | AI job claims must use parameterized SQL and a runtime allow-list for job types. | `lib/job-claim-policy.ts`; `lib/job-type-policy.ts`; security tests |
| RI-007 | P0 | AI Analyze must not promote partial, invalid, or untraceable output as authoritative analysis. Deterministic fallback remains explicitly labelled and review-gated. | AI Analyze route, promotion helpers, analysis-quality tests |
| RI-008 | P0 | Final export must fail closed for corrupt files, unresolved placeholders, wrong envelope separation, invalid names/order, or missing evidence. | final submission readiness, document validator, ZIP tests |
| RI-009 | P1 | Every workflow blocker must expose one valid recovery action that maps to an implemented route or existing page anchor. | recovery action registry and coverage tests |
| RI-010 | P1 | Canonical automatic AI provider order is Gemini → OpenRouter → OpenAI → Groq → DeepSeek → Claude/Anthropic; Z.ai, Cerebras, Mistral, and Together remain manual-only. | `lib/ai-provider-policy.ts`; provider-policy tests; release audit |
| RI-011 | P1 | Upload, extraction, AI Analyze, plan, generation, validation, and export failures must include a request ID and structured diagnostics without secrets or production stacks. | route tests; observability utilities |
| RI-012 | P1 | A release candidate must pass typecheck, lint, unit/database tests, production build, migration-path validation, critical-schema validation, and browser smoke tests. | `.github/workflows/ci.yml` |
| RI-013 | P1 | Merged `main`, deployed production commit, and release evidence must refer to the same commit. | deployment verification procedure and release checklist |
| RI-014 | P1 | Existing production data must never be used or modified by development and CI tests. | isolated CI PostgreSQL service and environment separation |

## Pull-request impact rule

Every pull request must complete the change-impact matrix in `.github/pull_request_template.md`. Any row marked **Yes** requires the mapped proof before merge.

## Release evidence required

A production release record must contain:

1. exact `main` commit SHA;
2. CI run and result;
3. Vercel deployment ID and deployed SHA;
4. critical-schema check result;
5. representative tender workflow result;
6. document-output and ZIP inspection result;
7. rollback candidate deployment;
8. unresolved P1 risks and owner.

## Change discipline

- One branch per coherent task.
- One coding agent at a time per branch.
- No direct work on `main`.
- No force-push.
- Draft PR first.
- Emergency fixes must not include unrelated feature work.
- A green deployment is not sufficient release evidence.
