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
- Provider order: Z.ai → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Anthropic (rank 10, emergency-only) → deterministic draft fallback (rank 11, non-AI, never final-export eligible).
- Regex, fallback, partial, legacy, and unpromoted analysis must not unlock generation, export, or Final ZIP.
- Only promoted `AI_SUCCEEDED` may unlock generation/export after all gates pass.
- Critical metadata and mandatory requirements need active source file, page, and meaningful quote.
- Preserve role and ownership checks.
- Create zero `GeneratedDocument` rows before valid extraction, grounded requirements, evidence, and Build Plan eligibility.
- Final ZIP gates remain strict.
- Avoid unnecessary Vercel previews; run local checks before pushing work.

## Session Log

<!-- Add newest entry at the top. -->

### 2026-07-03 UTC — Claude Code (PR #936 pre-merge investigation, round 2)

- **Branch:** `hotfix/metadata-repair-crash-and-snapshot-consistency` (PR #936)
- **Scope:** Pre-merge investigation of whether the PR truly solves the app's problems; two further production defects found and fixed.
- **Gaps found and fixed:**
  1. **Plan approval was unreachable in production.** `deriveSubmissionPlanStatus` returns `CANONICAL_APPROVED` only when `tender.status === "PLAN_APPROVED"` — but `PLAN_APPROVED` is not a `TENDER_STATUSES` value, `parseTenderStatus` rejects it, and nothing ever writes it. Consequence: even after Build + Confirm, the workflow panel stayed at "Build Submission Plan" forever, plan-truth stayed `USER_REVIEW_REQUIRED`, and authority review stayed `PREREQUISITES_MISSING`. The prior regression tests passed only because their mocks set the impossible status. The three truth resolvers (workflow-state, plan-truth, authority-truth) now key approval on `confirmedPlan.ok` (which already enforces confirmation + hash freshness + metadata evidence). The central generation/export gate was NOT affected (it checks the confirmed plan directly).
  2. **reconcile-docs superseded documents against a derived heuristic plan** with no confirmed-plan requirement — a mutation endpoint outside the central gate that could supersede documents the confirmed plan requires. It now 422s (`BUILD_PLAN_NOT_CONFIRMED`) without a current confirmed Build Plan and reconciles against `confirmedPlan.items`.
- **Verified sound (no change needed):** central gate blocks ALL purposes fail-closed on `hasCurrentConfirmedBuildPlan !== true` (undefined blocks too); generate / generate-missing-plan-files / regenerate-cvs / auto-finalize / export / download(final-zip) / ai-proposal / background jobs all pass through it; generate-missing-plan-files only exempts `SUBMISSION_PLAN_MISSING`, not the confirmed-plan blockers; the Repair All crash path is dead (client uses `parseRepairMetadataResponse`, no other consumer reads the legacy `results` shape).
- **Known remaining lower-severity items (flagged, not changed):** `lib/engine/submission-plan-completeness.ts` (lifecycle orchestrator + completeness panel + `GET submission-plan`) still uses the derived-fallback plan for display counts, so informational counts can disagree with the confirmed plan; the `generate` route derives per-run target file keys from the derived plan (consistent with the confirmed plan only via hash-freshness + determinism — architecturally it should read `confirmedPlan.items`); `isValidDeadlineCandidate` rejects deadlines >30 days past, so re-extract on archived tenders reports the stored deadline invalid (fail-closed, but visible).
- **Files changed:** `lib/engine/workflow/workflow-state.ts`, `lib/engine/analysis/plan-truth.ts`, `lib/engine/analysis/authority-truth.ts`, `app/api/tenders/[id]/reconcile-docs/route.ts`, `tests/comprehensive-workflow-regression.test.ts` (scenario 9 models no-confirmed-plan; impossible `PLAN_APPROVED` statuses replaced with real ones), `tests/confirmed-build-plan-fail-closed.test.ts` (+2 tests, now 18), `operator_handoff.md`.
- **Commands run and results:** `npx tsc --noEmit` PASS · `npm run lint` PASS · `RUN_DB_INTEGRATION=true npm test` 4841/4841 PASS · `npm run build` PASS.
- **Next action:** Hope reviews PR #936; do not merge or deploy without approval.
- **Merge status:** `unsafe` — all local checks pass; awaiting CI on the new head and Hope's review.

### 2026-07-03 UTC — Claude Code (PR #936 gap review)

- **Branch:** `hotfix/metadata-repair-crash-and-snapshot-consistency` (PR #936)
- **Scope:** Honest gap review of the P1-A/B/C/D commit; fixed five verified gaps so the PR's claims match the code.
- **Gaps found and fixed:**
  1. `getCurrentConfirmedBuildPlan` was FAIL-OPEN: any hash-computation error returned `ok:true`, silently skipping the staleness AND metadata-evidence checks. Now fails closed; reduced unit-test prisma mocks are detected explicitly (missing `tenderMetadataOverride` delegate) instead of by catching errors. Corrupted `itemsJson` also fails closed instead of throwing.
  2. Commit claimed `lib/canonical-tender-readiness.ts` and `lib/engine/final-submission-readiness.ts` use the confirmed BuildPlan + `NO_CURRENT_CONFIRMED_BUILD_PLAN` blocker — neither was true. Both now actually use `getCurrentConfirmedBuildPlan`; the blocker now exists on both gates; derived-fallback plans no longer feed final-export readiness (`hasExplicitPlanScope = confirmedPlan.ok`).
  3. Repair route emitted `status: "UNRESOLVED" as any` — a status missing from the response contract, so clients coerced it to `ERROR` and misreported quote-verification failures as errors. `UNRESOLVED` is now a first-class contract status with correct counting and messaging.
  4. All six confirmed-plan call sites re-parsed `plan.itemsJson` with unguarded `JSON.parse` (crash on corrupt rows). `getCurrentConfirmedBuildPlan` now returns safely-parsed `items`; call sites consume it.
  5. Removed never-wired dead code (`processMetadataRepair`, `isSourceEvidenceStale`) that the commit message described as a wired shared service; the genuinely shared validators and `verifySourceQuote` remain.
- **Files changed:** `lib/engine/build-plan.ts`, `lib/canonical-tender-readiness.ts`, `lib/engine/final-submission-readiness.ts`, `lib/engine/repair-metadata-contract.ts`, `lib/engine/source-grounded-metadata-repair.ts`, `lib/engine/workflow/workflow-state.ts`, `lib/engine/analysis/plan-truth.ts`, `lib/engine/analysis/authority-truth.ts`, `app/api/tenders/[id]/repair-metadata/route.ts`, `app/api/tenders/[id]/auto-finalize/route.ts`, `app/api/tenders/[id]/supersede-outside-plan/route.ts`, `components/submission-plan-reconciliation-panel.tsx`, `components/tender-share-panel.tsx`, `tests/confirmed-build-plan-fail-closed.test.ts` (NEW, 15 tests), `operator_handoff.md`.
- **Commands run and results:**
  - `npx tsc --noEmit` — PASS (exit 0)
  - `npm run lint` — PASS (exit 0)
  - `npx prisma validate` — PASS (exit 0)
  - `RUN_DB_INTEGRATION=true npm test` — 4838/4838 PASS (0 fail; local PostgreSQL 16)
  - `npm run build` — result recorded in the PR conversation.
- **Known risks:** Tenders without a current confirmed BuildPlan now show `NO_CURRENT_CONFIRMED_BUILD_PLAN` and blocked export readiness where the derived draft previously filled in — intentional fail-closed behavior per P1-D, but visible to users of existing tenders until they Build + Confirm a plan.
- **Next action:** Hope reviews PR #936; do not merge or deploy without approval.
- **Merge status:** `unsafe` — all local checks pass; awaiting CI on the amended head and Hope's review.

### 2026-07-03 UTC — Super Z (GLM)

- **Branch:** `hotfix/release-safety-consolidation` (PR #931)
- **Scope:** Tightly scoped correction — EngineActionPanel REVIEWER mutation leak, real rendered-component test limitation, stale DeepSeek comment.
- **Files changed:**
  - `components/engine-action-panel.tsx` — added `if (!canMutate) return;` to `runEngine()` and `runEngineAsync()` handlers; guarded large-vault `Run Safe Mode (recommended)` and `Run full mode anyway` buttons with `canMutate`; verified all other mutation controls already guarded.
  - `tests/rendered-component-capability.test.ts` (NEW) — 26 tests verifying real component module imports, canMutate gating in TenderAICopilotPanel and EngineActionPanel, handler-level guards, and honest limitation report that true rendered-component tests require Next.js AppRouter context.
  - `lib/ai.ts` — corrected stale DeepSeek comment to reflect canonical 10-provider chain.
  - `operator_handoff.md` — this session entry.
- **Commands run and results:**
  - `npx tsc --noEmit` — PASS (exit 0)
  - `RUN_DB_INTEGRATION=true npm test` — 4841/4841 PASS (0 fail)
  - `npm run lint` — PASS (exit 0, 0 warnings)
  - `npx prisma validate` — PASS (exit 0)
  - `npm run build` — PASS (exit 0)
- **Known remaining risks:**
  - True rendered-component tests (using `render()` from `@testing-library/react`) require the Next.js AppRouter AsyncLocalStorage context, which is only available inside the Next.js server runtime. The repository's test infrastructure (tsx + Node native test runner) does not provide this context. The current tests import the real modules and verify function bodies — stronger than source-text scans, but not true DOM renders. Upgrading to jest + jest-environment-jsdom with `jest.mock("next/navigation")` is a separate infrastructure task.
  - Provider order change is a breaking change for existing confirmed BuildPlans — they will become stale (correct behavior).
- **Next action:** Upgrade test infrastructure to jest + jsdom for true rendered-component tests, OR accept the current module-import verification as sufficient.
- **Merge status:** `unsafe` — all local checks pass, but true rendered-component tests are not possible with current infrastructure.

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
