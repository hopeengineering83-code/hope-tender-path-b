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
- Provider order: Z.ai → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Anthropic / Claude → deterministic draft fallback. Z.ai is rank 1 and automatic; Anthropic is rank 10 and emergency-only; deterministic fallback is rank 11, non-AI, and never eligible for final proposal generation or export.
- Regex, fallback, partial, legacy, and unpromoted analysis must not unlock generation, export, or Final ZIP.
- Only promoted `AI_SUCCEEDED` may unlock generation/export after all gates pass.
- Critical metadata and mandatory requirements need active source file, page, and meaningful quote.
- Preserve role and ownership checks.
- Create zero `GeneratedDocument` rows before valid extraction, grounded requirements, evidence, and Build Plan eligibility.
- Final ZIP gates remain strict.
- Avoid unnecessary Vercel previews; run local checks before pushing work.

## Session Log

<!-- Add newest entry at the top. -->

### 2026-07-02 16:51 UTC — Codex

- **Mode:** continued PR #931 provider/section-budget failure fixes
- **Branch / PR:** `work` / #931 (requested scope; no remote/gh available in container)
- **Scope:** added bounded per-section `maxOutputTokens` overrides to the regenerate-section route and sectioned generation engine, and updated regression tests to verify every direct section-generation path uses the bounded budget while preserving registry-derived provider caps.
- **Files changed:** `app/api/tenders/[id]/regenerate-section/route.ts`, `lib/engine/sectioned-generation-engine.ts`, `tests/ai-analysis-token-budget-and-error-surfacing.test.ts`, `tests/proposal-monolithic-call-guard.test.ts`, `operator_handoff.md`
- **Tests:** `npx tsx --test tests/ai-analysis-token-budget-and-error-surfacing.test.ts tests/proposal-monolithic-call-guard.test.ts tests/ai-provider-chain-policy.test.ts tests/provider-failover-and-single-chunk.test.ts` passed; `npx tsx --test tests/ai-provider-registry.test.ts tests/ai-provider-health-order-alignment.test.ts tests/ai-provider-health.test.ts tests/mistral-together-providers.test.ts tests/deep-reasoning.test.ts tests/deep-reasoning-e2e.test.ts tests/ai-provider-attempt-budget.test.ts` passed; `npm run typecheck` passed; `node scripts/repair-ai-policy-artifact.mjs` passed; `git diff --check` passed.
- **CI / deployment:** GitHub/Vercel CI not checked because `gh` is unavailable and no git remote is configured; no deploy/previews created.
- **Known risk:** Current checkout branch is named `work`; container lacks PR remote metadata, so PR #931 association could not be independently verified locally.
- **Next action:** push this commit to PR #931 branch and let CI run.
- **Merge status:** not reviewed

### 2026-07-02 16:46 UTC — Codex

- **Mode:** PR failure fix for provider-policy follow-up
- **Branch / PR:** `work` / #931 (requested scope; no remote/gh available in container)
- **Scope:** fixed the section-generation PR failure by threading a bounded per-section `maxOutputTokens` override through the canonical `generateWithFallback` path instead of reverting to a hand-maintained provider chain.
- **Files changed:** `lib/ai.ts`, `operator_handoff.md`
- **Tests:** `npx tsx --test tests/proposal-monolithic-call-guard.test.ts tests/deep-reasoning.test.ts tests/deep-reasoning-e2e.test.ts tests/ai-provider-chain-policy.test.ts tests/ai-provider-attempt-budget.test.ts tests/provider-failover-and-single-chunk.test.ts` passed; `npx tsx --test tests/ai-provider-registry.test.ts tests/ai-provider-health-order-alignment.test.ts tests/ai-provider-health.test.ts tests/mistral-together-providers.test.ts` passed; `npm run typecheck` passed; `node scripts/repair-ai-policy-artifact.mjs` passed; `git diff --check` passed.
- **CI / deployment:** GitHub/Vercel CI not checked because `gh` is unavailable and no git remote is configured; no deploy/previews created.
- **Known risk:** Current checkout branch is named `work`; container lacks PR remote metadata, so PR #931 association could not be independently verified locally.
- **Next action:** push this commit to PR #931 branch and let CI run.
- **Merge status:** not reviewed

### 2026-07-02 16:41 UTC — Codex

- **Mode:** follow-up provider-policy gap fix for PR #931
- **Branch / PR:** `work` / #931 (requested scope; no remote/gh available in container)
- **Scope:** removed remaining hand-maintained proposal/refinement provider chains, routed monolithic proposal, critique, rewrite, refinement, and section generation through the canonical registry-derived chain, fixed provider attribution for Z.ai/Cerebras and all canonical section sources, and retired a stale repair artifact that could rewrite old provider orders.
- **Files changed:** `lib/ai.ts`, `scripts/repair-ai-policy-artifact.mjs`, `tests/ai-provider-chain-policy.test.ts`, `operator_handoff.md`
- **Tests:** `npx tsx --test tests/ai-provider-chain-policy.test.ts tests/ai-provider-registry.test.ts tests/ai-provider-health-order-alignment.test.ts tests/ai-provider-health.test.ts tests/mistral-together-providers.test.ts` passed; `npm run typecheck` passed; `node scripts/repair-ai-policy-artifact.mjs` passed; `git diff --check` passed.
- **CI / deployment:** GitHub/Vercel CI not checked because `gh` is unavailable and no git remote is configured; no deploy/previews created.
- **Known risk:** Current checkout branch is named `work`; container lacks PR remote metadata, so PR #931 association could not be independently verified locally.
- **Next action:** push this commit to PR #931 branch and let CI run.
- **Merge status:** not reviewed

### 2026-07-02 16:29 UTC — Codex

- **Mode:** urgent provider-policy correction for PR #931
- **Branch / PR:** `work` / #931 (requested scope; no remote/gh available in container)
- **Scope:** restored authoritative 10-provider automatic order in runtime section generation path and provider diagnostics copy; added regression tests for exact order, automatic inclusion, and Anthropic rank/emergency-only status; updated shared handoff provider rule.
- **Files changed:** `lib/ai.ts`, `tests/ai-provider-chain-policy.test.ts`, `operator_handoff.md`
- **Tests:** `npx tsx --test tests/ai-provider-chain-policy.test.ts tests/ai-provider-registry.test.ts tests/ai-provider-health-order-alignment.test.ts tests/ai-provider-health.test.ts tests/mistral-together-providers.test.ts` passed; `npm run typecheck` passed; `git diff --check` passed. An accidental `npm test -- --run ...` invoked the broader suite because the runner ignored the filter; it was manually stopped after provider-policy coverage had passed and before completion.
- **CI / deployment:** GitHub/Vercel CI not checked because `gh` is unavailable and no git remote is configured; no deploy/previews created.
- **Known risk:** Current checkout branch is named `work`; container lacks PR remote metadata, so PR #931 association could not be independently verified locally.
- **Next action:** push this commit to PR #931 branch and let CI run.
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
