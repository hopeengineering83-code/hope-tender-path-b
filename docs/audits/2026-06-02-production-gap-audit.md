# Hope Tender Proposal Generator — Production Gap Audit (2026-06-02)

## A. Executive Summary

Production is reported ready after the Neon/Vercel recovery and PR #554. The remaining high-value code gap found in this workspace was an AI-provider policy mismatch: local source still modeled the older six-provider chain and did not include Mistral/Together in provider health, readiness, diagnostics, provider-chain testing, or the admin provider ping route. This PR patches only that confirmed mismatch and does not weaken auth, canonical readiness, seven-pass generation, export readiness, official-original protection, evidence review policy, or schema bootstrap controls.

## B. Current Production Status after PR #554

Reported production status is healthy: `/api/health` is `ok=true` and `databaseReachable=true`, the new Neon database is active, schema audit is OK, the vault is 100% complete with 4 documents, 28 reviewed experts, and 112 reviewed projects, and Run Engine creates 28 expert matches plus 112 project matches. Network access from this container could not reach the public app or GitHub API because outbound CONNECT was blocked with HTTP 403, so live health/open-PR verification remains a manual post-deploy check.

## C. Architecture Map

- **Auth/security:** route-level session/role guards in API routes; admin-only provider testing and diagnostics.
- **Database:** Prisma with production runtime schema bootstrap disabled unless explicitly opted in; Neon PostgreSQL is the production target.
- **Company vault:** reviewed company facts, documents, experts, projects, legal/financial/compliance records, and brand assets feed matching and proposal evidence.
- **Tender workflow:** tender upload/extraction, AI/regex analysis, matching engine, compliance matrix, submission plan, generation readiness, document generation, validation, final export gate.
- **AI runtime:** provider chain, provider health/cooldown tracker, DB-backed ProviderHealthSnapshot restore/persist, admin provider ping.
- **Safety gates:** analysis-source gate, canonical readiness, seven-pass generation gate, official-original detection, document lifecycle state, final ZIP/export readiness.

## D. Merged PRs Already Accounted For

The audit treats PR #544 through #554 as already merged production work and avoids reapplying them unless a local regression is confirmed: schema drift repair, plan-not-built guard, Test Provider Chain button, Vercel Hobby AI Analyze timeout fix, Mistral/Together provider additions, analysis-source status expansion, list/history filters, status badge colors, and NEXT_STATUS gating.

## E. Current Open PRs / Risks

The container has no `gh` CLI and outbound access to the GitHub API was blocked, so open PR inventory could not be listed here. Risk remains: stale PRs created before PR #554 may reintroduce six-provider wording, old readiness labels, or provider-chain order regressions if merged without review.

## F. Critical Remaining Gaps

1. **Confirmed local provider-chain regression:** local code still used six providers in multiple surfaces. Fixed in this PR by aligning runtime chains, health surfaces, env checks, and provider-chain tests with the approved eight-provider policy.
2. **Live Vercel/env cannot be verified from this container:** manual verification is required after deployment.
3. **Open PR visibility blocked:** manual GitHub review is required before merging any stale PRs.

## G. Vercel/Env Gaps

The code now recognizes `MISTRAL_API_KEY`, `MISTRAL_PROPOSAL_MODEL`, `MISTRAL_ANALYSIS_MODEL`, `MISTRAL_FAST_MODEL`, `TOGETHER_API_KEY`, `TOGETHER_PROPOSAL_MODEL`, `TOGETHER_ANALYSIS_MODEL`, and `TOGETHER_FAST_MODEL` alongside existing providers. Missing optional model variables remain non-fatal; missing all AI keys remains fatal in production. `DATABASE_URL` and `SESSION_SECRET` remain required, and `PDF_OCR_MAX_RACES` remains a non-fatal recommendation.

## H. Neon/Schema Gaps

No schema migration is included in this PR. `ProviderHealthSnapshot.provider` is a string primary key, so adding Mistral/Together provider names is schema-compatible and does not require a migration. Runtime schema bootstrap remains outside the patched provider work and must stay disabled in production unless explicitly opted in.

## I. AI Provider/Analyze Gaps

Provider order now matches the required policy:

- Default: `openai, gemini, mistral, deepseek, groq, together, openrouter, anthropic`
- Extraction/analyze: `gemini, openai, mistral, together, deepseek, groq, openrouter, anthropic`
- Drafting/proposal: `openai, gemini, mistral, deepseek, together, groq, openrouter, anthropic`
- Validation: `openai, gemini, mistral, deepseek, together, groq, openrouter, anthropic`
- Fast/cheap: `groq, together, deepseek, mistral, gemini, openai, openrouter, anthropic`

Claude/Anthropic remains last in every chain. Regex fallback remains a lower-trust path and is not changed by this PR.

## J. Readiness/UI Contradictions

No readiness gate was weakened. The remaining audit focus for later PRs is visual copy review across command center, readiness, validation, matching quality, generated outputs, and export panels to ensure no panel says ready/proceed/export-ready when canonical readiness/export gates block.

## K. Submission Plan Gaps

PR #544 already added snapshot guard and plan-not-built state. Later PRs should continue improving derived draft-plan confirmation and explicit distinction among tender-issued plan, derived draft plan, user-confirmed plan, official-original rows, control rows, optional annexes, duplicates, wrong-scope rows, and superseded/historical rows.

## L. Evidence Coverage Gaps

No coverage thresholds were changed. FULL/SUBSTANTIAL coverage must continue to require confirmed compliance matrix rows with source traceability. Selected evidence and auto-links must remain PARTIAL until confirmed.

## M. Document Lifecycle/Export Gaps

No export readiness or document lifecycle rule was weakened. Planned/control/original-required/not-exportable/superseded/quality-failed/outside-plan rows must continue to block final ZIP unless resolved according to existing gates.

## N. Security Gaps

Admin provider ping remains admin-only and now avoids unnecessary provider calls when a single provider is requested. Per-provider ping timeout was reduced so the full eight-provider sequence stays within the route budget without excessive token/time usage. No API keys, provider raw bodies, DSNs, session secrets, passwords, dumps, or backups are exposed or committed.

## O. Performance/Neon Transfer Gaps

No new DB-heavy file-content reads were added. Provider health persistence uses provider-name string rows and does not store prompts/responses/secrets. Remaining transfer audit work should continue focusing on fileContent/extractedText selections in dashboard/readiness polling.

## P. Generic Tender Engine Upgrade Strategy

Future work should stay generic, not Pharo-specific:

1. Tender category detector for Hope workstreams.
2. Submission package mode detector for single-envelope, two-envelope, portal, email, and ZIP modes.
3. Required document planner that separates official originals from generated deliverables.
4. Proposal section planner based on tender requirements only.
5. Evidence confirmation workflow with traceable compliance rows.
6. Sectioned/resumable proposal generation.
7. DOCX/PDF/ZIP assembly hardening.
8. Admin health/runtime verification panel.
9. Regression benchmark suite covering Pharo plus building, infrastructure/water, EOI/supplier registration, donor/bank, and two-envelope tenders.

## Q. Prioritized PR Plan

1. **PR 1 (this PR):** current-state audit report and provider-chain regression fix.
2. **PR 2:** submission plan builder / plan-not-built UX hardening.
3. **PR 3:** evidence confirmation workflow and mandatory traceability.
4. **PR 4:** generic tender category/package classifier.
5. **PR 5:** sectioned/resumable generation improvements.
6. **PR 6:** DOCX/PDF/ZIP assembly hardening.
7. **PR 7:** performance/Neon transfer cleanup.
8. **PR 8:** regression benchmark suite for Pharo and non-Pharo tenders.

## R. Test Plan

- Typecheck the codebase.
- Run targeted provider-chain, env-readiness, provider-health, and company-knowledge safety tests.
- Build with safe placeholder env values.
- Manual post-deploy checks: `/api/health`, login, vault counts, schema audit, Run Engine match counts, provider health panel showing Mistral/Together, Claude last, Generate Docs blocked until readiness passes, and Final ZIP blocked until export readiness passes.
