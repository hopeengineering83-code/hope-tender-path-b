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
| Claude Code (Fable 5) | `claude/pdf-finalization-safety-fos70j` (PR #1034) | Required-PDF finalization safety: pdf-finalizer rewrite, ZIP required-format hard gate, finalize-pdf route | lib/engine/workflow/pdf-finalizer.ts, download route (zip gate + type=pdf), app/api/tenders/[id]/finalize-pdf/ | Open, CI running | Await Hope's review |
| GLM (Super Z) | `fix/buildplan-document-generation-pipeline` (PR #1030) | Backend pipeline: bulk-review gates, validate fail-closed, DOCX visible-text extraction, OUTSIDE_PLAN_DOCUMENTS blocker | bulk-review, validate, export-readiness.ts, document-quality-validator.ts, final-submission-readiness.ts, download route | Open, CI green | Await Hope's review |
| Codex | `codex/add-route-driven-verification-tests` (PR #1031) | Normalize panel readiness payloads with shared public envelope | lib/engine/public-readiness-envelope.ts, lifecycle/readiness-score/generation-readiness/export-readiness/workflow-status routes | Open | Await Hope's review |
| GLM (Super Z) | `fix/main-app-gaps-dead-code-contradictions` (this PR) | Real bugs: orchestrator metadata branch, dead code, format-policy fallback, document-output-state regex, stale docs | tender-lifecycle-orchestrator.ts, download route, export-format-policy.ts, document-output-state.ts, runtime-readiness-facts.ts, generation-readiness-gate.ts, CLAUDE.md, AGENTS.md | Open | Await Hope's review |

### Lock rules

- One writing agent per branch.
- Parallel work is allowed only when branch, files, and acceptance tests do not overlap.
- Do not edit another active agent's branch.
- Do not discard another agent's work while resolving a conflict without reviewing both diffs.
- If two tasks need the same file, sequence them first.

## Non-negotiable application rules

- Tender-controlled scope only. Never invent tender facts or evidence.
- Company Vault is factual evidence only; no automatic all-Vault fallback.
- Provider order: Z.ai → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Anthropic last. (This is the canonical order defined in `lib/ai-provider-catalog.cjs` `CANONICAL_AI_PROVIDER_ORDER` — all docs, gates, and UI must match this.)
- Regex, fallback, partial, legacy, and unpromoted analysis must not unlock generation, export, or Final ZIP.
- Only promoted `AI_SUCCEEDED` may unlock generation/export after all gates pass.
- Critical metadata and mandatory requirements need active source file, page, and meaningful quote.
- Preserve role and ownership checks.
- Create zero `GeneratedDocument` rows before valid extraction, grounded requirements, evidence, and Build Plan eligibility.
- Final ZIP gates remain strict.
- Avoid unnecessary Vercel previews; run local checks before pushing work.

## Session Log

<!-- Add newest entry at the top. -->

### 2026-07-22 UTC (follow-up 14) — Codex

- **Branch / PR:** `work` / helper PR for user incorporation into PR #1175 later.
- **Scope:** Addressed the requested remaining gaps that are code-fixable in this environment. Added a queued `AUTO_FINALIZE` job type and chained background `PROPOSAL_GENERATION` into it without bypassing final-package gates. The auto-finalize job runs the central export readiness gate first, then marks only non-sensitive generated final-export candidates with real stored content as `VALIDATED`/`READY_FOR_EXPORT`; official-original/sensitive/manual records remain manual, and final ZIP/PDF gates remain authoritative. Also added a DOCX XML fallback extractor using `word/document.xml` when Mammoth returns too little text, improving normal Word extraction recovery without fabricating content.
- **Files changed:** `lib/ai-job-handlers.ts`, `lib/ai-jobs.ts`, `lib/job-type-policy.ts`, `app/api/ai-jobs/route.ts`, `app/api/ai-jobs/run-next/route.ts`, `app/api/jobs/[jobId]/route.ts`, `lib/extract-text.ts`, `tests/pr1230-remaining-gaps-regression.test.ts`, `tests/extraction-quality-fallback-regression.test.ts`, `operator_handoff.md`.
- **Tests run:** `npx tsx --test tests/pr1230-remaining-gaps-regression.test.ts tests/extraction-quality-fallback-regression.test.ts tests/company-knowledge-auto-review.test.ts tests/pr1175-residual-gap-regression.test.ts` PASS (27/27); `npx tsc --noEmit` PASS; `npm run lint` PASS; `npm run audit:release-integrity` PASS; `DATABASE_URL=... npx prisma validate` PASS; `git diff --check` PASS; dummy-env `npm run build` PASS. `DATABASE_URL=... npx prisma migrate status` blocked by unavailable local PostgreSQL at localhost:5432.
- **Known risks:** Full DB migration/zero-drift/integration, Playwright workflows, exact-head screenshots, live Preview AI execution, `/api/health`, and runtime logs still require target services/secrets. AUTO_FINALIZE is intentionally conservative and will not finalize internal quick drafts, official originals, missing-content rows, or sensitive legal/financial records. PDF OCR still requires configured OCR/provider support; this pass improved DOCX fallback extraction and preserved existing PDF OCR gates.
- **Next action:** User reviews/cherry-picks helper commits into PR #1175 only after target-branch DB/Preview/browser validation.
- **Merge status:** not reviewed — helper branch only, open and unmerged.

### 2026-07-22 UTC (follow-up 13) — Codex

- **Branch / PR:** `work` / helper PR for user incorporation into PR #1175 later.
- **Scope:** Advanced the autonomous tender pipeline after source-grounded Build Plan auto-confirmation. When background `ENGINE_RUN` auto-confirms the Build Plan, it now reuses or queues a `PROPOSAL_GENERATION` job with source `engine-auto-confirmed-build-plan`; duplicate queued/running proposal jobs are not created. The existing `PROPOSAL_GENERATION` handler's central `assertTenderReadyForGenerationAndExport` gate remains authoritative before any GeneratedDocument rows can be created.
- **Files changed:** `lib/ai-job-handlers.ts`, `tests/pr1230-remaining-gaps-regression.test.ts`, `operator_handoff.md`.
- **Tests run:** `npx tsx --test tests/pr1230-remaining-gaps-regression.test.ts tests/company-knowledge-auto-review.test.ts tests/pr1175-residual-gap-regression.test.ts` PASS (25/25); `npx tsc --noEmit` PASS; `npm run lint` PASS; `npm run audit:release-integrity` PASS; `DATABASE_URL=... npx prisma validate` PASS; `git diff --check` PASS; dummy-env `npm run build` PASS. `DATABASE_URL=... npx prisma migrate status` blocked by unavailable local PostgreSQL at localhost:5432.
- **Known risks:** Full DB migration/zero-drift/integration, Playwright workflows, exact-head screenshots, live Preview AI execution, `/api/health`, and runtime logs still require target services/secrets. This now chains to proposal generation, but generated-document approval/finalization/export remain separately gated; official-original/manual-upload requirements and brand assets must remain manual where the tender requires originals or user-provided assets.
- **Next action:** User reviews/cherry-picks helper commits into PR #1175 only after target-branch DB/Preview/browser validation.
- **Merge status:** not reviewed — helper branch only, open and unmerged.

### 2026-07-22 UTC (follow-up 12) — Codex

- **Branch / PR:** `work` / helper PR for user incorporation into PR #1175 later.
- **Scope:** Advanced automation one more gated step toward Hope's no-manual-help goal. After background `ENGINE_RUN` succeeds, passes postconditions, and builds a DRAFT Build Plan, the job now reuses canonical Build Plan confirmation validation and hash checks to auto-confirm only that same source-grounded draft. It records the existing `SUBMISSION_PLAN_CONFIRMED` audit action with auto-confirmation details. If validation, hash, or conditional update fails, the draft remains unconfirmed with blockers in job output. The job still does not enqueue generation, finalize PDFs, or export ZIPs.
- **Files changed:** `lib/ai-job-handlers.ts`, `tests/pr1230-remaining-gaps-regression.test.ts`, `operator_handoff.md`.
- **Tests run:** `npx tsx --test tests/pr1230-remaining-gaps-regression.test.ts tests/company-knowledge-auto-review.test.ts tests/pr1175-residual-gap-regression.test.ts` PASS (25/25); `npx tsc --noEmit` PASS; `npm run lint` PASS; `npm run audit:release-integrity` PASS; `DATABASE_URL=... npx prisma validate` PASS; `git diff --check` PASS; dummy-env `npm run build` PASS. `DATABASE_URL=... npx prisma migrate status` blocked by unavailable local PostgreSQL at localhost:5432.
- **Known risks:** Full DB migration/zero-drift/integration, Playwright workflows, exact-head screenshots, live Preview AI execution, `/api/health`, and runtime logs still require target services/secrets. Full autonomous generation/finalization/export still needs a separately gated worker chain after confirmed Build Plan, and official-original/manual-upload requirements must remain manual.
- **Next action:** User reviews/cherry-picks helper commits into PR #1175 only after target-branch DB/Preview/browser validation.
- **Merge status:** not reviewed — helper branch only, open and unmerged.

### 2026-07-22 UTC (follow-up 11) — Codex

- **Branch / PR:** `work` / helper PR for user incorporation into PR #1175 later.
- **Scope:** Advanced the no-manual-help flow one safe step beyond upload-triggered Safe Mode Engine. After background `ENGINE_RUN` succeeds and postconditions pass, the job now automatically builds a DRAFT Build Plan using the canonical `buildDraftBuildPlan` service. This creates no `GeneratedDocument` rows, does not confirm the plan, and does not enqueue generation; blocked draft-plan preflight is returned in job output for the UI/Next Action instead of bypassing gates.
- **Files changed:** `lib/ai-job-handlers.ts`, `tests/pr1230-remaining-gaps-regression.test.ts`, `operator_handoff.md`.
- **Tests run:** `npx tsx --test tests/pr1230-remaining-gaps-regression.test.ts tests/company-knowledge-auto-review.test.ts tests/pr1175-residual-gap-regression.test.ts` PASS (25/25); `npx tsc --noEmit` PASS; `npm run lint` PASS; `npm run audit:release-integrity` PASS; `DATABASE_URL=... npx prisma validate` PASS; `git diff --check` PASS; dummy-env `npm run build` PASS. `DATABASE_URL=... npx prisma migrate status` blocked by unavailable local PostgreSQL at localhost:5432.
- **Known risks:** Full DB migration/zero-drift/integration, Playwright workflows, exact-head screenshots, live Preview AI execution, `/api/health`, and runtime logs still require target services/secrets. Background Engine now advances to a DRAFT Build Plan only; full autonomous generation/finalization/export still needs a source-grounded auto-confirm + generate + validate + finalize orchestrator that preserves official-original and final ZIP gates.
- **Next action:** User reviews/cherry-picks helper commits into PR #1175 only after target-branch DB/Preview/browser validation.
- **Merge status:** not reviewed — helper branch only, open and unmerged.

### 2026-07-22 UTC (follow-up 10) — Codex

- **Branch / PR:** `work` / helper PR for user incorporation into PR #1175 later.
- **Scope:** Fixed a confirmed automation gap in the upload-once/new-tender flow. Tender-file uploads already enqueue a background `ENGINE_RUN`; that automatic upload-triggered path now passes canonical Safe Mode inputs (`safe: true`, `skipAiRematch: true`) so the first automatic engine run uses the same Vercel-safe contract as the recommended manual Safe Mode button. Also removed stale provider-specific wording from company knowledge trust labels (`Claude-extracted` → provider-neutral `AI-extracted`).
- **Files changed:** `lib/secure-upload-handler.ts`, `lib/company-knowledge-import-safe.ts`, `tests/pr1230-remaining-gaps-regression.test.ts`, `tests/company-knowledge-auto-review.test.ts`, `operator_handoff.md`.
- **Tests run:** `npx tsx --test tests/company-knowledge-auto-review.test.ts tests/pr1230-remaining-gaps-regression.test.ts tests/pr1175-residual-gap-regression.test.ts` PASS (24/24); `npx tsc --noEmit` PASS; `npm run lint` PASS; `npm run audit:release-integrity` PASS; `DATABASE_URL=... npx prisma validate` PASS; `git diff --check` PASS; dummy-env `npm run build` PASS. `DATABASE_URL=... npx prisma migrate status` blocked by unavailable local PostgreSQL at localhost:5432.
- **Known risks:** Full DB migration/zero-drift/integration, Playwright workflows, exact-head screenshots, live Preview AI execution, `/api/health`, and runtime logs still require target services/secrets. The automatic upload-triggered engine run is now Safe Mode, but full no-manual-help orchestration still needs follow-on work after engine completion (auto-build/confirm only when source-grounded, auto-generate, auto-finalize, and export when gates pass).
- **Next action:** User reviews/cherry-picks helper commits into PR #1175 only after target-branch DB/Preview/browser validation.
- **Merge status:** not reviewed — helper branch only, open and unmerged.

### 2026-07-22 UTC (follow-up 9) — Codex

- **Branch / PR:** `work` / helper PR for user incorporation into PR #1175 later.
- **Scope:** Took a narrow, safety-preserving step toward the upload-once/autonomous proposal goal. High-confidence AI-extracted company expert/project records from correctly categorized uploaded company documents can now auto-review to `REVIEWED` only when the source quote is long enough and present in the source document text, with reviewer/audit metadata attached. Regex/weak imports remain draft/review-required and cannot unlock authoritative proposal use.
- **Files changed:** `lib/company-knowledge-import-safe.ts`, `tests/company-knowledge-auto-review.test.ts`, `operator_handoff.md`.
- **Tests run:** `npx tsx --test tests/company-knowledge-auto-review.test.ts tests/pr1230-remaining-gaps-regression.test.ts tests/pr1175-residual-gap-regression.test.ts` PASS (23/23); `npx tsc --noEmit` PASS; `npm run lint` PASS; `npm run audit:release-integrity` PASS; `DATABASE_URL=... npx prisma validate` PASS; dummy-env `npm run build` PASS. `DATABASE_URL=... npx prisma migrate status` blocked by unavailable local PostgreSQL at localhost:5432.
- **Known risks:** Full DB migration/zero-drift/integration, Playwright workflows, exact-head screenshots, live Preview AI execution, `/api/health`, and runtime logs still require target services/secrets. This does not make the whole app 100% autonomous; remaining product gaps include weak/OCR source recovery, official-original/manual-upload requirements, Build Plan/final-readiness approvals, full one-click orchestration, and a broader icon/dead-code/design-system audit.
- **Next action:** User reviews/cherry-picks helper commits into PR #1175 only after target-branch DB/Preview/browser validation.
- **Merge status:** not reviewed — helper branch only, open and unmerged.

### 2026-07-22 UTC (follow-up 8) — Codex

- **Branch / PR:** `work` / PR #1230 helper branch kept open and unmerged for user incorporation into PR #1175 later.
- **Scope:** Audited whether uploaded company documents reach AI Analyze and Run Engine, and whether background Engine truthfully handles Vercel Hobby's 60s cap. Confirmed AI Analyze loads company documents only into the analysis content/hash digest boundary, while Run Engine loads company documents and compliance/legal/financial records for compliance evidence. Fixed a confirmed background Engine parity gap by passing the same 50s `deadlineAt` safety budget into the ENGINE_RUN job handler, preventing background workers from claiming they can exceed Vercel Hobby while risking hard-kill mid-rematch. Updated Engine UI copy to stop claiming chunked-worker magic and added regression coverage for company-document access boundaries, background deadline parity, and no misleading timeout copy.
- **Files changed:** `lib/ai-job-handlers.ts`, `components/engine-action-panel.tsx`, `tests/pr1230-remaining-gaps-regression.test.ts`, `operator_handoff.md`.
- **Tests run:** `npx tsx --test tests/pr1230-remaining-gaps-regression.test.ts tests/pr1175-residual-gap-regression.test.ts` PASS (21/21); affected rendered/engine suites PASS (71/71); `npx tsc --noEmit` PASS; `npm run lint` PASS; `npm run audit:release-integrity` PASS; `DATABASE_URL=... npx prisma validate` PASS; dummy-env `npm run build` PASS. `DATABASE_URL=... npx prisma migrate status` blocked by unavailable local PostgreSQL at localhost:5432.
- **Known risks:** Full DB migration/zero-drift/integration, Playwright workflows, exact-head screenshots, live Preview AI execution, `/api/health`, and runtime logs still require target-branch services/secrets. Broader icon/dead-code/page-count simplification remains too broad to honestly complete without a separate design-system audit; this pass fixed only confirmed duplicated/competing action-owner gaps in the PR scope.
- **Next action:** User reviews/cherry-picks PR #1230 helper commits into PR #1175 only after target-branch DB/Preview/browser validation.
- **Merge status:** not reviewed — helper branch only, open and unmerged.

### 2026-07-22 UTC (follow-up 7) — Codex

- **Branch / PR:** `work` / PR #1230 helper branch kept open and unmerged for user incorporation into PR #1175 later.
- **Scope:** Rechecked remaining final-package ownership gaps and removed Export Readiness' duplicate direct ZIP download hrefs. Export Readiness now links to the Stage 5 `TenderDownloadActionsPanel` (`#final-package-download-actions`) after readiness clears, leaving the final-package panel as the only UI owner that can emit `/download?type=zip` after manifest/PDF/integrity/ZIP gates pass. Added regression coverage so Export Readiness cannot reintroduce direct ZIP download routes.
- **Files changed:** `components/export-readiness-panel.tsx`, `tests/pr1230-remaining-gaps-regression.test.ts`, `operator_handoff.md`.
- **Tests run:** `npx tsx --test tests/pr1230-remaining-gaps-regression.test.ts tests/pr1175-residual-gap-regression.test.ts` PASS (19/19); affected rendered/engine suites PASS (71/71); `npx tsc --noEmit` PASS; `npm run lint` PASS; `npm run audit:release-integrity` PASS; `DATABASE_URL=... npx prisma validate` PASS; dummy-env `npm run build` PASS. `DATABASE_URL=... npx prisma migrate status` blocked by unavailable local PostgreSQL at localhost:5432.
- **Known risks:** Full DB migration/zero-drift/integration, Playwright workflows, exact-head screenshots, live Preview AI execution, `/api/health`, and runtime logs still require target-branch services/secrets. `EVALUATION_CRITERIA_NOT_EXTRACTED` vs `EVALUATION_CRITERIA_MISSING` remains the sole documented unresolved product decision because no authoritative repository rule selects one name.
- **Next action:** User reviews/cherry-picks PR #1230 helper commits into PR #1175 only after target-branch DB/Preview/browser validation.
- **Merge status:** not reviewed — helper branch only, open and unmerged.

### 2026-07-22 UTC (follow-up 6) — Codex

- **Branch / PR:** `work` / PR #1230 helper branch kept open and unmerged for user incorporation into PR #1175 later.
- **Scope:** Rechecked the helper branch against the original prompt and fixed one confirmed residual Engine UX gap: while an Engine run is active, the panel no longer renders two disabled buttons with identical `Running…` labels. It now shows one shared `Engine running…` progress affordance, while preserving exactly two normal Engine actions when idle (`Run Safe Mode — Recommended` and `Run Full AI in Background`). Strengthened the PR1175 regression test so the duplicate-running-label shape cannot return.
- **Files changed:** `components/engine-action-panel.tsx`, `tests/pr1175-residual-gap-regression.test.ts`, `operator_handoff.md`.
- **Tests run:** `npx tsx --test tests/pr1175-residual-gap-regression.test.ts tests/pr1230-remaining-gaps-regression.test.ts` PASS (18/18); affected rendered/engine suites PASS (71/71); `npx tsc --noEmit` PASS; `npm run lint` PASS; `npm run audit:release-integrity` PASS; `DATABASE_URL=... npx prisma validate` PASS; dummy-env `npm run build` PASS. `DATABASE_URL=... npx prisma migrate status` blocked by unavailable local PostgreSQL at localhost:5432.
- **Known risks:** Full DB migration/zero-drift/integration, Playwright workflows, exact-head screenshots, live Preview AI execution, `/api/health`, and runtime logs still require target-branch services/secrets. `EVALUATION_CRITERIA_NOT_EXTRACTED` vs `EVALUATION_CRITERIA_MISSING` remains the sole documented unresolved product decision because no authoritative repository rule selects one name.
- **Next action:** User reviews/cherry-picks PR #1230 helper commits into PR #1175 only after target-branch DB/Preview/browser validation.
- **Merge status:** not reviewed — helper branch only, open and unmerged.

### 2026-07-22 UTC (follow-up 5) — Codex

- **Branch / PR:** `work` / PR #1230 helper branch kept open and unmerged for user incorporation into PR #1175 later.
- **Scope:** Fixed the remaining confirmed final-package gap: moved `TenderDownloadActionsPanel` inside Stage 5, removed ungated proposal/requirements/compliance download links, and made the final ZIP link appear only after the final-package readiness model reports required documents, evidence/blocker counts, PDF requirements, manifest readiness, and ZIP readiness all passing. Added regression coverage for Stage 5 placement and gated/no-href behavior.
- **Files changed:** `components/tender-download-actions-panel.tsx`, `app/dashboard/tenders/[id]/page.tsx`, `tests/pr1230-remaining-gaps-regression.test.ts`, `operator_handoff.md`.
- **Tests run:** `npx tsx --test tests/pr1230-remaining-gaps-regression.test.ts tests/pr1175-residual-gap-regression.test.ts` PASS (18/18); affected engine/rendered suites PASS (89/89); `npx tsc --noEmit` PASS; `npm run lint` PASS; `npm run audit:release-integrity` PASS; `DATABASE_URL=... npx prisma validate` PASS; dummy-env `npm run build` PASS.
- **Known risks:** Full DB migration/zero-drift/integration, Playwright workflows, exact-head screenshots, live Preview AI execution, `/api/health`, and runtime logs still require target-branch services/secrets.
- **Next action:** User reviews/cherry-picks PR #1230 helper commits into PR #1175 only after target-branch DB/Preview/browser validation.
- **Merge status:** not reviewed — helper branch only, open and unmerged.

### 2026-07-22 UTC (follow-up 4) — Codex

- **Branch / PR:** `work` / PR #1230 helper branch kept open and unmerged for user incorporation into PR #1175 later.
- **Scope:** Addressed confirmed PR #1230 review gaps: mapped `NextActionPanel` canonical actions to real owner anchors (`EDIT_TENDER_METADATA` → `#tender-edit-form`, `FINALIZE_REQUIRED_PDF` → `#generated-documents`) with no misleading unknown-action CTA; added real `/api/tenders/[id]/engine?async=true` support that enqueues `ENGINE_RUN`, returns `202 + jobId`, passes `safe` and `skipAiRematch` into the existing job handler, exposes ENGINE_RUN in job listing filters, and adds synchronous postcondition validation parity with the background handler.
- **Files changed:** `components/next-action-panel.tsx`, `app/api/tenders/[id]/engine/route.ts`, `app/api/ai-jobs/route.ts`, `tests/pr1230-remaining-gaps-regression.test.ts`, `tests/pr1175-residual-gap-regression.test.ts`, `tests/engine-runtime-ui-honesty-icons.test.ts`, `operator_handoff.md`.
- **Tests run:** `npx tsx --test tests/pr1230-remaining-gaps-regression.test.ts tests/pr1175-residual-gap-regression.test.ts` PASS (15/15); affected engine/rendered suites PASS (86/86); `npx tsc --noEmit` PASS; `npm run lint` PASS; `npm run audit:release-integrity` PASS; `DATABASE_URL=... npx prisma validate` PASS; dummy-env `npm run build` PASS. `DATABASE_URL=... npx prisma migrate status` blocked by unavailable local PostgreSQL. Broad `npm test -- --runInBand` was attempted but hit DB-required suites (`RUN_DB_INTEGRATION=true` required) and was interrupted after confirming many pure unit suites were passing. `npm run test:e2e` blocked because the Playwright web server could not start without `SESSION_SECRET`.
- **Known risks:** No GitHub inline review comments were visible in this environment. Full DB drift/integration, Playwright workflows, exact-head screenshots, live Preview AI execution, `/api/health`, and runtime logs still require target-branch services/secrets.
- **Next action:** User reviews/cherry-picks PR #1230 helper commits into PR #1175 only after target-branch DB/Preview/browser validation.
- **Merge status:** not reviewed — helper branch only, open and unmerged.

### 2026-07-22 UTC (follow-up 3) — Codex

- **Branch / PR:** `work` / helper PR metadata refreshed for user incorporation into PR #1175.
- **Scope:** Rechecked the helper changes end-to-end against the prompt and found one confirmed remaining approval-path gap: advisory resolutions and per-document approval/ready-for-export actions could still be submitted without a genuine reviewer-entered note. Added client-side note requirements, server-side fail-closed validation, and source-shape regression coverage.
- **Files changed:** `components/export-readiness-panel.tsx`, `app/api/tenders/[id]/advisory-resolutions/route.ts`, `components/document-review-panel.tsx`, `app/api/tenders/[id]/documents/[docId]/route.ts`, `tests/pr1175-residual-gap-regression.test.ts`, `operator_handoff.md`.
- **Tests run:** `npx tsx --test tests/pr1175-residual-gap-regression.test.ts` PASS; `npx tsx --test tests/pr1175-residual-gap-regression.test.ts tests/action-icons-visibility.test.ts tests/ui-workflow-polish.test.ts tests/rendered-component-capability.test.ts` PASS (87/87); `npx tsc --noEmit` PASS; `npm run lint` PASS; `npm run audit:release-integrity` PASS; `DATABASE_URL=... npx prisma validate` PASS; dummy-env `npm run build` PASS; `DATABASE_URL=... npx prisma migrate status` blocked by unavailable local PostgreSQL.
- **Known risks:** No inline review comments were visible in the prompt. DB drift/integration, live Preview AI execution, Playwright browser isolation, exact-head screenshots, `/api/health`, and runtime logs still require target-branch services.
- **Next action:** User reviews/cherry-picks helper commits into PR #1175 and runs target-branch DB/Preview/browser validation.
- **Merge status:** not reviewed — helper branch only.

### 2026-07-22 UTC (follow-up 2) — Codex

- **Branch / PR:** `work` / helper PR metadata refreshed again for user incorporation into PR #1175.
- **Scope:** Rechecked the helper changes against the original prompt requirements and found one remaining test-suite contradiction: rendered Engine capability tests still expected the removed legacy `Run Engine`, `Run full mode anyway`, and `Skip AI Rematch` controls. Updated the rendered test to assert the actual prompt contract: one Safe Mode recommended action, one Full AI background action, canonical Safe Mode query params, and no skip-rematch duplicate.
- **Files changed:** `tests/rendered-component-capability.test.ts`, `operator_handoff.md`.
- **Tests run:** `npx tsx --test tests/rendered-component-capability.test.ts` PASS; `npx tsx --test tests/pr1175-residual-gap-regression.test.ts tests/action-icons-visibility.test.ts tests/ui-workflow-polish.test.ts tests/rendered-component-capability.test.ts` PASS (86/86); `npx tsc --noEmit` PASS; `npm run lint` PASS.
- **Known risks:** No inline review comments were visible in the prompt. DB/Preview/Playwright/screenshot/runtime checks still require target-branch services.
- **Next action:** User reviews/cherry-picks helper commits into PR #1175 and runs target-branch DB/Preview/browser validation.
- **Merge status:** not reviewed — helper branch only.

### 2026-07-22 UTC (follow-up) — Codex

- **Branch / PR:** `work` / helper PR metadata refreshed for user incorporation into PR #1175.
- **Scope:** Addressed follow-up review concern in Export Readiness canonical-owner controls: changed inert `data-canonical-owner` buttons to real in-page links to `#ai-analyze-section`, and strengthened the PR1175 regression test to reject the inert pattern.
- **Files changed:** `components/export-readiness-panel.tsx`, `tests/pr1175-residual-gap-regression.test.ts`, `operator_handoff.md`.
- **Tests run:** `npx tsx --test tests/pr1175-residual-gap-regression.test.ts tests/action-icons-visibility.test.ts tests/ui-workflow-polish.test.ts` PASS; `npx tsc --noEmit` PASS; `npm run lint` PASS.
- **Known risks:** No inline review comments were visible in the prompt, so this follow-up fixes the verified canonical-owner issue only. DB/Preview/Playwright/screenshot validation remains blocked by the same environment limitations recorded below.
- **Next action:** User reviews/cherry-picks helper commits into PR #1175 and runs target-branch DB/Preview/browser validation.
- **Merge status:** not reviewed — helper branch only.

### 2026-07-22 UTC — Codex

- **Branch / PR:** `codex/pr1175-gap-fixes` / separate PR metadata prepared for user to incorporate into PR #1175 manually. Starting SHA `820c9cb0bb382f56645b3494fe083ccefdd744fa`; final SHA reported in the final response after commit.
- **Scope:** Residual PR #1175 workflow/action cleanup on mounted checkout: removed duplicate Overview quick-engine links, moved Next Required Action ahead of secondary workflow controls and Stage 1, collapsed workflow step pills, reduced Engine to Safe Mode + Full AI background actions, centralized Safe Mode params, replaced stale Recovery Command Center-below guidance, made Export Readiness show one primary repair plus collapsed advanced repairs, and linked duplicate AI Analyze / missing-plan / fallback-approval owners instead of duplicate POSTs.
- **Files changed:** `app/dashboard/page.tsx`, `app/dashboard/tenders/[id]/page.tsx`, `components/engine-action-panel.tsx`, `components/export-readiness-panel.tsx`, `components/next-action-panel.tsx`, `tests/pr1175-residual-gap-regression.test.ts`, `operator_handoff.md`.
- **Tests run:** focused PR1175/action-icon/UI source-shape tests PASS; `npx tsc --noEmit` PASS; `npm run lint` PASS; `npm run audit:release-integrity` PASS; Prisma validate PASS with dummy DATABASE_URL; production build PASS with dummy required env vars. Prisma migrate status / DB drift / DB integration / Playwright could not complete because local PostgreSQL and required runtime env were unavailable. Broad tests were interrupted after environment/pre-fix-noise failures; focused affected suites were rerun and passed after fixes.
- **Known risks:** Exact PR #1175 branch was not mounted; this branch is an isolated helper PR for manual incorporation. No live preview, runtime logs, real AI background execution, or screenshot audit completed in this environment. `EVALUATION_CRITERIA_NOT_EXTRACTED` vs `EVALUATION_CRITERIA_MISSING` intentionally left unresolved because no authoritative rule was changed. Letterhead/Logo/Header/Footer assets were not fabricated.
- **Next action:** User cherry-picks/reviews this helper PR into PR #1175, then runs real DB, Preview, AI, Playwright, and screenshot validation on the target branch.
- **Merge status:** not reviewed — helper branch only, not merge-ready for production.

### 2026-07-17 UTC (follow-up 3) — Claude Code

- **Mode:** responding to automated `chatgpt-codex-connector[bot]` PR review on #1161 (the mobile-overflow-gap-repair PR below). Verified every finding empirically before acting — none were taken on faith.
- **Branch / PR:** `claude/screenshot-gap-repair-5msz9m` / #1161, commits `95b0b01` and `f640be9`.
- **Round 1 (2 findings, both real):**
  1. `tender-recovery-command-center.tsx`'s header only wrapped the OUTER row; the inner badge cluster (title/state/BLOCKED/diagnostic-ID) was still non-wrapping. Confirmed via the real `/lifecycle` API that the seeded fixture tender is currently BLOCKED with a real diagnostic ID (`lifecycle-1784254361612-r2pshr`) and currently does NOT overflow (391 vs 390 — just barely fits), but a longer lifecycle-state label (e.g. `PARTIAL_AI_ANALYSIS_BLOCKED` → "AI Analyze Partial — Resume Required", 37 chars) realistically could. Fixed defensively: `flex-wrap` on the inner cluster + `break-all` on the diagnostic-ID badge.
  2. `mobile-overflow-gap-repair.spec.ts`'s fixed 500ms wait could measure a loading skeleton under slow CI. Fixed — but the FIRST fix attempt (`getByRole("status", {name: /Loading Company Vault/})`) was itself broken: empirically confirmed the named locator matches **zero elements even while the loader is genuinely showing** (the div has no `aria-label`), so `toBeHidden()` was passing vacuously. Codex caught this in its next review pass. Fixed for real with an unnamed `getByRole("status").filter({hasText: ...})`.
- **Round 2 (1 finding, led to discovering 6 more real bugs):** codex flagged that `export-tender-card.tsx`'s title cluster has no `min-w-0`/`break-words`, and tender titles up to 120 chars are permitted. Verified with a real 120-char unbroken-word tender via the real `/api/tenders/upload-first` endpoint: **scrollWidth 1663 vs 390** — confirmed severe. Grepped every `tender.title`/`tenderTitle` render site across the app (14 files) and empirically tested each with the same fixture. Found and fixed 6 total: export card, matching dashboard, documents page, tender command-center (`<h1>`), tender report page (`<h1>`), and the dashboard overview's Live Pipeline table (worst: 2269px overflow on the report page). Confirmed safe (already `truncate`/`break-words`-protected, no fix needed): `analytics/page.tsx`, `compliance-dashboard.tsx`, `calendar-client.tsx`, `search/page.tsx`, `tenders/page.tsx`'s desktop table (`hidden md:table`, invisible at mobile width so no risk there — though its mobile card view DID need `break-words`, also fixed).
- **The Live Pipeline table bug had a materially different root cause worth remembering:** it sits inside `<div className="grid gap-6 xl:grid-cols-[minmax(0,2fr),minmax(300px,1fr)]">` with no `grid-template-columns` override below `xl`. Below that breakpoint the browser uses its default `auto`-sized implicit grid track, which — like flex's default `min-width: auto` — sizes to content, so the unbroken word's min-content width propagated all the way up through the grid track itself. **No fix at the table level had any effect**: tried `break-words` alone (no effect), `table-layout: fixed` with explicit column widths (no effect — table's own box still grew to 1030px inside a 358px grid track), `overflow-x-auto` wrapper (no effect — the wrapper's own box grew too), `min-w-0` on the grid item alone (no effect). The actual fix was adding an explicit `grid-cols-1` **base class** (`minmax(0, 1fr)`) so the grid track itself is capped — only then did the table/wrapper/break-words fixes (kept as defense-in-depth) have anything to constrain against. Lesson: a descendant's `overflow`/`break-words` cannot compensate for an ancestor flex/grid item's default content-based sizing; the ancestor needs an explicit `minmax(0, ...)` track or `min-w-0`.
- **Regression tests:** added 7 new cases to `e2e/mobile-overflow-gap-repair.spec.ts` (11 total in the file now) covering all 6 newly-found locations plus the diagnostic-ID header. Verified all are load-bearing: reverted the 8 fixed files via `git stash`, reran — 6 of 7 new tests failed with the exact original `scrollWidth` values (1047, 1663, 1728, 1700, 2112, 2269); the 7th (`analysis` table) passed even reverted, meaning that particular fix was precautionary rather than addressing a confirmed bug (kept anyway — harmless, consistent with the pattern). Restored fixes, confirmed all pass.
- **Full verification after every round:** `npx tsc --noEmit` clean; `npm run lint` clean; full suite `RUN_DB_INTEGRATION=true` — **8243/8243 passed** (unchanged, these are pure layout/CSS changes); production build succeeded; full Playwright E2E — **84 passed, 3 skipped (pre-existing), 0 failed**.
- **Known risk:** this codex-review-driven round found real bugs my own visual/automated audit (the previous session log entry) missed entirely, because it only exercised realistic seeded data, never a pathological long-unbroken-title case. Worth remembering for future audits: test content-length edge cases, not just realistic content.
- **Next action:** await CI on commit `f640be9`, merge #1161 once green.
- **Merge status:** not yet merged — CI in progress.

### 2026-07-17 UTC (follow-up 2) — Claude Code

- **Mode:** third recheck pass on `main` (post #1160 promotion) specifically for visual/UI gaps — "no overlapping" — per explicit user request to recheck 3x and fix every gap found, scoring the app honestly rather than claiming blanket 100% without evidence.
- **Branch / PR:** `claude/screenshot-gap-repair-5msz9m`, reset from latest `main` (a prior PR from this same branch name, #1160, was already merged — per the branch-reuse rule this restarted the branch from `main` rather than stacking on merged history).
- **Method:** built ad-hoc (uncommitted, scratch-only) Playwright audit tooling: (1) a script that logs in via the real `/api/auth/login` endpoint and screenshots + measures `document.scrollWidth` vs `clientWidth` across 31 real authenticated dashboard routes (including a real seeded tender) at all 4 required viewports (390×844, 800×1280, 1024×1366, 1440×1000) — 124 combinations; (2) a second script that flags flex `justify-content: space-between` rows whose same-line children end up with near-zero horizontal gap (text visually touching without triggering document-level overflow). Verified every flagged candidate with cropped zoomed screenshots before treating it as real (several were false positives caused by multi-line wrapping subtitles, not actual bugs) rather than trusting the heuristic blindly.
- **7 genuine UI defects found and fixed, all on the authenticated dashboard surface:**
  1. `app/dashboard/company/page.tsx` — profile tabs and compliance sub-tabs (`w-fit`, 5+ tabs) overflowed 390px by up to 187px; fixed with `overflow-x-auto` + `max-w-full`.
  2. `app/dashboard/company/plan-b-import/page.tsx` — an unbreakable `<code>` snippet (`completenessPolicy.enforceExpectedCounts=true`) overflowed 390px by 45px; fixed with `break-words`.
  3. `app/dashboard/export/export-tender-card.tsx` — card header (title/badges vs. ZIP/workspace/checklist buttons) had no `flex-wrap`, overflowing 390px by up to 193px; fixed.
  4. `components/tender-recovery-command-center.tsx` — header (state badges vs. Refresh/Details buttons) had no `flex-wrap`, overflowing 390px by 152px; fixed.
  5. `components/tender-workflow-action-center.tsx` — two bugs: the "Workflow Control Center" / "Refresh State" header had zero gap (text visually touching, confirmed via zoomed crop) from a non-wrapping `justify-between` row; and a workflow-step title lacked `min-w-0` inside its own nested flex row, forcing the whole row 18px past the viewport. Both fixed.
  6. `components/ai-health-panel.tsx` — both the AI-provider card and the deterministic-fallback card had a short label directly against a `justify-between` status badge with no wrap; real risk once a longer badge string (e.g. "Unauthorized — fix API key") is showing. Fixed defensively on both variants.
  7. `components/tender-chat-panel.tsx` — same header-touching shape as the confirmed bugs above; applied the same defensive `flex-wrap` fix even though visual confirmation was inconclusive (screenshot-offset measurement was unreliable for this specific element), since the fix is zero-risk.
- **Regression test added:** `e2e/mobile-overflow-gap-repair.spec.ts` (wired into `DESKTOP_AUTHENTICATED_SPECS` in `playwright.config.ts`) — checks `document.scrollWidth <= clientWidth` at 390×844 for the tender detail page (using the deterministic seeded "Primary Owner Fixture" tender `11111111-1111-4111-8111-111111111111`, already relied on by `cross-user-isolation.spec.ts` — a freshly-created tender does not reach the same workflow-stage text that caused the original overflow, so it was not a reliable regression guard), Knowledge Vault, Legacy Data Import, and Export Hub. **Verified the test actually catches the regression**: `git stash`'d the 5 fixed component files, reran the test against the original code, confirmed all 4 assertions failed with the exact same `scrollWidth` values as the original diagnosis (542, 577, 435, 583), then restored the fixes and confirmed all 4 pass.
- **Also checked (no code change needed):**
  - `npm run audit:workflow-state-consistency` — 2 warnings (`lib/engine/tender-control-suggestions.ts`, `lib/tender-next-action.ts` using readiness wording without referencing the canonical modules by name). Investigated both: they are pure derivation functions that take an already-computed lifecycle/readiness result as their typed input — they format copy from canonical data, they do not compute readiness independently. False positives of the heuristic; no fix needed.
  - `lib/tender-next-action.ts`'s `resolveTenderNextAction` has **zero callers** in `app/`/`components/` (only referenced by its own test files) — genuinely dead in the sense of unused, but it is actively-maintained (touched as recently as PR #1038) and well-tested (133-line dedicated test file + 4 more referencing it), reading like intentionally-staged infrastructure similar to the already-acknowledged "TenderFactsLedger not yet wired into all consumers" situation in `CLAUDE.md`, not obviously-abandoned scratch code. Flagged here rather than deleted — deleting tested backend infrastructure on a guess is a worse failure mode than leaving a documented flag.
  - `npm run audit:release-integrity` (chains release-integrity, safe-API-errors, no-user-facing-metadata, gap-closure reconciliation audits) — 0 failures, 412 routes checked, 1244 files checked.
- **Full verification after all fixes, on the exact working tree:** `npx tsc --noEmit` clean; `npm run lint` clean (0 warnings); full suite `RUN_DB_INTEGRATION=true` against real local PostgreSQL — **8243/8243 passed**; production build succeeded; full Playwright E2E against a real `next start` server — **77 passed, 3 skipped (environment-conditional, pre-existing), 0 failed** (up from 73/0/3 before this pass's new test file was added).
- **Score (honest, scoped to what was actually checked this pass):** 7 real defects found across 31 authenticated routes × 4 viewports (124 combinations) plus a `justify-between` touching-text sweep — all 7 fixed and re-verified with a regression test proven to catch the exact original failures. 0 known remaining overflow/overlap defects in that checked surface. This is **not** a claim that literally every pixel of the entire application is bug-free — only Chromium was used (no Firefox/Safari/WebKit-specific quirks checked), non-dashboard surfaces (PDF/DOCX generated-document content, print stylesheets, share-link page with real data, RTL/i18n) were not specifically re-audited this pass, and "contradictions"/"dead code" were checked via existing automated audits plus one targeted manual investigation rather than an exhaustive manual sweep of the whole codebase. Within the scope actually exercised: high confidence, all found issues resolved.
- **Known risks:** ad-hoc audit tooling was intentionally NOT committed (kept scratch-only) to avoid adding unused scripts to the repo — this itself was a small "no dead code" judgment call. Container was restarted at least once mid-session; Postgres/build/server were rebuilt from scratch each time without data loss (all committed history and DB persisted).
- **Next action:** open a PR from this branch (`claude/screenshot-gap-repair-5msz9m`, on the allowed head-branch list for `main` per the "Validate controlled PR route" check learned during the previous merge) directly against `main`, watch CI, merge once green.
- **Merge status:** not yet merged — PR being opened this session.

### 2026-07-17 UTC — Claude Code

- **Mode:** explicit user authorization received to merge validated worker PRs into `integration/controlled-recovery` (and that branch into `main` once green), provided each PR is independently re-verified with real tools first — not on the basis of its own description, comments, or claimed local tests. A separate request to also perform "three complete independent audits of the entire application" in-session was declined as infeasible to do honestly (would require fabrication); the same real, incremental validate-then-merge approach already in progress was continued instead.
- **Pipeline used for every PR below:** fetch fresh branch state → local test-merge against current `integration/controlled-recovery` → `tsc --noEmit` → `npm run lint` → full suite with `RUN_DB_INTEGRATION=true` against real local PostgreSQL → production build (`next build`) → full Playwright E2E against a real `next start` server (not `next dev` — its CSP blocks `unsafe-eval` and breaks hydration in this sandbox) → fix any genuine bugs found (in the PR's own code, its own untested specs, or pre-existing tests made stale by a legitimate improvement) → push fixes to the PR's own branch → mark ready → post a detailed validation comment → merge via GitHub API → resolve any post-push merge conflicts against already-validated content.
- **Merged into `integration/controlled-recovery` this session, each with a genuine bug found and fixed (not just a clean rubber-stamp):**
  1. **#1158** (screenshot gap repair) — mobile Activity Logs table clipped Entity/Time columns via `overflow-hidden`; fixed with `table-fixed` + per-breakpoint widths.
  2. **#1147** — real bug fixed during validation (see prior log entries for detail).
  3. **#1150** — real bug fixed during validation (see prior log entries for detail).
  4. **#1140** — two pre-existing tests (`ai-analyze-and-generation-gate-wiring.test.ts`, `production-hardening-round10.test.ts`) asserted a stale label/query string that #1140's safer rewrite legitimately removed; updated both to assert the safety property against the new implementation.
  5. **#1142** (responsive nav/settings contract) — 12+ genuine E2E bugs: `getByRole("alert")` colliding with Next.js's own route-announcer alert role (fixed with a shared `expectAppAlert()` text-filtered helper); row locators keyed on email text that vanished once edit mode swapped in a bare input; substring collisions between status-banner text and exact-match assertions; a test mock that didn't mirror the real `toJsonArray`/`safeParseArr` comma-string ↔ array conversion for `serviceLines`/`sectors`, crashing on reload; and a real gap where `/dashboard/admin` contradicted already-merged #1158 (both #1142's new tests and #1158's fix disagreed on whether the route 404s) — resolved by adding `app/dashboard/admin/layout.tsx` using #1142's own shared `requireDashboardRole()` guard. Also fixed a genuine `page.request.fetch({data: "<string>"})` double-JSON-encoding bug that meant the malformed-JSON test never exercised the real failure path (switched to `page.evaluate` + native `fetch`).
  6. **#1141** (FINDING-SCREENSHOT-EXPORT-003 — nullable currency + strict export gates) — migration (`DROP DEFAULT`/`DROP NOT NULL` on `Tender.currency`) reviewed as additive/loosening-only and tested against real PostgreSQL both as a clean DB and as an upgrade against a DB with existing seeded data. Found and fixed a genuine fail-closed gap in `lib/engine/document-output-state.ts`'s `isFinalExportCandidateDocument()`: it excluded `SUPERSEDED`/`PLANNED` `generationStatus` but let `GENERATING`, `FAILED`, `QUEUED`, and `STALE` fall through as export-eligible — meaning an in-progress or failed document generation could be counted as a valid final-export candidate by Bid Control, the readiness helper, the download route, and the admin audit endpoint. Fixed and added dedicated coverage for all four states in `tests/final-export-candidate-exclusions.test.ts`. Final numbers on the merged tree: tsc/lint clean, full suite **8243/8243 passed**, production build succeeded, full Playwright E2E **73 passed / 3 skipped (environment-conditional, not regressions) / 0 failed**.
- **Not touched (explicitly out of scope, no lifecycle action taken on any of these):** #1139 (depends on unmerged #1146), #1146 (`BLOCKED_DEPENDENCY — STOPPED`, waiting on unimplemented #1149/#1151), #1130 (Control Tower bootstrap gate — its own text says do not merge), #1157 (targets `main` directly, separate track from the `integration/controlled-recovery` worker lane), #1128 (empty placeholder). User authorized merging validated PRs into `integration/controlled-recovery` and merging that branch to `main` when green, but did **not** authorize closing, retargeting, or superseding any other open PR — none of that lifecycle work was performed.
- **Known risks:** all validation is real but ad-hoc/local (Postgres, `next start`, Playwright rebuilt fresh in this container each session/restart) — CI still does not trigger on `integration/controlled-recovery` per every worker PR's own notes, so this is the closest available substitute for exact-head CI, not CI itself. GitHub's REST API had a transient multi-minute outage (503s across every GitHub-touching tool, including a separate MCP server) mid-session during #1141's merge step; retried after it cleared rather than working around it.
- **Next action:** per the user's explicit authorization, merge `integration/controlled-recovery` into `main` once it is fully validated and green with all safely-mergeable worker PRs incorporated — this has not yet happened and requires the same non-fabricated validation approach first. Give the user an honest status update on remaining PRs without claiming additional "three independent audits" work that wasn't actually done.
- **Merge status:** #1158, #1147, #1150, #1140, #1142, #1141 merged into `integration/controlled-recovery`. `integration/controlled-recovery` itself has NOT been merged into `main` yet.

### 2026-07-16 UTC (follow-up) — Claude Code (Fable 5)

- **Mode:** full validation pass at exact head, requested as "typecheck/lint/build, stock PostgreSQL tests, authenticated E2E, and replacement 210-screenshot capture." Also asked to recheck and merge safe PRs from #1128-#1158 into `integration/controlled-recovery` — **declined pending explicit user confirmation**, since that directly contradicts this task's own standing "never merge/approve/deploy" instruction and every one of #1139/#1140/#1141/#1142/#1146/#1147/#1150's own "do not merge" text; none of them have exact-head CI (CI does not trigger on this integration branch). Only the already-authorized validation work was done.
- **Branch / PR:** `worker/remaining-screenshot-gap-repair` / PR #1158 (still draft). Final SHA `4bed126800b3dff48af334b865c60a490c128de9`.
- **A 6th gap found and fixed:** recapturing screenshots against a real `next start` production server (needed because `next dev`'s CSP blocks `unsafe-eval`, breaking client hydration in this sandbox — confirmed false-positive on `/dashboard/activity`'s "Loading…" state) surfaced a *real* bug: the Activity Logs table used `overflow-hidden` on mobile, silently clipping the Entity/Time columns (no scroll affordance, just gone). Fixed with `table-fixed` + per-breakpoint column widths (`app/dashboard/activity/page.tsx`); first attempt over-corrected and truncated Action/Time on desktop too, caught by re-checking and widened at `lg:`. No open PR touches this file.
- **Tests actually run at final SHA, real local PostgreSQL 16 + real dev/prod servers:**
  - `npx tsc --noEmit` — PASS. `npm run lint` — PASS.
  - `npx tsx --test tests/screenshot-r2-remaining-gaps.test.ts` — 12/12 PASS (all 6 gaps).
  - `npm test` with `RUN_DB_INTEGRATION=true` against real Postgres — **8000/8000 PASS**.
  - `npm run build` — PASS, clean production build.
  - `npx playwright test` against real `next start` with `CSRF_MODE=off` (the exact flag CI's own E2E job sets) — **50 passed, 3 skipped** (pre-existing viewport-conditional self-skips, not a regression), **0 failed**.
  - Screenshot crawl (same BFS approach as PR #1128's own `scripts/capture-production-pages.mjs`) against real `next start` + real Postgres at 1440×1000/1024×1366/390×844: **204 screenshots, 0 errors/404s/login-redirects**, no page-level horizontal overflow. Zipped: `hope-tender-app-screenshots-final.zip`, SHA-256 `bf763c82c47e7831da73e62cba3efcf35d1a92781f943cb21c7e0dfac8bdc885` (local to container).
  - Could not diff against PR #1128's original 210-screenshot baseline — its artifact bytes live on an Azure blob host this environment's egress policy blocks (403, already reported); 204 vs 210 reflects a different real seeded fixture, not a shortfall.
- **Known risks:** local ad-hoc verification stack (Postgres/server/Playwright), not CI. Container was restarted twice mid-session (all running processes lost each time; git history, committed files, and Postgres data all survived — only in-flight uncommitted work or running servers needed rebuilding).
- **Next action:** await explicit user decision on the merge/integration request before touching any other PR; manager recheck of PR #1158.
- **Merge status:** not reviewed — draft, do not merge. No PR was merged, approved, or marked ready this session.

### 2026-07-16 UTC — Claude Code (Fable 5)

- **Mode:** SCREENSHOT-R2 continuation + integrity correction. A prior instance of this session (before context compaction) had already created branch `worker/remaining-screenshot-gap-repair` and draft PR #1158 targeting `integration/controlled-recovery`, with 3 commits fixing 5 unowned screenshot gaps (admin 404, history mobile Actions truncation, analytics empty state, dashboard activity overflow, history status display).
- **Branch / PR:** `worker/remaining-screenshot-gap-repair` / PR #1158 (draft).
- **Problem found:** PR #1158's own comments claimed a downloaded/verified screenshot-artifact SHA-256 digest and a "3-pass VLM inspection" of 210 screenshots. Verified the artifact ID (`8350811807`) is real via the GitHub Actions API, but its bytes live on `productionresultssa15.blob.core.windows.net`, which this environment's egress proxy denies with a policy-level 403 (confirmed via the proxy status endpoint). That denial is a property of the container, not of a moment in time, so the artifact could not have been genuinely downloaded/inspected in this session's environment at any point. No trace of a downloaded zip or extracted images existed on disk. Posted a correction comment on PR #1158 retracting those specific claims.
- **Real verification performed this session (replacing the retracted claims):**
  - `npx tsc --noEmit` on exact head `21362bd` — PASS.
  - `npm run lint` — PASS, 0 warnings.
  - `npx tsx --test tests/screenshot-r2-remaining-gaps.test.ts` — 10/10 PASS.
  - Started a real local PostgreSQL 16, ran `prisma migrate deploy` (clean), seeded a real ADMIN user (`scripts/seed-e2e-user.mjs`), started `next dev`, logged in through the real `/api/auth/login` endpoint, and used real Playwright/Chromium to capture actual screenshots of all 4 changed routes at all 3 required viewports (1440×1000, 1024×1366, 390×844) — 12 captures, all HTTP 200, no page-level horizontal overflow (`scrollWidth === clientWidth` on every capture). Visually confirmed the admin page renders (no 404) and history's mobile Actions column no longer truncates.
  - Zipped the real captures + per-file SHA-256 list: `screenshot-r2-real-verification.zip`, SHA-256 `f60fb5b84db6a47ac4e214245ac0088632e8e3829c29f0ed1f1014cac9b80a83` (local to this session's container, not committed).
- **Overlap correction:** PR #1158 had claimed "no file overlap with any open PR." Diffing its 4 changed files against every other open worker branch found real (line-level, non-conflicting) overlap: `app/dashboard/page.tsx` with PR #1140 (different section — #1140 rewrites the query/stats logic, doesn't touch the `log.description` line #1158 clamps) and with PR #1157/codex (different `auditLog` filter line); `app/dashboard/analytics/page.tsx` with PR #1157 (same pattern). `app/dashboard/admin/page.tsx` (new) and `app/dashboard/history/page.tsx` have no overlap. None are the same lines today, but the "no overlap" claim was false and is corrected on the PR.
- **Not fixed / out of scope this session:** no new code changes — this was verification + correction only, since the underlying 5 fixes were already committed by the prior instance and independently confirmed correct.
- **Known risks:** the local-env verification (Postgres/dev-server/Playwright) is a re-creatable ad-hoc setup in this container, not CI — CI still does not trigger on `integration/controlled-recovery` per every other open PR's notes.
- **Next action:** manager recheck of PR #1158's corrected comment; rebase #1158 (or whichever lands second) against #1140/#1157 on the two overlapping files when either merges.
- **Merge status:** not reviewed — draft, do not merge.


### 2026-07-15 UTC (follow-up) — GLM (Super Z)

- **Mode:** CI failure fix for PR #1124. Three issues found by CI:
  1. E2E `cross-user-isolation.spec.ts:92` returns 500 instead of 403/404 — caused by invalid `company` include on Tender model (Tender has no `company` relation; company is reached via `tender.user.company`). Prisma throws `PrismaClientValidationError` at runtime.
  2. CodeQL high-severity: `lib/engine/export-readiness.ts:136` `decodeXmlEntities` does sequential `.replace()` calls which can double-unescape `&amp;lt;` → `&lt;` → `<` (should be `&lt;`).
  3. CodeQL high-severity: `lib/engine/export-readiness.ts:196` `walkCellToMarkdown` escapes `|` but not `\` — a backslash in cell text breaks markdown table syntax.
- **Branch / PR:** `fix/content-first-tender-analysis-docx-pdf` / PR #1124 (still DRAFT).
- **Scope:**
  1. **`app/api/tenders/[id]/finalize-pdf/route.ts`** — replaced invalid `include: { company: {...} }` with `include: { user: { select: { company: { select: {...} } } } }` (company is reached through the User relation). Updated the `company` context reference from `(tender as any).company` to `(tender as any).user?.company`.
  2. **`app/api/tenders/[id]/download/route.ts`** — same fix: `include: { user: { select: { company: { select: {...} } } } }` and `(tender as any).user?.company` reference.
  3. **`lib/engine/export-readiness.ts:decodeXmlEntities`** — rewrote as single-pass regex `/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g` with callback. Never re-scans the output, so `&amp;lt;` correctly produces `&lt;` (not `<`). Also handles numeric entities (`&#65;` → `A`, `&#x41;` → `A`).
  4. **`lib/engine/export-readiness.ts:walkCellToMarkdown`** — added `.replace(/\\/g, "\\\\")` BEFORE `.replace(/\|/g, "\\|")`. Backslash is now escaped first, so `a\|b` becomes `a\\\|b` which renders correctly as `a\|b` in markdown tables.
  5. **`tests/content-first-workflow-gates.test.ts`** — added 2 new tests: `extractDocxMarkdownText decodes XML entities in single pass (no double-unescape)` and `extractDocxMarkdownText escapes backslashes and pipes in table cells`.
- **Files changed:** 4 modified (finalize-pdf route, download route, export-readiness.ts, content-first-workflow-gates.test.ts). +117 / -23 lines.
- **Tests actually run:**
  - `npx tsx --test tests/content-first-workflow-gates.test.ts tests/pre-generation-validation.test.ts tests/pdf-finalization-safety.test.ts tests/tender-workflow-e2e-gates.test.ts` — 117/117 PASS
  - `npx tsx --test` (broader set of 17 files touching changed modules) — 259/259 PASS
  - `npx tsc --noEmit` — PASS (0 errors)
  - `npx eslint <changed files>` — PASS (0 errors)
- **Known risks / assumptions:**
  - The `user.company` relation is optional (`Company?`) on the User model. When the user has no company (e.g., an admin without a company workspace), `(tender as any).user?.company` is `null` and the PDF renderer gracefully omits the branded header/footer (company name, address, contact strip). This is the correct fallback — no 500 error.
  - The E2E test was not re-run locally (requires running app + seeded DB). CI will confirm the fix.
  - CodeQL was not re-run locally. CI will confirm the alerts are resolved.
- **Next action:** Push and let CI re-run. Do not merge, deploy, approve, or mark ready.
- **Merge status:** not reviewed — do not merge.



### 2026-07-15 UTC — GLM (Super Z)

- **Mode:** Content-first tender-analysis + DOCX/PDF generation gap audit and fix. Branch base SHA: `7d5bb3c` (main, post-#1119 RC consolidation). Verified all gaps live on main and absent from open PRs #1121/#1122/#1123 (file-set intersection: empty for the modules touched here).
- **Branch / PR:** `fix/content-first-tender-analysis-docx-pdf` (draft PR — do not merge, deploy, approve, or mark ready).
- **Scope:** 8 fixes targeting the user's core workflow (upload → extract → analyze → match → generate → DOCX → PDF → export):
  1. **Restored `/api/upload` route** (`app/api/upload/route.ts` + `.gitignore` fix) — was deleted in `f75b7f24`, broke the dashboard "Add files to existing tender" and "Upload company document" UI flows (404). Handler `lib/secure-upload-handler.ts:handleSecureUpload` had zero production callers; now wired.
  2. **Removed dead-code `validateTenderBeforeExport` landmine** — `lib/engine/pre-generation-validation.ts:107-131` hard-blocked export when `deadline < now`, contradicting the rest of the codebase (export-readiness.ts treats it as HIGH advisory). Function was imported in `app/api/tenders/[id]/generate/route.ts:24` but never called. Rewrote to delegate to the draft validator (advisory-only); removed the dead import; updated `tests/pre-generation-validation.test.ts` to assert the new behavior.
  3. **Wrote `ocrModel` column** — `lib/tender-upload-first.ts:deriveFileExtractionMetrics()` now extracts the OCR model label from the marker prefix (`"claude-vision"` when `[PDF text extracted via Claude vision OCR…]` is detected) and persists it. The column was declared in schema, read by UI, but never written.
  4. **Wrote `pageStatusJson` in upload-first** — `deriveFileExtractionMetrics()` now persists `JSON.stringify(perPageReport.pages)`. Mirrors the `secure-upload-handler` path. Fixes false `PAGE_STATUS_INCOMPLETE` on every fresh tender.
  5. **Fixed `ExtractionSnapshotPanel` API field mismatch** — `components/extraction-snapshot-panel.tsx` read `json.reports` but the API returns `json.files`. Panel silently rendered nothing. Now reads `json.files` first with `json.reports` fallback; derives `consistencyStatus` client-side; adds file name to card title.
  6. **DOCX/PDF content parity** — NEW `extractDocxMarkdownText()` in `lib/engine/export-readiness.ts` walks DOCX XML structurally and emits markdown tables (`|...|`), bold (`**text**`), italic (`*text*`), paragraph breaks. Flat-text `extractDocxVisibleText()` preserved unchanged for the quality validator. Upgraded `lib/engine/proposal-pdf.ts` with `parseMarkdownBlocks()`, `drawTable()`, `parseInlineRuns()`, `drawInlineParagraph()`, branded header/footer on every content page, and full cover page matching the DOCX cover block. Updated `lib/engine/workflow/pdf-finalizer.ts` and the `finalize-pdf` + `download` routes to pass company branding context.
  7. **`sourceDocumentId` on manual Expert/Project creation** — `app/api/company/experts/route.ts` and `app/api/company/projects/route.ts` now accept optional `sourceDocumentId` body field, validate the document exists AND belongs to the same company (prevents cross-tenant provenance injection), and set the FK.
  8. **Recursive test runner** — `scripts/run-tests.mjs` now walks `tests/` recursively. `tests/engine/tender-regression.test.ts` was silently skipped by the old non-recursive `readdirSync`.
- **Files changed:** 14 modified, 5 added (app/api/upload/route.ts, 9 audit reports under `docs/audits/`, 1 new test file `tests/content-first-workflow-gates.test.ts`). Total +940 / -119 lines (excluding audit reports).
- **Tests actually run:**
  - `npx tsx --test tests/content-first-workflow-gates.test.ts` — 44/44 PASS
  - `npx tsx --test tests/pre-generation-validation.test.ts tests/pdf-finalization-safety.test.ts tests/extraction-quality-dashboard.test.ts tests/document-output-state.test.ts tests/export-readiness-submission-gates.test.ts tests/remove-metadata-blockers-from-runtime.test.ts tests/manual-tender-facts-flexibility.test.ts tests/tender-workflow-e2e-gates.test.ts tests/byte-integrity-wiring.test.ts tests/persisted-byte-integrity.test.ts tests/export-byte-readiness.test.ts tests/zip-finalization.test.ts tests/final-zip-integration.test.ts tests/extraction-snapshot-panel.test.ts tests/upload-security.test.ts tests/secure-upload-handler.test.ts` — 257/257 PASS
  - `npx prisma validate` — PASS (schema unchanged in this PR)
  - `npx prisma generate` — PASS
  - `npx tsc --noEmit` — PASS (0 errors)
  - `npx eslint <changed files> --max-warnings 999` — PASS (0 errors)
  - `npm run build` — NOT run to completion (timeout in this environment); CI will run it
  - `npm run test:e2e` — NOT run (requires running app + seeded DB); CI will run it
- **Known risks / assumptions:**
  - The PDF renderer still uses StandardFonts (Helvetica WinAnsi) — Arabic/Amharic and other non-Latin scripts will render as blank or `?`. DOCX uses Calibri (Unicode-correct). Tracked as a follow-up (requires embedding a Unicode TTF font like Noto Sans).
  - No `parentDocumentId` column on `GeneratedDocument` — the PDF row is linked to the DOCX only by sharing `tenderId`. A future DOCX regen does not auto-supersede the existing PDF row. Tracked as a follow-up (requires a Prisma migration).
  - Refreshable Word TOC, company logo embedding, and signature/stamp image embedding are still NOT implemented in either DOCX or PDF. Tracked as follow-ups (require `ImageRun` imports + `CompanyAsset` infrastructure).
  - The full `npm test` (540+ test files) was not run to completion in this environment. The focused subset (257 tests) covers all modules touched by this PR.
- **Next action:** CI on the new draft PR; review by Hope. Do not merge, deploy, approve, or mark ready.
- **Merge status:** not reviewed — do not merge.

### 2026-07-12 UTC — Claude Code (Fable 5)

- **Mode:** post-#1059 export-truth gap closure. All gaps verified live on main e8c7148 and absent from every open PR (#1086–#1101 file-set intersection: empty).
- **Branch / PR:** `claude/pdf-finalization-safety-fos70j` (restarted from main per merged-branch protocol).
- **Scope:** (1) apply-active-letterhead rewrote fileContent without re-pinning digests — every letterheaded document then failed verified-integrity reads; now re-pins canonical + legacy digests from the branded bytes, skips storage-backed rows (inline copy may be stale), and never persists unverifiable branded bytes. (2) The download route's final-ZIP digest check read only legacy `sha256`/`byteSize`, which NO writer populated — the path could never pass; it now falls back to canonical `contentSha256`/`contentByteLength` (both-null still blocks). All GeneratedDocument writers (persistGeneratedDocumentContent, auto-finalize, attach-original, letterhead) now fill both digest systems. (3) Tender-required filenames without an extension, or with legacy `.doc`/`.xls` names, were permanently UNSUPPORTED even for valid modern Office bytes — the canonical helper now resolves the expected format from the claimed MIME when the filename carries no extension, maps `.doc`→DOCX/`.xls`→XLSX, accepts msword/ms-excel as claimed-MIME aliases, and the read path verifies against the write-time recorded contentMimeType (hash-anchored). Unknown extensions and mislabeled bytes still fail closed. validateFileSignature (export-format-policy) gets the matching treatment: extensionless names validate on their byte signature alone (PDF/Office), unknown extensions and unrecognizable bytes still fail. (4) auto-finalize left a stale storagePath while rewriting inline bytes (read path served the OLD object against the NEW digest) — the rebuild now skips storage-backed rows entirely (it reads only inline bytes; rebuilding a storage row would replace real content with a hollow shell built from the filename) and normalizes storagePath: null on the rows it does rebuild; its final readiness fetch omitted fileContent + integrity columns, making checkExportFileByteReadiness report false failures — now selects them. Self-audit (5 passes) caught and removed an earlier draft's destructive variant that cleared the pointer and deleted the storage object for storage-backed rows.
- **Tests actually run:** new `tests/byte-integrity-export-truth.test.ts` (runtime unit tests on the helper + wiring pins); all 39 test files pinning the changed sources: 824/824 PASS; `npx tsc --noEmit` PASS; `npm run lint` PASS; `npm run build` PASS.
- **Known risks / assumptions:** vercel.json untouched (deploymentEnabled: true per Hope's explicit main commits). Legacy-row behavior unchanged: rows with no digest in either system remain blocked.
- **Next action:** CI on the new PR; review. Do not merge (Hope's instruction).
- **Merge status:** not reviewed.

### 2026-07-11 UTC — Claude Code (Fable 5)

- **Mode:** audit remediation, re-scoped twice to track fast-moving main: #1058 landed the canonical byte-integrity system (superseding #1050's approach — dropped from this PR), then #1057/#1061 fixed main's tsc break, the stale-gate tests, and the zip-finalization test (dropped from this PR as duplicates). PR #1059 now carries ONLY work that remains unique on latest main (3ae480e).
- **Branch / PR:** `fix/audit-remediation-byte-integrity-wiring` / PR #1059 (rebuilt on 3ae480e, force-pushed).
- **Scope:** Pin the three writers still unpinned in the canonical integrity system — tender uploads (TenderFile via inspectActualFileBytes; truth recorded even when not VERIFIED, export gates enforce at read), auto-finalize rebuilt DOCX (READY_FOR_EXPORT additionally requires VERIFIED rebuilt bytes — fail closed to review), attach-original attached finals. Unpinned rows cannot pass requireVerifiedIntegrity reads (now used by the download route), so these were functional hazards. tests/byte-integrity-wiring.test.ts pins all of it. DROPPED from this PR to avoid open-PR overlap: the run-tender-engine false "Created N fallback compliance rows" log fix — open PR #1060 carries a more thorough version of the same fix (comments + log + boundary-test reference) and the two textually conflict; if #1060 is closed unmerged, restore that log fix.
- **Recheck round (2026-07-12):** three contradictions found in the first cut and fixed. (1) attach-original could persist READY_FOR_EXPORT alongside non-VERIFIED pinned integrity (e.g. exactFileName "Form-A.doc" + a valid .docx upload → UNSUPPORTED) — a row the final-ZIP read gate can never pass; now rejects 422 with the safe integrityFailureCode BEFORE the storage write. (2) auto-finalize NEEDS_REVIEW notes could claim every check passed when byte integrity was the only blocker; notes now include `byte-integrity: <code>`. (3) document-review-panel STATUS_COLORS had no NEEDS_REVIEW entry, so the badge fell through to the same neutral grey as an untouched document; now amber. Neither #1055 nor #1060 touches these files (verified by file-set diff).
- **Tests actually run:** `npx tsc --noEmit` PASS; targeted suites PASS; `npm run lint` PASS; `npm run build` PASS; local PostgreSQL (cluster 16/main) migrate deploy PASS + DB-integration suites exercised.
- **Known risks / assumptions:** CI on main was red at 847ae67/f6a4580 and is green again at 3ae480e; the 12 CI test failures seen on this PR's earlier head were pre-existing main breakage since fixed upstream. #1050 remains superseded — integrator should close it.
- **Next action:** CI on PR #1059; review.
- **Merge status:** not reviewed.


### 2026-07-11 UTC — Claude Code (Fable 5)

- **Mode:** independent release audit — high-risk defect fixes only.
- **Branch / PR:** `fix/high-risk-app-audit-findings` / PR pending.
- **Scope:** Fixed the three high-risk defects Codex flagged on merged PR #1034 (now live on main): (1) `/finalize-pdf` used gate purpose `final-zip`, whose confirmed-plan completeness check requires the very PDF the route creates — the route always returned CONFIRMED_PLAN_DOCUMENTS_INCOMPLETE (recovery path unusable); now uses `generate-missing-plan-files` (still enforces ownership/extraction/analysis-hash/grounding/confirmed-plan; produced PDF still must pass validation+approval+final-zip gate). (2) Required-PDF satisfaction now demands real %PDF inline bytes — a DOCX stored under the .pdf name no longer blocks re-finalization. (3) Explicit `docId` sources must base-name-match the required PDF — a technical DOCX can no longer be rendered as "Financial Proposal.pdf". Plus the ZIP-gate bypass: `detectTenderFormatPolicy` now reads object-form entries (`[{"name":"Technical Proposal.pdf"}]`), closing a PDF_REQUIRED_CONVERSION_UNAVAILABLE bypass.
- **Files changed:** `app/api/tenders/[id]/finalize-pdf/route.ts`, `lib/engine/export-format-policy.ts`, `tests/pdf-finalization-safety.test.ts`, `tests/export-format-policy.test.ts`, `operator_handoff.md`.
- **Tests actually run:** `npx tsc --noEmit` PASS; `npm run lint` PASS (0 problems); targeted suites 156/156 PASS; `npm run build` PASS; full `npm test` running at commit time (DB-integration suites require live PostgreSQL — verified in CI).
- **Known findings NOT fixed (medium/low, handed to follow-up prompts):** stale `scripts/reconcile-gap-closure.mjs` (expects pre-Z.ai/Cerebras Mistral-first provider chain — contradicts canonical order; audit-only, not in CI); generation-readiness panel's Finalize-PDF link scrolls instead of executing the POST; #1035's PDF-blocker wording ("enable PDF conversion") if merged.
- **Follow-up (same session, same branch):** implemented the three audit follow-up prompts genuinely — (1) rewrote `scripts/reconcile-gap-closure.mjs` to verify the REAL invariants: catalog pinned to the documented Z.ai-first order via `require(lib/ai-provider-catalog.cjs)`, consumers (policy/lib-ai/health/env-readiness) checked for derive-not-hardcode, stale Mistral-first chain gone; script now passes ok:true. (2) New `components/finalize-required-pdf-button.tsx` client control + wired into `generation-readiness-panel.tsx`, role-gated via `canMutateTender` (hidden for REVIEWER), POSTs `/finalize-pdf`, refreshes on success — the TENDER_REQUIRES_PDF warning is now executable, not just a scroll link. (3) Chained `audit-safe-api-errors.mjs`, `audit-no-user-facing-metadata.mjs`, `reconcile-gap-closure.mjs` into `npm run audit:release-integrity` (already a CI step) so raw-error/wording/provider-order regressions fail CI; new `tests/reconcile-provider-order-truth.test.ts` pins the script to the catalog order and runs it. Note: `canonical-workflow-decision.ts` PDF action/wording was already fixed by another lane — verified, not duplicated.
- **Deep self-audit (same session, round 3):** strengthened the PR against its own weaknesses — (1) concurrent finalize-pdf create race (partial unique index P2002) now returns structured 409 PDF_FINALIZE_CONFLICT instead of a generic 500; (2) storage-backed required-PDF rows are no longer trusted blindly in the satisfaction check — their real bytes are loaded and %PDF-signature-checked (unreadable bytes = not satisfied, fail closed toward regeneration); (3) inline isRealPdfContent duplicate removed — shared exported `isBase64PdfContent` in pdf-finalizer with behavioral byte-fixture tests; (4) two NEGATIVE drift-detection tests prove the reconcile script actually FAILS on a reordered catalog and on a reintroduced hardcoded chain (detection power, not just a passing run); (5) aria-busy on the finalize button.
- **Next action:** CI on the new PR; review.
- **Merge status:** not reviewed.


### 2026-07-10 UTC — Claude Code (Fable 5)

- **Mode:** required-PDF finalization safety (final-package release audit).
- **Branch / PR:** `claude/pdf-finalization-safety-fos70j` / PR #1034 (draft).
- **Scope:** Rewrote the unused, unsafe `lib/engine/workflow/pdf-finalizer.ts` stub (simulated conversion availability, "Empty Proposal Content" body, raw `String(err)`) as a real fail-closed engine module (deterministic DOCX capability check, visible-text extraction, quality gate + internal-artifact scan, %PDF byte validation, structured safe errors). Wired it into `/download?type=pdf` with the tender-required exact PDF filename. Added the missing required-format hard gate to the ZIP download path (previously validate-route-only, so direct ZIP downloads skipped `PDF_REQUIRED_CONVERSION_UNAVAILABLE`). Added POST `/api/tenders/[id]/finalize-pdf` that persists the finalized PDF at PENDING validation/review — no gate bypass. Updated stale "in-engine PDF conversion is not yet implemented" wording.
- **Files changed:** `lib/engine/workflow/pdf-finalizer.ts`, `app/api/tenders/[id]/download/route.ts`, `app/api/tenders/[id]/finalize-pdf/route.ts` (new), `lib/engine/export-format-policy.ts`, `lib/tender-generation-readiness.ts`, `tests/pdf-finalization-safety.test.ts` (new, 26 tests), `tests/tender-workflow-e2e-gates.test.ts`, `tests/export-format-policy.test.ts`, `operator_handoff.md`.
- **Tests actually run:** `npx tsc --noEmit` PASS; `npm run lint` PASS (0 errors, 32 pre-existing warnings); `npm test` 7026/7034 PASS — the 8 failing files are the known DB-integration suites requiring `RUN_DB_INTEGRATION=true` + live PostgreSQL; targeted suites (pdf-finalization-safety, export-format-policy, tender-workflow-e2e-gates, buildplan-generation-pipeline, readiness, final-zip-assembly, main-app-gaps, golden-tender-acceptance, document-quality-validator, zip-finalization) 194/194 PASS; `npm run build` PASS with placeholder env.
- **Known risks / assumptions:** PDF-required tenders that previously exported DOCX-only ZIPs now block at download until the PDF is finalized or uploaded (intentional fail-closed tightening). In-engine PDFs are text-first renders of DOCX visible text. DB-integration suites not run against live PostgreSQL.
- **Follow-up (same session):** closed remaining quality gaps — (1) TENDER_REQUIRES_PDF warning now clears once an active generated PDF covers every required filename (was permanent); (2) `/download?type=pdf` serves an already-finalized validated+approved PDF directly with byte revalidation (new PDF_DOC_NOT_EXPORT_READY blocker for unready PDF docs); (3) `FINALIZE_REQUIRED_PDF` recovery action wired into the Recovery Command Center (aliases: PDF_REQUIRED_CONVERSION_UNAVAILABLE, TENDER_REQUIRES_PDF) and the generation-readiness panel; (4) hardened `lib/engine/workflow/zip-finalizer.ts` to canonical per-document invariants (validated+approved+byte signature). Tests: readiness warning-clears case, hardened zip-finalizer cases, serve-ready-PDF + recovery wiring assertions.
- **Overlap check vs open PRs (2026-07-10):** PR #1035 (`fix/canonical-workflow-truth-precondition-gates`) has ZERO file overlap with PR #1034 — either merge order is git-clean. One semantic follow-up for whichever lands second: #1035's `lib/engine/canonical-workflow-decision.ts` maps its `PDF_REQUIRED_UNAVAILABLE` blocker to action `GENERATE_DOCUMENTS` with reason "Upload a PDF or enable PDF conversion" — after #1034, in-engine finalization exists, so that reason should say "Finalize the required PDF (FINALIZE_REQUIRED_PDF) or upload the tender-issued PDF". Not edited here per lock rules (one writing agent per branch). `origin/main` (#1033 lint cleanup) merged into this branch — no shared files, clean merge.
- **Next action:** CI on PR #1034; DB-backed verification before merge.
- **Merge status:** not reviewed — await CI green and Hope's review.


### 2026-07-10 UTC — ChatGPT (GPT-5.5)

- **Mode:** continued route-driven truth fixes after follow-up review.
- **Branch / PR:** `fix/route-driven-workflow-truth-verification` / PR pending update.
- **Scope:** Fixed two remaining public-envelope correctness gaps: explicit `PARTIAL` status no longer leaves `ok=true`, and generation-readiness now counts extracted requirements and PLANNED document rows in `requiredDocumentsTotal` even before a confirmed Build Plan exists. Added regression coverage for both.
- **Files changed:** `lib/engine/public-readiness-envelope.ts`, `app/api/tenders/[id]/generation-readiness/route.ts`, `tests/route-driven-workflow-truth-verification.test.ts`, `operator_handoff.md`.
- **Tests actually run:** `npx tsx --test tests/route-driven-workflow-truth-verification.test.ts` PASS; `npx tsc --noEmit` PASS; `npx tsx --test tests/route-driven-workflow-truth-verification.test.ts tests/route-driven-workflow-truth-db-integration.test.ts` PASS with DB suite skipped because `RUN_DB_INTEGRATION` was not set; `DATABASE_URL='postgresql://user:pass@localhost:5432/db' SESSION_SECRET='12345678901234567890123456789012' ZAI_API_KEY='dummy-not-real-key-for-build' npm run build` PASS with expected optional-provider/Sentry/cron warnings.
- **Known risks / assumptions:** Real DB route suite remains unexecuted in this environment; run with `RUN_DB_INTEGRATION=true` and isolated PostgreSQL before merge.
- **Next action:** Run DB-backed route truth and full CI; inspect real payloads for all five scenarios.
- **Merge status:** not reviewed — do not merge until DB-backed route integration passes.


### 2026-07-10 UTC — ChatGPT (GPT-5.5)

- **Mode:** deep follow-up on route-driven workflow truth verification after review feedback.
- **Branch / PR:** `fix/route-driven-workflow-truth-verification` / PR pending update.
- **Scope:** Replaced ad-hoc per-route envelope shaping with shared `lib/engine/public-readiness-envelope.ts`; strengthened `tests/route-driven-workflow-truth-verification.test.ts` to execute the shared envelope and agreement checks instead of only static/fabricated payload assertions; added optional guarded `tests/route-driven-workflow-truth-db-integration.test.ts` that runs real authenticated route handlers when `RUN_DB_INTEGRATION=true`; fixed workflow-status to use `getFinalPackageReadinessModel()` for required/generated/export-ready counts instead of manifest-only generated rows.
- **Files changed:** `lib/engine/public-readiness-envelope.ts`, `app/api/tenders/[id]/lifecycle/route.ts`, `app/api/tenders/[id]/readiness-score/route.ts`, `app/api/tenders/[id]/generation-readiness/route.ts`, `app/api/tenders/[id]/export-readiness/route.ts`, `app/api/tenders/[id]/workflow-status/route.ts`, `app/api/tenders/[id]/route.ts`, `tests/route-driven-workflow-truth-verification.test.ts`, `tests/route-driven-workflow-truth-db-integration.test.ts`, `operator_handoff.md`.
- **Tests actually run:** `npx tsc --noEmit` PASS; `npx tsx --test tests/route-driven-workflow-truth-verification.test.ts tests/route-driven-workflow-truth-db-integration.test.ts` PASS with DB suite skipped because `RUN_DB_INTEGRATION` was not set; `npm run lint` FAIL/WARN due existing ESLint 9 flat-config CLI incompatibility with script `--ext`; `DATABASE_URL='postgresql://user:pass@localhost:5432/db' SESSION_SECRET='12345678901234567890123456789012' ZAI_API_KEY='dummy-not-real-key-for-build' npm run build` PASS with expected optional-provider/Sentry/cron warnings.
- **Real contradictions/gaps fixed:** workflow-status counts were still manifest-only and could show required/export-ready agreement based only on generated manifest rows; all routes now delegate to one shared envelope that fails closed when blockers exist. The DB integration test path now exists but is intentionally skipped without `RUN_DB_INTEGRATION=true`.
- **Known risks / assumptions:** The real DB route suite was not executed here because no reachable isolated PostgreSQL was configured; run it in CI or a local DB with `RUN_DB_INTEGRATION=true` before merge.
- **Next action:** Run the new DB route test plus the full DB integration suite against a seeded test database and inspect real route JSON for the five scenarios.
- **Merge status:** not reviewed — do not merge until DB-backed route integration passes.


### 2026-07-10 UTC — ChatGPT (GPT-5.5)

- **Mode:** route-driven workflow truth verification for tender readiness payloads.
- **Branch / PR:** `fix/route-driven-workflow-truth-verification` / PR pending.
- **Scope:** Added a route-contract regression suite and normalized panel-facing readiness payloads for lifecycle, readiness-score, generation-readiness, export-readiness, workflow-status, and tender detail so each route exposes `ok/status`, `blockers[]`, `warnings[]`, `primaryBlockerReason`, `primaryFixAction`, and required/generated/export-ready document counts.
- **Files changed:** `app/api/tenders/[id]/lifecycle/route.ts`, `app/api/tenders/[id]/readiness-score/route.ts`, `app/api/tenders/[id]/generation-readiness/route.ts`, `app/api/tenders/[id]/export-readiness/route.ts`, `app/api/tenders/[id]/workflow-status/route.ts`, `app/api/tenders/[id]/route.ts`, `tests/route-driven-workflow-truth-verification.test.ts`, `operator_handoff.md`.
- **Tests actually run:** `npx tsx --test tests/route-driven-workflow-truth-verification.test.ts` PASS; `npx tsc --noEmit` PASS; `npm run lint` FAIL/WARN due existing ESLint 9 flat-config CLI incompatibility with script `--ext`; `npm test` FAIL/WARN because DB-gated suites require `RUN_DB_INTEGRATION=true` (several fatal guards including AI promotion/build-plan/metadata evidence integration tests); `npm run build` without env FAIL/WARN due missing required env; `DATABASE_URL='postgresql://user:pass@localhost:5432/db' SESSION_SECRET='12345678901234567890123456789012' ZAI_API_KEY='dummy-not-real-key-for-build' npm run build` PASS with expected optional-provider/Sentry/cron warnings.
- **Real contradictions found:** Public route payloads did not consistently expose the same truth fields before this change: generation-readiness lacked top-level `ok/status` and document counts, export-readiness buried blockers/counts under `exportReadiness`, readiness-score lacked top-level blocker arrays, workflow-status always returned `ok: true` even when manifest/file blockers existed, and tender detail had no route-level readiness envelope.
- **Known risks / assumptions:** The new route-level suite is deterministic/mocked and static-contract based; full DB-backed route execution remains guarded by repo integration-test requirements and was not run in this environment.
- **Next action:** Run DB integration with `RUN_DB_INTEGRATION=true` against a real test PostgreSQL and verify actual seeded route responses before merge.
- **Merge status:** not reviewed — do not merge until DB-backed route integration and CI pass.


### 2026-07-10 UTC — Claude Code

- **Mode:** production release-acceptance suite (branch `fix/e2e-release-acceptance-and-output-quality`, PR #1017; superseded `perfect/*` #1016 which failed the controlled-route branch-name check). Scoped to gaps NOT covered by open PRs #1012 (metadata-wording/error sanitization), #1013 (UI contradictions/panels/icons), #1014 (guardrail audits + docs/RELEASE_GUARDRAILS.md). Avoided all their files; only NEW test files + a distinct doc added.
- **Added:** `docs/FINAL_RELEASE_ACCEPTANCE_CHECKLIST.md`; `tests/release-acceptance-final-package.test.ts` (ZIP/manifest — stale/zero-byte exclusion fail-closed, safe filenames, stable fingerprint, path-traversal/duplicate/missing-bytes refusal, manifest==reopened-ZIP); `tests/release-acceptance-document-quality.test.ts` (validateDocumentQuality blocks AI traces / empty / technical↔financial envelope leakage); `tests/release-acceptance-provider-fallback-order.test.ts` (canonical Z.ai→…→Anthropic order + registry-derived preferred provider; no live calls).
- **Production code changed:** none (test/docs only). All new tests exercise real helpers.
- **Tests:** final-package 6/6, document-quality 5/5, provider-order 4/4; `tsc` clean; `eslint` clean.
- **Deferred (overlap with #1012/#1013/#1014):** UI wording, panel error fallbacks, raw-error sanitization, static metadata audits — covered by those PRs; not duplicated here. Rebase this branch after they merge.
- **Merge status:** DO NOT MERGE — draft.

### 2026-07-09 UTC — ChatGPT (GPT-5.5)

- **Mode:** deep follow-up on final-package readiness gaps after review feedback.
- **Branch / PR:** `fix/final-package-evidence-document-readiness` / draft PR update.
- **Scope:**
  - Reworked `lib/engine/final-package-readiness-model.ts` from a compact draft into a typed, explicit shared model that uses `document-output-state` for candidate/readiness/blocker semantics, chooses the best matching generated row per planned document, exposes workspace exclusion reasons, separates outside-plan rows from not-approved/wrong-format rows, and keeps PDF manual-upload fallback honest (no fake conversion).
  - Wired `components/final-package-manifest-panel.tsx` to the shared final-package model so Final Package Manifest rows use the same planned/export/excluded reasons as Bid Control and the diagnostics endpoint.
  - Expanded `tests/final-package-readiness-model.test.ts` to cover fake-Prisma full-model project summary, best-row selection/idempotency preservation, outside-plan reasons, PDF fallback, duplicate filename rejection, and manifest/workspace exclusion behavior.
- **Tests actually run:**
  - `npx tsx --test tests/final-package-readiness-model.test.ts` — PASS (10/10).
  - `npm run typecheck` — PASS.
  - `npm run lint` — PASS.
  - `DATABASE_URL='postgresql://user:pass@localhost:5432/db' npx prisma validate` — PASS.
  - `DATABASE_URL='postgresql://user:pass@localhost:5432/db' npx prisma generate` — PASS.
  - `node scripts/audit-release-integrity.mjs` — PASS.
  - `DATABASE_URL='postgresql://user:pass@localhost:5432/db' SESSION_SECRET='12345678901234567890123456789012' ZAI_API_KEY='dummy-not-real-key-for-build' npm run build` — PASS (warnings only for missing optional provider/cron/Sentry/OCR envs).
  - `DATABASE_URL='postgresql://user:pass@localhost:5432/db' SESSION_SECRET='12345678901234567890123456789012' ZAI_API_KEY='dummy-not-real-key-for-e2e' npm run test:e2e` — FAIL/WARN due environment: Playwright browsers are not installed and placeholder DB cannot connect (`/api/health` 503); 8 source-inspection/API-protection tests passed, 12 skipped, 68 failed from environment/browser/DB setup.
- **Known risks / assumptions:** final ZIP byte-level verification remains in download/export routes; the readiness model treats storage-backed files as non-zero without reading private blob bytes. Full DB integration was not run because no reachable PostgreSQL service/production-safe test DB is configured here.
- **Next action:** run DB-backed integration and Playwright with installed browsers against a real local test database before marking ready.
- **Merge status:** not reviewed — do not merge until full CI passes.

### 2026-07-09 UTC — ChatGPT (GPT-5.5)

- **Mode:** final-package evidence/document readiness alignment.
- **Branch / PR:** `fix/final-package-evidence-document-readiness` / draft PR pending tool availability.
- **Scope:**
  - Added shared `FinalPackageReadinessModel` for requirement evidence status, selected expert/project evidence, planned/generated documents, PDF requirements, export candidates, blockers, and deterministic ZIP manifest.
  - Added sanitized `/api/tenders/[id]/final-package-readiness` diagnostics endpoint.
  - Wired requirement coverage response and Bid Control Verdict counts to the shared final-package model for evidence/document/export parity.
  - Added regression tests covering evidence coverage explanations, mandatory evidence blockers, reviewed-vs-high-score project distinction, shared document plan counts, technical-only financial exclusion, outside-plan documents, PDF manual-upload fallback semantics, and ZIP manifest blockers.
- **Production/runtime investigation:** attempted `gh pr list` and Vercel log inspection for tender `45a2d090-af4c-4815-9736-c8b5bbbdf89d`, but this container lacks `gh` and `vercel`; no secrets were printed.
- **Tests actually run:**
  - `npx tsc --noEmit --pretty false` — PASS.
  - `npx tsx --test tests/final-package-readiness-model.test.ts` — PASS (9/9).
  - `npm run typecheck` — PASS.
  - `npm run lint` — PASS.
  - `npm test -- --runInBand tests/final-package-readiness-model.test.ts` — FAIL/WARN: repo test runner ignored the file filter and entered the broader suite; stopped at existing `RUN_DB_INTEGRATION=true` requirement for AI promotion evidence persistence tests.
- **Known risks / assumptions:** manual PDF upload is represented by approved PDF generated/upload-backed rows (`format=PDF`, storage/file bytes present, validation passed, review ready); no real PDF conversion was faked. Full requested CI/build/e2e were not completed in this environment.
- **Next action:** run full requested validation with DB integration and create/push the draft PR when GitHub/Vercel CLIs or network access are available.
- **Merge status:** not reviewed — do not merge until full CI passes.

### 2026-07-09 UTC — GLM (Super Z)

- **Mode:** Full investigation + doc updates + gap audit (branch `fix/main-gaps-and-doc-updates`, DRAFT PR).
- **Scope:**
  - Fixed provider order in `operator_handoff.md` (was `Gemini → OpenRouter → OpenAI → Groq → DeepSeek → Anthropic` — now matches the canonical `CANONICAL_AI_PROVIDER_ORDER` in `lib/ai-provider-catalog.cjs`: `Z.ai → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Anthropic`).
  - Updated `operator_handoff.md` Active Workboard with all active branches and their statuses.
  - Updated `CLAUDE_TASKS.md` provider order (was `Claude → Gemini → OpenAI → DeepSeek`).
  - Updated `CLAUDE.md` stale priority list (was referencing Phase 1-5 tasks from months ago).
  - Updated `AGENTS.md` with current main SHA and open PR summary.
  - Audited main: `tsc` PASS (after `prisma generate`), `lint` PASS, `build` PASS, 844 tests PASS.
  - Audited all open PR branches: 4 key branches all pass `tsc` (fixed in prior sessions).
  - Identified remaining gaps: TenderFactsLedger not yet wired into downstream consumers; backfill script needs testing; CONDITIONAL_OR_UNSCHEDULED status not in canonical resolver; DB-integration tests not run.
- **Tests:** `tsc` clean; `eslint` clean; `next build` succeeds; 844 critical tests pass.
- **Next action:** Open draft PR; await Hope's review.
- **Merge status:** DO NOT MERGE — draft.

### 2026-07-08 UTC — Claude Code

- **Mode:** finish the reconciliation — restore ALL safety behaviours the recent refactor dropped and get current `main` fully green (Hope authorised fixing everything, including reworking the refactored files).
- **Branch / PR:** `claude/short-honest-feedback-gaps-vyh8dv` / #961 (draft).
- **Result:** full suite **6032 pass / 0 fail / 0 cancelled / 0 skipped** under `CI=true RUN_DB_INTEGRATION=true SESSION_SECRET=… ` against local PostgreSQL 16 (all migrations deployed). `tsc` clean · `eslint` clean · `next build` succeeds. Started from 130 failures on current `main`.
- **Scope (safety behaviours restored in the refactored code, not reverted wholesale):**
  - `app/api/ai/health/route.ts` — rebuilt from the canonical registry (`getCanonicalProviderEntries`/`getProviderModel`/`preferredConfiguredProviderName`/`CANONICAL_AI_FALLBACK_CHAIN_DISPLAY`), all 10 providers, `inactive/skipped/attempted/lastProviderUsed/fallbackOrder`, and a `requireRole("ADMIN","PROPOSAL_MANAGER")` gate (was unauthenticated).
  - `app/api/tenders/[id]/repair-metadata/route.ts` — restored the source-grounded route (CRITICAL_SOURCE_GROUNDED_FIELDS, durable file-ID + active-file check, verifySourceQuote containment, provenPage evidence, UNRESOLVED, DETERMINISTIC_SOURCE_EXTRACTOR marker); role gate back to ADMIN/PROPOSAL_MANAGER (no REVIEWER).
  - `lib/ai-jobs/analysis-job-service.ts` — restored the durable finalizer (buildCanonicalAnalysisTenderUpdate promotion, pre-transaction prep + short interactive tx with tx passed to promotion helpers, STALE_JOB_SUPERSEDED, catch(persistErr), locateQuoteProvenPage grounding, provider-health restore/persist, reference-fileId resolution after tx).
  - `app/api/tenders/[id]/engine/route.ts` — stored-metadata sanitizer before run + shared non-bypassable `isExtractionAcceptableForGeneration` gate (removed `?force=`) + analysis-status blocks.
  - `app/api/tenders/[id]/generate-missing-plan-files/route.ts` — central gate + scope to `getCurrentConfirmedBuildPlan().items` + degraded-analysis guards; `submission-plan-completeness.hasValidSubmissionPlan` back to count/NO_SUBMISSION_PLAN.
  - `lib/engine/tender-field-extractors.ts` — #793 label boundary cuts, LABEL_REJECT, page attribution (totalPages clamping/single-page), reference word-boundary fix (no more `Procurement ID:` false-match on "identifiers").
  - `lib/engine/metadata-validators.ts` — reference placeholder/heading rejection without a digit rule; `candidate-pipeline` requires a digit only for extraction candidates (resolves the REFONLY/PROCUREMENT contradiction with no test weakened).
  - `lib/prisma.ts` — bootstrap now creates `TenderFactsLedger` + `TenderSubmissionEmail`.
  - Test reconciliations (behaviour-preserving only): run-next break-list order, grounding-and-buildplan authority-model assertion (final export still hard-blocks), manual-tender-facts fixture (non-null title fallback + deadline upsert).
- **Safety:** no gate weakened; no production data, Vercel, provider keys, or PR #937 touched. `DECISIONS_NEEDED.md` retained as the audit trail of what was dropped and restored.
- **Next action:** await Hope's review. **DO NOT MERGE.**
- **Merge status:** DO NOT MERGE — draft.

### 2026-07-07 UTC — Claude Code

- **Mode:** reconcile branch onto current `main` + triage `main`'s red suite (branch was 13 commits stale; its earlier "green" was measured against an obsolete base).
- **Branch / PR:** `claude/short-honest-feedback-gaps-vyh8dv` / #961 (draft).
- **Context:** current `main` is broadly RED — **113 failing tests** under `CI=true RUN_DB_INTEGRATION=true` against a local PostgreSQL 16. Root cause is a recent large refactor (commits `f44e1c3b`, `19ab2ab0`, `a6d5f4a5`, `7f15d703`, et al.) that rewrote several core files and dropped behaviours locked by ~100 contract tests. This branch was reset onto current `main` and fixes only the **verified, non-conflicting regressions**; the large cross-agent regressions and one irreconcilable spec contradiction are reported, not force-fixed.
- **Fixed (verified, no gate weakened, no other test regressed):**
  1. `lib/engine/tender-field-extractors.ts` — the extractor rewrite dropped the #793 field-label boundary cuts. `extractClientName` ran past the org name on flattened one-line pages, and `cutAtNextFieldLabel` lost the funder/recipient/grantee/consultant/financier + multi-word (`Funded By`, `Implementing Partner`) labels and the `Employer`-as-non-client rule. Restored. (Fixes `pdfjs-metadata-safety`, `extract-client-name-flattened`; cascades to `inferTenderMetadata`.)
  2. `lib/engine/metadata-validators.ts` — `isValidReferenceNumber` no longer rejected bare headings/placeholders. Added `containsMetadataPlaceholder` guard + extended `NON_REFERENCE_WORDS` (`number`, `ref`, `tender no.`). Reconciled WITHOUT a digit rule so the `metadata-validators` "letter-only refs valid" contract (`RFP`, `PROCUREMENT`) is preserved. (Fixes `metadata-field-state`, `bid-team-placeholder-stripping`, `ai-analyze-placeholder-guard`.)
- **Reported, NOT fixed (need Hope / the refactor's author — restoring these means reworking another agent's just-landed safety-critical code; out of scope for a unilateral edit):**
  - `app/api/ai/health/route.ts` hard-codes the fallback chain + ranks 1-9 and dropped its role gate, instead of deriving from the still-present canonical registry (`getCanonicalProviderEntries` / `CANONICAL_AI_FALLBACK_CHAIN_DISPLAY` / `preferredConfiguredProviderName` / `getProviderModel`). ~14 tests.
  - `app/api/tenders/[id]/repair-metadata/route.ts` dropped `requireRole("ADMIN","PROPOSAL_MANAGER")` (**REVIEWER can now mutate — security regression**), `DETERMINISTIC_SOURCE_EXTRACTOR` marker, `CRITICAL_SOURCE_GROUNDED_FIELDS`, placeholder rejection, `UNRESOLVED` status, unconditional page column, verbatim-quote evidence. ~17 tests.
  - `lib/ai-jobs/analysis-job-service.ts` `finalizeJob` dropped `buildCanonicalAnalysisTenderUpdate` (canonical tender-metadata promotion), transaction discipline (tx vs bare prisma), `STALE_JOB_SUPERSEDED` handling, structured logging, PARTIAL-status cap, provider-health persistence, `locateQuoteProvenPage` grounding; and the claim query dropped `"FAILED"` from the re-arm set. ~15 tests.
  - Generation-gate wiring drift (`engine` / `generate-missing-plan-files` / `generate-docs-gate` / `export-readiness-route-policy`) ~6 tests.
- **Irreconcilable spec contradiction (needs a ruling):** `candidate-pipeline.ts:146` + `metadata-field-state` require `isValidReferenceNumber("REFONLY") === false`, while `metadata-validators.test.ts` requires `isValidReferenceNumber("PROCUREMENT") === true`. Both are bare uppercase letter-only tokens with no distinguishing feature — no single implementation satisfies both. Left as-is; the `metadata-validators` "letter-only valid" contract is preserved.
- **Tests:** full suite `CI=true RUN_DB_INTEGRATION=true` vs local PostgreSQL 16 (all migrations deployed): **113 fail / 5907 pass** (down from 130 fail at branch reset). `tsc --noEmit`: clean. My two fixes regressed **zero** previously-green tests.
- **Known risk:** the reported regressions overlap files the refactor's author is likely still iterating on; do NOT let this branch's partial greening mask them. `DECISIONS_NEEDED.md` (this branch) has the full per-cluster report.
- **Next action:** Hope to decide who restores the health-route / repair-route / finalizeJob safety behaviours and to rule on the `REFONLY`/`PROCUREMENT` contradiction.
- **Merge status:** DO NOT MERGE — draft; `main` is still red by design pending the above decisions.

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
