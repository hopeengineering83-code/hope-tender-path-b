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
- Provider order: Z.ai → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Anthropic (emergency-only last).
- Regex, fallback, partial, legacy, and unpromoted analysis must not unlock generation, export, or Final ZIP.
- Only promoted `AI_SUCCEEDED` may unlock generation/export after all gates pass.
- Critical metadata and mandatory requirements need active source file, page, and meaningful quote.
- Preserve role and ownership checks.
- Create zero `GeneratedDocument` rows before valid extraction, grounded requirements, evidence, and Build Plan eligibility.
- Final ZIP gates remain strict.
- Avoid unnecessary Vercel previews; run local checks before pushing work.

## Session Log

<!-- Add newest entry at the top. -->

### 2026-07-03 UTC — Claude Code

- **Branch:** `hotfix/release-safety-consolidation` (PR #931)
- **Scope:** Complete REVIEWER read-only protection verification with REAL rendered-component tests (not source-text scans). Verified fail-closed canMutate default, handler-level defensive guards, conditional rendering, and provider-policy compliance. Full test suite integration.
- **Files changed:**
  - `components/engine-action-panel.tsx` — canMutate default changed from required `boolean` to optional `canMutate?: boolean` with default `= false` (fail-closed); preserved `if (!canMutate) return;` as first statement in both `runEngine()` and `runEngineAsync()` handlers; all mutation controls conditionally rendered with `{canMutate && (...)}`; read-only note displayed when !canMutate; "Check status now" button NOT guarded (GET-only, available to REVIEWER).
  - `components/tender-ai-copilot-panel.tsx` — added `if (!canMutate) return;` as first statement in `ask()` function; added `if (!canMutate) return;` as first statement in `recordControls()` function; textarea disabled when !canMutate; Ask Copilot, quick-question, and Record buttons conditionally rendered with `{canMutate && (...)}`; canMutate default changed to optional with `= false`.
  - `lib/ai.ts` — line 23: updated stale provider-order comment to "Z.ai → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Anthropic → deterministic draft fallback"; line ~4041: rewrote per-section provider-order comment explaining section fallback order differs from canonical chain and noting that changing it is a runtime behavior change.
  - `tests/helpers/rtl-env.ts` (NEW) — created real-DOM component-test environment for node:test using happy-dom Window with all required globals (HTMLElement, Event, MouseEvent, etc.), Node 22 compatible navigator override, IS_REACT_ACT_ENVIRONMENT flag for React batching, fetch mock recording all calls (url, method, body) with route table substring/regex matching, renderWithRouter() wrapping @testing-library/react's render with AppRouterContext.Provider and fakeRouter, helper functions (buttonLabels, findButton, fireEvent, waitFor, cleanup, act, within).
  - `tests/rendered-component-capability.test.ts` (REWRITTEN) — REAL rendered tests mounting actual EngineActionPanel component into live happy-dom; 14 tests total verifying: omitted canMutate is fail-closed (no mutation buttons, read-only note shown), REVIEWER (canMutate=false) across 6 states (normal, large-vault, extraction-blocked, poll-timeout, network-failure, failure/retry) renders NO mutation controls via assertNoMutationControls() checking MUTATION_LABELS array; "Check status now" available to REVIEWER and is GET-only (clicking it sends single GET, zero POSTs); ADMIN/PM retain mutation controls and clicking Run Engine dispatches real POST to /api/tenders/{tenderId}/engine; ADMIN large-vault state shows Safe Mode banner and both large-vault buttons; exported dispatch functions executeEngineRun/executeEngineRunAsync with canMutate=false send zero requests and report ENGINE_MUTATION_BLOCKED_RESULT; all 14 tests PASS.
  - `tests/tender-ai-copilot-capability.test.ts` (REWRITTEN) — REAL rendered tests mounting actual TenderAICopilotPanel component into live happy-dom; 5 tests total verifying: omitted canMutate is fail-closed (no Ask Copilot, no quick-questions, no Record buttons; textarea disabled), REVIEWER (canMutate=false via real canMutateTender) sees same read-only surface, ADMIN (canMutate=true) clicks quick question button and dispatches real POST to /api/tenders/{tenderId}/copilot, response renders answer/recommendations/risks/nextActions and Record button appears; all 5 tests PASS.
- **Commands run and results:**
  - `npx tsc --noEmit` — PASS (exit 0)
  - `npm run lint` — PASS (exit 0)
  - `npx prisma validate` — PASS (exit 0)
  - `npx prisma generate` — PASS (exit 0)
  - `npm test (rendered-component-capability.test.ts + tender-ai-copilot-capability.test.ts)` — 19/19 PASS
  - `npm test (provider policy tests)` — 102/102 PASS
  - `RUN_DB_INTEGRATION=true npm test (full suite)` — 4823/4823 PASS
- **CI / deployment:** Not checked; local verification complete.
- **Known risks:** None identified. All defensive guards preserved. All mutation-control hiding verified through real component renders and DOM inspection. All provider policy verified across all 10 automatic providers with correct ranks and emergency-only flags. Full test suite passes with real PostgreSQL integration.
- **Next action:** Update PR #931 description to remove obsolete six-provider claim and update PostgreSQL status; do not merge or deploy pending review.
- **Merge status:** `unsafe` (per user instruction; no deployment authorized)

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
