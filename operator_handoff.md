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

### 2026-06-29 20:23 UTC — ChatGPT

- **Mode:** PR #920 update after review feedback
- **Branch / PR:** `fix/release-ops-after-plan-correction` / local PR #920 update only
- **Scope:** tightened the previous persisted-plan/evidence patch by adding real Prisma relations and migration foreign keys for all supported `RequirementEvidenceDecision` asset references, scoping evidence approve/reject/invalidate operations to the tender route before mutating a decision, and adding regression assertions for those fixes.
- **Files changed:** `prisma/schema.prisma`, `prisma/migrations/20260630000000_persisted_submission_plan_evidence/migration.sql`, `lib/engine/requirement-evidence.ts`, `app/api/tenders/[id]/evidence-decisions/[decisionId]/route.ts`, `tests/release-plan-model-hardening.test.ts`, `operator_handoff.md`
- **Tests:** `DATABASE_URL=postgresql://user:pass@localhost:5432/db npx prisma validate` passed; `npm run typecheck` passed; `node --import tsx tests/release-plan-model-hardening.test.ts` passed; `npm run lint` passed; `node --import tsx tests/canonical-readiness-contradictions.test.ts` passed; `node --import tsx tests/generation-readiness-gate.test.ts` passed; `node --import tsx tests/generation-gate-hardened.test.ts` passed.
- **CI / deployment:** no GitHub push, PR update, Vercel CLI, preview, settings change, production migration, or deployment performed from this session.
- **Known risk:** still not a full Phase A/B/C completion; Final ZIP snapshot assembly, original-upload package enforcement, database-backed concurrency/evidence tests, and broader operations/security hardening remain.
- **Next action:** run full required suite with real PostgreSQL/env and finish Final ZIP/e2e/database-backed hardening before merge.
- **Merge status:** unsafe — bounded update only

### 2026-06-29 UTC — ChatGPT

- **Mode:** PR #920 release-plan correction / local-only hardening
- **Branch / PR:** `fix/release-ops-after-plan-correction` / no GitHub PR update or push from this session
- **Scope:** added persisted `SubmissionPlanRevision` release authority, relational plan item requirement/citation mappings, metadata and requirement evidence models, confirm-plan and requirement-evidence routes, confirmed-plan/evidence gates, source/requirements hashing, pending migration, bootstrap coverage, and regression tests. Could not fetch `origin` due HTTPS 403 tunnel; used public PR #920 metadata/diff as reference.
- **Files changed:** `prisma/schema.prisma`, `prisma/migrations/20260630000000_persisted_submission_plan_evidence/migration.sql`, `lib/engine/persisted-submission-plan.ts`, `lib/engine/requirement-evidence.ts`, `lib/engine/generation-readiness-gate.ts`, `lib/prisma.ts`, `lib/audit.ts`, `app/api/tenders/[id]/submission-plan/build/route.ts`, `app/api/tenders/[id]/confirm-plan/route.ts`, `app/api/tenders/[id]/requirements/[requirementId]/evidence/route.ts`, `app/api/tenders/[id]/evidence-decisions/[decisionId]/route.ts`, `tests/release-plan-model-hardening.test.ts`, `tests/canonical-readiness-contradictions.test.ts`, `tests/generation-readiness-gate.test.ts`, `tests/generation-gate-hardened.test.ts`, `operator_handoff.md`
- **Tests:** `npm ci` passed with Node engine warning; `DATABASE_URL=postgresql://user:pass@localhost:5432/db npx prisma validate` passed; `npm run typecheck` passed; `npm run lint` passed; focused node tests for release plan, canonical readiness, generation readiness, hardened gate, bootstrap coverage, safe errors, and structured export/download errors passed. `npm run build` failed before build because local `DATABASE_URL` and `SESSION_SECRET` are missing. `npm run test:e2e` failed because Next config requires `SESSION_SECRET`. `timeout 120 npm test` timed out; before timeout it surfaced bootstrap coverage, which was fixed and re-tested.
- **CI / deployment:** not checked via `gh` because GitHub CLI is unavailable and `git fetch origin`/HTTPS remote access failed with CONNECT tunnel 403; no Vercel CLI, preview, settings change, push, production migration, or deployment performed.
- **Known risk:** this is a bounded local correction rather than a full Phase A/B/C completion; Final ZIP still needs deeper confirmed-plan snapshot assembly and original-upload package inclusion beyond the central gate. Runtime bootstrap table stubs were updated only to satisfy existing fresh-DB coverage and should not replace migrations.
- **Next action:** run with a real local PostgreSQL database and full env, then complete database-backed concurrency/evidence/Final ZIP tests before merge.
- **Merge status:** unsafe — not complete for all requested release-critical items

### 2026-06-29 UTC — ChatGPT

- **Mode:** PR #910 safety follow-up
- **Branch / PR:** `work` / PR pending
- **Scope:** restored/replaced canonical readiness contradiction coverage for regex fallback, missing submission plan, stale documents, OCR-required extraction, metadata trust, export blockers, and PLANNED virtual document behavior; changed Build Plan/plan-only responses so planned files are virtual/readiness-only and do not create `GeneratedDocument` rows before readiness.
- **Files changed:** `tests/canonical-readiness-contradictions.test.ts`, `tests/submission-plan-empty-gate.test.ts`, `app/api/tenders/[id]/submission-plan/build/route.ts`, `app/api/tenders/[id]/generate/route.ts`, `operator_handoff.md`
- **Tests:** `node --import tsx tests/canonical-readiness-contradictions.test.ts` passed; `node --import tsx tests/submission-plan-empty-gate.test.ts` passed; `npm run typecheck` passed. Attempted `npm test -- tests/canonical-readiness-contradictions.test.ts tests/submission-plan-empty-gate.test.ts tests/tender-readiness-state.test.ts`, but the repo test runner ignored the file arguments and began the full suite; stopped it after broad unrelated tests were still running.
- **CI / deployment:** GitHub CLI unavailable in container, so open PR/CI state could not be checked from `gh`; no Vercel preview created intentionally.
- **Known risk:** legacy `PLANNED` rows may still exist from older runs; this change prevents new pre-readiness rows from Build Plan/plan-only paths and keeps export blockers strict.
- **Next action:** open/review CI for this branch and verify PR #910 replacement coverage before merge.
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
