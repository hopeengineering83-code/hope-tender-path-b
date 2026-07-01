# Operator Handoff

This file is the shared coordination record for ChatGPT, Claude Code, Codex, GLM, and Jules.

## Authority order

1. Current repository code, migrations, and tests.
2. Current GitHub branch, open pull requests, commits, CI, and deployment state.
3. This file.
4. `CLAUDE.md` and `AGENTS.md`.
5. Private tool memory and chat summaries.

Claude memory may help Claude continue a session, but it is private and cannot be the shared source of truth for other tools. When it conflicts with this repository record, the repository record wins.

## Start every session

Before making changes:

1. Read `AGENTS.md`, `CLAUDE.md`, and this file.
2. Inspect the latest target branch, open pull requests, CI, and working tree state.
3. State the task, branch, files expected to change, and tests to run.
4. Check the Active Workboard. Do not overlap another active agent's scope without coordination.
5. Use one isolated branch. Never write directly to `main`.
6. Do not merge, approve, deploy, rebase another agent's branch, or create a Vercel preview without Hope's approval.

## End every session

Update this file in the same commit as the substantive work. Do not make a separate push only for a handoff entry.

Add a newest-first Session Log entry containing:

- UTC timestamp and tool name;
- branch and pull request;
- exact scope and files changed;
- tests actually run and results;
- CI/deployment status if checked;
- known risks or assumptions;
- one next action;
- merge status: safe, unsafe, or not reviewed.

Never claim a fix is complete unless the stated tests passed.

## Active Workboard

| Owner tool | Branch / PR | Scope | Locked files or areas | Status | Next action |
|---|---|---|---|---|---|
| None registered | — | — | — | No active lock recorded | Inspect GitHub before starting work |

### Lock rules

- One writing agent per branch.
- Parallel work is allowed only when branch, files, and acceptance tests do not overlap.
- Do not edit another active agent's branch.
- Do not discard another agent's work while resolving a conflict without reviewing both diffs.
- If two tasks need the same file, sequence them first.

## Non-negotiable application rules

- Tender-controlled scope only. Never invent tender facts or evidence.
- Company Vault is factual evidence only; no automatic all-Vault fallback.
- Provider order: Gemini → OpenRouter → OpenAI → Groq → DeepSeek → Anthropic last.
- Regex, fallback, partial, legacy, and unpromoted analysis must not unlock generation, export, or Final ZIP.
- Only promoted `AI_SUCCEEDED` may unlock generation/export after all gates pass.
- Critical metadata and mandatory requirements need active source file, page, and meaningful quote.
- Preserve role and ownership checks.
- Create zero `GeneratedDocument` rows before valid extraction, grounded requirements, evidence, and Build Plan eligibility.
- Final ZIP gates remain strict.
- Avoid unnecessary Vercel previews; run local checks before pushing work.

## Session Log

<!-- Add newest entry at the top. -->

### 2026-07-01 UTC — ChatGPT

- **Mode:** CI follow-up
- **Branch / PR:** `codex/fix-release-safety-pr` / PR metadata to be updated after commit
- **Scope:** fixed the controlled PR route check for Codex branches and reconciled stale tests with the approved provider fallback order and REVIEWER mutation-role hardening.
- **Files changed:** `.github/workflows/branch-policy.yml`, `tests/ai-provider-attempt-budget.test.ts`, `tests/analysis-source-gate.test.ts`, `tests/provider-health-runtime.test.ts`, `tests/recovery-command-center-actions.test.ts`, and `operator_handoff.md`.
- **Tests:** controlled branch-policy shell check passed; `npx tsx --test tests/ai-provider-attempt-budget.test.ts tests/analysis-source-gate.test.ts tests/provider-health-runtime.test.ts tests/recovery-command-center-actions.test.ts tests/release-role-policy.test.ts` passed; `npm run lint` passed; `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/hope_tender_path npx tsc --noEmit --pretty false` passed; `npm test` passed.
- **CI / deployment:** CI not checked after local commit; no deployment run.
- **Known risk:** this checkout still has no configured git remote, so pushing requires repository remote configuration outside this container.
- **Next action:** push branch and rerun GitHub checks.
- **Merge status:** not reviewed

### 2026-07-01 UTC — ChatGPT

- **Mode:** follow-up hardening
- **Branch / PR:** `codex/fix-release-safety-pr` / PR metadata to be updated after commit
- **Scope:** closed remaining provider-policy gaps from the prior commit by making automatic readiness use only the canonical Gemini → OpenRouter → OpenAI → Groq → DeepSeek → Anthropic chain; keeping Z.ai, Cerebras, Mistral, and Together manual-only; aligning readiness, env checks, docs, runbooks, drift-audit script, and regression tests.
- **Files changed:** `.env.example`, `docs/ai-provider-order.md`, AI provider runbooks/audit docs, `lib/ai-provider-registry.ts`, `lib/env-check.ts`, `lib/ai-environment-readiness.ts`, provider-policy scripts, and provider/env tests.
- **Tests:** `npx tsx --test tests/ai-provider-chain-policy.test.ts tests/ai-provider-registry.test.ts tests/ai-provider-health.test.ts tests/ai-provider-health-order-alignment.test.ts tests/release-role-policy.test.ts tests/mistral-together-providers.test.ts tests/deepseek-provider-visibility.test.ts tests/provider-status.test.ts tests/environment-variable-reconciliation.test.ts tests/ai-provider-fallback.test.ts` passed; `node scripts/reconcile-gap-closure.mjs` passed; `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/hope_tender_path npx tsc --noEmit --pretty false` passed.
- **CI / deployment:** not checked; no deployment run.
- **Known risk:** this checkout still has no configured git remote, so pushing requires repository remote configuration outside this container.
- **Next action:** push branch, open/update the GitHub PR, and run CI before merge.
- **Merge status:** not reviewed

### 2026-07-01 UTC — ChatGPT

- **Mode:** code hardening
- **Branch / PR:** `codex/fix-release-safety-pr` / PR metadata to be created after commit
- **Scope:** enforced release-safety provider and role policy by limiting the automatic AI provider chain to Gemini → OpenRouter → OpenAI → Groq → DeepSeek → Anthropic; kept Z.ai, Cerebras, Mistral, and Together as manual-only adapters; removed REVIEWER from release/build/generation mutation routes; added role-policy regression coverage.
- **Files changed:** `lib/ai-provider-catalog.cjs`, `lib/ai-provider-registry.ts`, `lib/env-check.ts`, release mutation routes under `app/api/tenders/[id]/`, provider policy tests, and `tests/release-role-policy.test.ts`.
- **Tests:** `npx tsx --test tests/ai-provider-chain-policy.test.ts tests/ai-provider-registry.test.ts tests/ai-provider-health.test.ts tests/release-role-policy.test.ts` passed; `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/hope_tender_path npx tsc --noEmit --pretty false` passed.
- **CI / deployment:** not checked; no deployment run.
- **Known risk:** this checkout has no configured git remote, so pushing may require repository remote configuration outside this container.
- **Next action:** push branch and run CI before merge.
- **Merge status:** not reviewed

### 2026-06-29 UTC — Jules

- **Mode:** documentation correction
- **Branch / PR:** `claude/operator-handoff-correction-10035225860455380987 / #911`
- **Scope:** corrected ChatGPT's 2026-06-28 handoff entry to reflect PR #908 merge status
- **Files changed:** `operator_handoff.md`
- **Tests:** not applicable
- **CI / deployment:** CI passed; Vercel preview was automatically created.
- **Known risk:** none
- **Next action:** submit correction
- **Merge status:** not reviewed

### 2026-06-28 UTC — ChatGPT

- **Mode:** coordination setup
- **Branch / PR:** `claude/operator-handoff-protocol` / #908
- **Scope:** created the shared cross-agent handoff protocol
- **Files changed:** `AGENTS.md`, `operator_handoff.md`
- **Tests:** not applicable; documentation-only change
- **CI / deployment:** merged into main
- **Known risk:** Vercel may independently detect a branch commit; inspect Vercel before assuming no preview exists
- **Next action:** none; task complete
- **Merge status:** merged into main
