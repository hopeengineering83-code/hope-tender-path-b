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

### 2026-06-30 UTC — ChatGPT

- **Mode:** release-safety implementation
- **Branch / PR:** `hotfix/complete-release-safety` / PR not opened from this environment (no git remote configured and `gh` unavailable); PR metadata prepared after local commit
- **Scope:** implemented Section C, part 2 release-safety gates: authoritative BuildPlan draft/confirm routes, deterministic tender-state hashing, current confirmed-plan enforcement in the central readiness gate, strict plan-only preview behavior, automatic provider fallback ordering, bootstrap schema coverage, and behavioral tests.
- **Files changed:** `.env.example`, `app/api/tenders/[id]/build-plan/route.ts`, `app/api/tenders/[id]/build-plan/confirm/route.ts`, `app/api/tenders/[id]/generate/route.ts`, `components/ai-health-panel.tsx`, `docs/ai-provider-order.md`, `lib/ai-environment-readiness.ts`, `lib/ai-provider-catalog.cjs`, `lib/ai-provider-health-db.ts`, `lib/ai-provider-registry.ts`, `lib/audit.ts`, `lib/engine/build-plan.ts`, `lib/engine/generation-readiness-gate.ts`, `lib/env-check.ts`, `lib/prisma.ts`, `prisma/schema.prisma`, `prisma/migrations/20260630120000_add_build_plan/migration.sql`, `scripts/check-env.mjs`, and provider/build-plan release-safety tests under `tests/`.
- **Tests:** passed `npx prisma validate`; passed `npx prisma generate`; PostgreSQL migration deploy could not connect to local PostgreSQL (`P1001`); passed `npm run typecheck -- --pretty false`; passed `npm run lint -- --max-warnings 999`; passed targeted BuildPlan/provider/generation gate tests; passed full `npm test`; passed production `npm run build` with required dummy/env warnings only.
- **CI / deployment:** no remote/CI metadata available locally; no Vercel CLI run, no preview created, no deployment attempted.
- **Known risk:** database migration application still needs verification in an environment with reachable PostgreSQL; actual GitHub push/PR update requires a configured remote or GitHub CLI.
- **Next action:** push the committed branch once to the canonical remote and open/update exactly one PR against `main`, then run CI including PostgreSQL migration checks.
- **Merge status:** unsafe until remote CI and PostgreSQL migration checks pass.

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
