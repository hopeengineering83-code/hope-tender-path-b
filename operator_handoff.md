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

### 2026-07-07 UTC — ChatGPT

- **Mode:** restored inline visibility safety follow-up
- **Branch / PR:** `codex/restored-inline-safety-gaps` / PR pending
- **Scope:** fixed remaining restored-inline safety gaps by keeping metadata-only `hasInlineFileContent` valid for visibility/state surfaces while preventing it from satisfying strict downloadable/export byte-content checks; restored `generatedDocumentHasContent` to mean actual `fileContent` or non-empty `storagePath` only.
- **Files changed:** `lib/engine/export-readiness.ts`, `lib/generated-document-content.ts`, `tests/restored-record-visibility.test.ts`, `tests/generated-document-content.test.ts`, `operator_handoff.md`
- **Tests:** `./node_modules/.bin/tsx --test tests/restored-record-visibility.test.ts tests/generated-document-content.test.ts tests/document-output-state.test.ts tests/export-readiness.test.ts` passed; `npm run typecheck` passed; `npm run lint` passed; placeholder-env `npm run build` passed.
- **CI / deployment:** no deploy or Vercel preview created; open PR/CI status not checked from this container.
- **Known risk:** full repository baseline is known red from unrelated suites/integration guards; this session focused on strict restored-inline safety regression tests.
- **Next action:** review PR diff and run full CI in the hosted environment.
- **Merge status:** not reviewed

### 2026-07-07 UTC — ChatGPT

- **Mode:** restored inline visibility follow-up and app status check
- **Branch / PR:** `codex/restored-record-visibility` / PR pending update
- **Scope:** checked local app/repo status, AGENTS.md, CLAUDE.md, Active Workboard, and available PR tooling; no Git remote is configured and `gh` is unavailable, so open-PR/CI status could not be inspected from this container. Closed remaining restored-inline gaps by wiring inline-content hints through Document Archive, tender dashboard API payloads, generated-document output/readiness helpers, final package manifest state, and final-submission readiness without database writes or migrations.
- **Files changed:** `app/api/documents/route.ts`, `app/api/tenders/[id]/route.ts`, `app/dashboard/documents/page.tsx`, `components/final-package-manifest-panel.tsx`, `lib/dashboard-generated-documents.ts`, `lib/engine/document-output-state.ts`, `lib/engine/export-readiness.ts`, `lib/engine/final-submission-readiness.ts`, `lib/generated-document-content.ts`, `tests/generated-document-content.test.ts`, `tests/restored-record-visibility.test.ts`, `operator_handoff.md`
- **Tests:** `./node_modules/.bin/tsx --test tests/restored-record-visibility.test.ts tests/generated-document-content.test.ts tests/document-output-state.test.ts` passed; `npm run typecheck` passed; `npm run lint` passed; placeholder-env `npm run build` passed; `npm test` failed in existing unrelated suites and RUN_DB_INTEGRATION guard while restored inline suites passed.
- **CI / deployment:** CI/open PR status could not be checked because there is no configured git remote and `gh` is not installed; no deployment or Vercel preview created.
- **Known risk:** Full repository test baseline remains red outside this restored-inline scope; live app status was limited to local build/type/lint because no production/Vercel access is configured.
- **Next action:** Review updated PR diff and run GitHub/Vercel CI where repository remote, PR metadata, and production environment are available.
- **Merge status:** not reviewed

### 2026-07-07 UTC — ChatGPT

- **Mode:** restored-record visibility audit and safe query/UI fix
- **Branch / PR:** `codex/restored-record-visibility` / PR pending
- **Scope:** treated inline `fileContent` as a valid restored file when `storagePath` is empty for company documents, company assets, tender source files, and generated documents without altering database data, migrations, roles, AI Analyze, generation, export, BuildPlan, evidence, or metadata gates.
- **Files changed:** `lib/restored-record-visibility.ts`, `tests/restored-record-visibility.test.ts`, `app/api/company/documents/route.ts`, `app/api/company/assets/route.ts`, `app/dashboard/company/page.tsx`, `app/dashboard/assets/page.tsx`, `app/dashboard/tenders/[id]/page.tsx`, `components/tender-source-files-panel.tsx`, `operator_handoff.md`
- **Tests:** `./node_modules/.bin/tsx --test tests/restored-record-visibility.test.ts` passed; `npm run typecheck` passed; `npm run lint` passed; `npm test` failed in unrelated existing suites and integration-environment guards while the new restored-record suite passed; `npm run build` failed without required env vars; build passed with placeholder `DATABASE_URL`, `SESSION_SECRET`, and `GEMINI_API_KEY`.
- **CI / deployment:** GitHub/CI inspection unavailable because `gh` is not installed in the container; no deployment or Vercel preview created.
- **Known risk:** Full repository test baseline remains red outside this scope; no live database mutation was performed.
- **Next action:** Review PR diff and run CI in GitHub/Vercel environment with real required secrets.
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

## Session Log: 2026-07-06T17:58:09Z
- **Tool:** Jules
- **Files Changed:**
  - lib/engine/tender-field-extractors.ts (Expanded to 27 fields with strict grounding)
  - lib/extraction-quality.ts (Implemented perfect page definition and coverage metrics)
  - lib/engine/generation-readiness-gate.ts (Hardened to block on weak extraction/grounding)
  - lib/engine/export-readiness.ts (Hardened hygiene checks for AI traces/leakage)
  - components/extraction-quality-panel.tsx (UI for 20+ metrics and recovery actions)
  - app/api/tenders/[id]/repair-metadata/route.ts (Persistence for expanded metadata)
  - app/dashboard/tenders/[id]/page.tsx (Recovery Center action registry fixes)
- **Tests Run:**
  - tests/tender-field-extractors.test.ts (143 pass)
  - tests/export-readiness.test.ts (19 pass)
  - tests/extraction-quality-gate.test.ts (15 pass)
  - tests/recovery-command-center-actions.test.ts (77 pass)
- **Risks:** The regex-based extractors are deterministic but may miss non-standard formatting. Release gates are now significantly stricter, which may block some "borderline" tenders until manually overridden or repaired.
- **Next Action:** Monitor user feedback on the stricter release gates; expand regex patterns if common variations are missed.
- **Merge Status:** PR Created (claude/extraction-and-gates-hardening). DO NOT MERGE YET.
