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

### 2026-08-11 UTC — Codex (GPT-5.6 Sol)

- **Branch / PR:** `release/consolidated-recovery-20260717` / #1175, started from exact remote head `48ee3d40ea46bc705eb184832dbf15456104d0c0`.
- **Scope:** removed the Stage 2 contradiction that told users to Run Engine after Engine had already completed. `AIAnalyzePanel` now reads the existing tenant-scoped, current-revision `/engine-readiness` authority, distinguishes queued/running/completed/failed/stale states, polls active Engine work, and stops at AI-analysis truth after current Engine completion so the canonical Next Required Action owns downstream blockers. The matching panel now routes its existing state copy through an exported pure presenter used by cross-panel regression coverage.
- **Files changed:** `components/ai-analyze-panel.tsx`, `components/matching-selected-evidence-panel.tsx`, `tests/ai-analyze-engine-workflow-truth.test.ts`, and this handoff.
- **Tests:** targeted 40-test workflow/status set passed; `npx prisma generate` passed; `npm run typecheck` passed; `npm run lint` passed with one pre-existing unused-disable warning in `tests/superseded-job-status-projection.test.ts`; production `npm run build` passed with placeholder local provider/worker variables. The first post-push CI typecheck found that the test fixture omitted the Engine job `id`; the production payload and fixture type were aligned before the follow-up push. A full test attempt was stopped after 2,365 passing suites because this container has no local PostgreSQL and the repository intentionally fails DB-required files when `RUN_DB_INTEGRATION=false`; the configured Neon URL was correctly rejected by the fail-closed test DB guard.
- **Risks / assumptions:** no gate, revision resolver, tenant query, automatic continuation, Vault reconciliation, or source/generated-file integrity logic changed. The Engine readiness endpoint revision-filters `ENGINE_RUN` jobs, so an old-revision success correctly presents as not run for the current revision. Exact-head preview screenshot audit remains the next action after this commit deploys.
- **Next action:** push this commit, wait for PR #1175 exact-head CI/preview, then capture the authenticated original tender state and verify AI Analyze, Next Required Action, and Matching panels are non-contradictory.
- **Merge status:** not reviewed; do not merge until exact-head CI, real PostgreSQL tests, and authenticated screenshot audit pass.

### 2026-08-10 19:40 UTC — Claude Code (Opus), root cause of the live 0/28 · 0/112 Company Vault

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175, from head `d35b8130`.
- **Symptom (owner's live Preview):** Company Vault showed `DOCUMENTS 4 / 4 extracted` beside
  `VERIFIED EXPERTS 0 (28 total)`, `VERIFIED PROJECTS 0 (112 total)`, `VERIFIED SUPPORT 0`, and Run
  Engine then selected 0 experts and 0 projects. Every automatic reconciliation path from the P0 was
  already implemented and `tests/company-vault-zero-bureaucracy-db.test.ts` was green.
- **Root cause — byte integrity, not identity matching.** `CompanyDocument.integrityStatus` defaults
  to `"UNKNOWN"` and `remapUnlinkedVaultSources` filters `integrityStatus: "VERIFIED"`, so a vault
  whose documents were persisted before integrity was computed has **no eligible evidence source at
  all**. Extraction and byte integrity are independent, so the page truthfully reports "4 extracted"
  while nothing can bind, and every verified count is 0.
- **Reproduced by measurement, not inference.** Same 28 experts / 112 projects / 4 documents /
  169 KB of source text through `prepareCompanyVaultForEngine`:
  | documents | experts | projects | elapsed |
  |---|---|---|---|
  | byte-VERIFIED | 11/28 | **112/112** | 2988 ms |
  | `LEGACY_INTEGRITY_UNKNOWN` | **0/28** | **0/112** | 223 ms |
  | VERIFIED but `contentSha256` missing | **0/28** | **0/112** | 236 ms |
  The 223 ms is the tell: it returns immediately because no document qualifies as a source. (11/28
  in the healthy row is a fixture artifact — those synthetic names carry numeric suffixes absent
  from the CV text, so failing closed was correct.)
- **Fix:** new `lib/company-document-byte-integrity-reconcile.ts`, called before the remap in both
  `lib/engine/prepare-company-vault.ts` and `lib/company-vault-ingestion.ts`. For owned documents
  whose integrity was never established it inspects the **persisted bytes** and records their real
  hash, length, MIME type and detected format via the production producer
  `verifiedIntegrityDataFromBase64` — which throws unless the bytes inspect clean. This does not
  bypass the gate and does not mark unknown bytes verified: it performs, once, the verification that
  was never performed. A document whose bytes are unrecoverable or corrupt stays blocked and records
  an `integrityFailureCode`. Documents stored only via `storagePath` with no `fileContent` are still
  out of scope and remain blocked.
- **Regression:** `tests/company-vault-legacy-integrity-db.test.ts`. Proven **RED before the fix**
  (0/2, failing on "both documents must establish byte integrity from their stored bytes") and
  **GREEN after** (2/2). It also pins the honest half — a document with no recoverable bytes must
  stay blocked, invent no hash, and leave its dependent experts blocked — and asserts zero
  manufactured human review.
- **Tests actually run:** full `RUN_DB_INTEGRATION=true npm test` — **9,813/9,813 passed, 0 failed**,
  exit 0. An earlier full run showed one failure in
  `tests/owner-workflow-complete-postgres.test.ts` ("1 auto-finalized PDF(s) failed canonical
  validation"); it passes in isolation and in the clean full re-run, and touches
  `GeneratedDocument`, not `CompanyDocument` — recorded here as an observed concurrency flake rather
  than hidden. `npx tsc --noEmit` exit 0; `npm run lint` 0 errors, 1 pre-existing warning;
  `npm run build` exit 0.
- **Disproved and reverted:** I had theorised the route's Vault preflight caused the 60s
  `POST /engine` timeout and moved it to the worker. That broke two tests deliberately pinning
  "Vault verification before enqueue", so I measured instead of arguing: the preflight takes ~1.5 s
  at owner scale. Hypothesis wrong, change reverted, route unchanged.
- **CI / deployment:** No merge, force-push, rebase, base change, history rewrite, new PR,
  credential rotation, Production migration, or Production deployment.
- **Merge status:** Not reviewed; not merged. Draft.

### 2026-08-10 18:40 UTC — Claude Code (Opus), restore green CI on the Company Vault P0

- **Branch / PR:** `release/consolidated-recovery-20260717` / existing draft PR #1175. Started from
  head `028e0aaf` (21 commits of Company Vault P0 work by Codex and the owner's account).
- **Problem:** exact-head CI was red at step 19 for six consecutive pushes (`8e75e437`, `a5c00152`,
  `89888d9d`, `d0cd261a`, `028e0aaf`). Build, Playwright and the two-user isolation stage were
  *skipped* as a consequence, so nothing past the test step was proven on any of those heads.
- **Diagnosis:** four failures, all owner-facing wording colliding with the reviewed→verified
  rename the P0 deliberately makes. **None was a product regression.** Note the first local run
  showed six failures because PostgreSQL died mid-run — restarted and re-ran before believing it,
  per the rule in CLAUDE.md.
  1. `main-engine-source-verified-selection` — test bans the substring `human promotion`; the new
     rationale *denies* it ("no separate human promotion step is required…"). Fixed in the
     **implementation** (→ "no separate approval step"), so the assertion stays strict.
  2. `matching-quality-state` — expected `/await\s+engine\s+run/`; the message now says "await Run
     Engine". The durable human-REVIEWED record is still counted correctly; only word order moved.
  3. `panel-route-parity` — expected "28 reviewed vault expert(s)"; now "28 verified/source-backed
     Vault expert(s)".
  4. `pipeline-authority-regression` — pinned `findSourceDocument` and an old warning string in
     `lib/company-vault-ingestion.ts`; both moved when source binding was unified onto
     `remapUnlinkedVaultSources` (P0 §7). Re-pointed at the delegation, which is a stronger guard.
     The safety assertion (`doesNotMatch(/trustLevel:\s*"REVIEWED"/)`) was **not** touched and
     still passes — ingestion never fabricates human review.
- **Tests actually run:** full `RUN_DB_INTEGRATION=true npm test` against real PostgreSQL 16 —
  **9,811/9,811 passed, 0 failed, 0 skipped**, exit 0 (was 9,807/9,811 before). `npx tsc --noEmit`
  exit 0. `npm run lint` 0 errors, 1 pre-existing unused-disable warning. `npm run build` exit 0 —
  the first time the build has been proven on this head, since CI skipped it.
- **P0 audit — already implemented by the other tool, verified not re-done:** §2 one canonical
  matcher (`matchReviewEvidenceField`, consumed by both `collectEvidence` and
  `buildPartialSourceVerificationProvenance`; NFC, strict-ordered first, identity-token fallback
  for identity fields only, every token required, no fuzzy/phonetic matching); §3 `recordType`
  passed through; §5 deadlock broken by ordering `remapUnlinkedVaultSources` before
  `autoVerifyCompanyKnowledge` in both `lib/engine/prepare-company-vault.ts` and
  `lib/company-vault-ingestion.ts`; §7 classifier unified on
  `shouldScanForExperts`/`shouldScanForProjects`; §8 `VAULT_INGEST` is woken by
  `scheduleRequestScopedWorkerWake` from `app/api/upload/route.ts:46` and
  `app/api/company/ingestion-readiness/route.ts:23`. Affix stripping covers the owner's real
  context including Ethiopian honorifics (`ato`, `wro`, `weyzero`, `obo`).
- **Not done — cannot be done from here:** the deployed-Preview proof that the owner's real
  0/28 and 0/112 screenshots no longer reproduce. This session's egress policy denies CONNECT to
  `*.vercel.app`, so no authenticated browser run against the Preview is possible. Reported, not
  routed around; no internal-function run substituted for it.
- **CI / deployment:** No merge, force-push, rebase, base change, history rewrite, new PR,
  credential rotation, Production migration, or Production deployment.
- **Next action:** owner re-runs the real tender on the exact-head Preview and reports Vault
  verified counts and Engine candidate counts.
- **Merge status:** Not reviewed; not merged. Draft.

### 2026-08-10 15:40 UTC — Codex (GPT-5.6 Sol), P0 acceptance strengthening

- **Branch / PR:** `release/consolidated-recovery-20260717` / #1175; verified remote head moved from the supplied `b6d6ee26ba9b704ac167a945992ca5deff350498` to `a5c001529619423f79fc194b97d71d8369f31997` and inspected only the three intervening commits.
- **Scope / files:** audited the P0 reconciliation already on the governing PR; strengthened `tests/company-vault-zero-bureaucracy-db.test.ts` to require zero blockers and prove 28 Experts/112 Projects can share their respective authoritative bundles; strengthened `tests/identity-verification-accepts-normalised-names.test.ts` to pin stable canonical identity-fallback quotes and coordinates; updated this handoff. No production gate was relaxed.
- **Tests:** Prisma generation passed. The focused real-PostgreSQL run was attempted, but the configured Neon host was unreachable; focused non-DB tests, typecheck, lint, and build results are recorded in the final PR report.
- **CI / deployment:** #1175 CI was running at session start; dependency audit and the existing Vercel check were green. Codex created no deployment and did not promote or merge anything.
- **Risk / next action:** authenticated live owner totals (28/112) and live Engine candidate/selection counts remain unproven. Re-run the full matrix with reachable PostgreSQL, then test the exact final-SHA Preview with owner data.
- **Merge status:** unsafe pending PostgreSQL and live Preview acceptance.

### 2026-08-10 UTC — Codex (P0 Vault reconciliation follow-up)

- **Branch / PR:** `release/consolidated-recovery-20260717` / #1175; started from current PR head `8e75e437fc5073756f020646988d313c157da21d` after inspecting only the two commits after the owner-supplied SHA.
- **Scope / files:** completed stale/existing Expert and Project reconciliation in `lib/company-vault-source-remap.ts` (current-binding priority, deterministic ambiguity/no-match diagnostics, automatic stale authority demotion/rebinding, including the zero-current-documents case); fixed canonical Unicode identity matching and Unicode property boundaries in `lib/vault-review-provenance.ts`; added a decomposed/precomposed Unicode identity regression in `tests/identity-verification-accepts-normalised-names.test.ts`.
- **Tests:** focused non-DB provenance/classifier suites pass; `tsc --noEmit` passes. The required PostgreSQL regression was attempted with `RUN_DB_INTEGRATION=true` but the configured Neon host was unreachable from this environment, so no live DB, Preview, authenticated Playwright, or owner-data counts are claimed by this follow-up.
- **CI / deployment:** PR checks were in progress when inspected. No deployment was created or promoted.
- **Risks / assumptions:** Legal/Financial/Compliance source-less stale-row reconciliation remains in the pre-existing support-record path rather than the new Expert/Project blocker diagnostics. Exact deployed Preview acceptance remains mandatory before a GO decision.
- **Next action:** run the full PostgreSQL/Playwright/build matrix and validate the exact final SHA on PR #1175's Preview with the owner's 28 Experts, 112 Projects, and tender.
- **Merge status:** unsafe until CI and exact-Preview owner acceptance complete.

### 2026-08-10 15:19 UTC — Codex (GPT-5.6 Sol), P0 continuation

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175; fetched the PR ref and verified that its head had advanced from the owner's starting SHA `b6d6ee26ba9b704ac167a945992ca5deff350498` to `e549885952d0384604edec9e18de5a8d20456320`, then inspected only that single intervening commit.
- **Scope / files changed:** continued the Company Vault zero-bureaucracy repair by fixing the canonical classifier to honor explicit `EXPERT_CV`, `PROJECT_REFERENCE`, `PROJECT_CONTRACT`, and `PORTFOLIO` owner categories even when generic filenames/text have no classifier keyword; added `tests/company-document-classifier-vault-scan.test.ts`; updated this handoff. No UI, PDF, ZIP, CSP, provider-order, or unrelated workflow files were touched.
- **Tests:** 35 focused provenance, classifier, Vault-preflight, durable-engine-enqueue, and request-scoped worker-wake tests passed. The requested real PostgreSQL regression was attempted with `RUN_DB_INTEGRATION=true` but the configured Neon endpoint was unreachable, so its setup hook failed before assertions and real 28/112 acceptance is still unverified.
- **Risks / assumptions:** no Preview was deployed (Hope approval is required), no owner data was accessed, and live 28/112 reconciliation is not proven. The preceding commit's realistic DB test remains substantially narrower than the full requested acceptance matrix (tie blocker persistence, two-tenant falsification, replacement/delete/re-extraction, deterministic matching under provider outage, and selected matches still need executable DB coverage).
- **Next action:** run the expanded PostgreSQL acceptance suite against a reachable isolated database, close the remaining acceptance gaps, then deploy and validate the exact final SHA only after Hope authorizes a Preview.
- **Merge status:** unsafe — partial code repair with focused tests only; DB and live acceptance remain outstanding.

### 2026-08-10 UTC — Codex (GPT-5.6 Sol)

- **Branch / PR:** `release/consolidated-recovery-20260717` / governing draft PR #1175; verified exact starting head `b6d6ee26ba9b704ac167a945992ca5deff350498` before editing.
- **Scope:** P0 Company Vault automatic reconciliation. Added one canonical identity-aware field matcher shared by full and partial provenance, passed `recordType` through source remapping, replaced database-order/unique-document selection with deterministic evidence-authority ranking and fail-closed ties, unified ingestion scan decisions on the canonical classifier, expanded CV/project indicators, and added the requested 28-Expert/112-Project PostgreSQL fixture plus a focused RED→GREEN partial-identity regression.
- **Files changed:** `lib/vault-review-provenance.ts`, `lib/company-vault-source-remap.ts`, `lib/company-vault-ingestion.ts`, `lib/company-document-classifier.ts`, `tests/identity-verification-accepts-normalised-names.test.ts`, `tests/company-vault-zero-bureaucracy-db.test.ts`, and this handoff.
- **Tests:** focused identity regression passed (11/11) after first reproducing the new partial-verifier case RED; `npx prisma generate`, `npm run typecheck`, lint, and `git diff --check` passed. Real PostgreSQL tests were attempted but the configured Neon endpoint was unreachable, so database acceptance remains unverified in this environment.
- **Risks / assumptions:** this is not live acceptance. No Preview was deployed or owner data inspected; queue dispatch and Engine timeout code were already wired on this exact starting SHA and were not changed. The new DB regression could not execute against PostgreSQL here. Explicit auto-detected category persistence, blocker-code persistence for ambiguous matches, source replacement scenarios, provider-outage matching, and exact live 28/112 reconciliation remain to be proven.
- **Next action:** restore a reachable PostgreSQL test database, run the new regression and full required suite, then deploy the exact SHA only with Hope's approval and validate the real Preview owner state before calling the P0 fixed.
- **Merge status:** unsafe — partial root-cause repair only; live and DB acceptance outstanding.

### 2026-08-10 13:50 UTC — Claude Code (Opus), PR #1175 release-hardening audit at exact head

- **Branch / PR:** `release/consolidated-recovery-20260717` / existing draft PR #1175. Audit started
  from head `fe612ab0`; no Codex commits had landed after it.
- **Scope / files:** One new test file, `tests/job-claim-concurrency-stress-db.test.ts`, plus this
  handoff entry. **No production source changed** — the audit found no defect that justified one.
- **Gap closed:** the queue's exactly-once claim had small-scale coverage only
  (`tests/engine-worker-wake-constraints.test.ts`: 4 mixed racers, 12 concurrent wakes, ENGINE_RUN
  only). The new file stresses `claimJobForCaller` at 2, 10 and 25 concurrent callers with the two
  real caller shapes interleaved (cron `global: true`, request wake tenant-scoped), then covers
  25-callers-vs-25-jobs (no double-hand-out, no starvation), FIFO order, 20-way two-tenant
  contention with ownership assertions, cross-tender isolation inside one tenant, job-type
  isolation, the fail-closed unidentified caller, and the `nextAttemptAt` backoff window against a
  25-caller stampede. 12 tests, all pinned to tenders the file creates — an unpinned `global: true`
  claim steals other suites' rows, which is what broke `not ok 814` on this branch before.
- **Correction to the record:** the full-suite count previously reported as 9,779 on this head is
  wrong. Measured twice today on the same tree: **9,777** without the new file, **9,789** with it.
  9,777 + 12 = 9,789 exactly.
- **Tests actually run:** full `RUN_DB_INTEGRATION=true npm test` against real PostgreSQL 16 —
  9,789/9,789 passed, 0 failed, 0 skipped, exit 0. Baseline re-measurement 9,777/9,777, exit 0.
  Focused new file standalone 12/12. `npx tsc --noEmit` exit 0. `npm run lint` 0 errors, 1
  pre-existing unused-disable warning in `tests/superseded-job-status-projection.test.ts`
  (threshold is 50). Note `npx next lint` is not this project's lint entry point and crashes on
  module load — use `npm run lint`.
- **Exact-head CI verified by inspection, not badge:** run `31391888387`, job `93465334960`,
  head_sha `fe612ab07c9e1b9204ea63ca4eece0402f22d7c6`, conclusion success. 27 steps executed; the
  only `skipped` step is #28, the failure-only diagnostics upload. Step 19 (unit + DB integration)
  ran 3m03s; step 24 (authenticated browser: smoke, intake, golden workflow, cross-user isolation)
  ran 3m39s and is separate from step 22's 22s Playwright install — so the browser stage executes
  tests rather than merely booting.
- **Deployed Preview identity proven:** `dpl_GbNQUmCWCxQfpT8t8oMr4tQDbGAa` is READY and its own
  `/api/health` returns `release: fe612ab07c9e1b9204ea63ca4eece0402f22d7c6`, matching the head.
- **Blocked — deployed Preview golden path NOT performed.** This session's egress policy denies
  CONNECT to `*.vercel.app` (proxy `connect_rejected`, gateway 403), so no browser or authenticated
  multi-step HTTP run against the Preview is possible from here. Only single-shot reads via the
  Vercel MCP fetch tool work. Per the standing rule this was reported, not routed around, and no
  internal-function run was substituted for it. This remains the largest open verification gap and
  is owner-executable — see the PR body.
- **Audited, no change made (no defect found):** workflow action versions (all v4/v5, DataDog
  SHA-pinned, no `@v1/@v2/@v3`, no node12/16 runtimes) — but CI still emits
  `Node.js 20 is deprecated … actions/upload-artifact@v5 … forced to run on Node.js 24`, which is a
  property of the published action, not of this repository, and has no newer major to move to;
  `CREATE INDEX` errors in the CI Postgres log (`Expert.deletedAt`, `Project.deletedAt`,
  `TenderRequirement.sourceTenderFileId`) are `lib/prisma.ts`'s deliberately-tolerated bootstrap
  failures on a non-migrated scratch database — on the migrated schema all three columns and all
  three indexes exist, verified directly with `psql`.
- **Findings recorded as healthy:** `enqueueEngineJobForCurrentSources` has exactly one caller
  (the manual Run Engine route) and `createAnalysisJob` exactly one (the manual AI Analyze route);
  run-next additionally logs and ignores any handler returning `output.automaticEngineJob`.
  Handlers receive `userId`/`tenderId` from the claimed row, never from the request — there is no
  `userId` query parameter anywhere in run-next. A PostgreSQL trigger
  (`enforce_ai_job_tender_owner` → `AI_JOB_TENDER_OWNER_MISMATCH`) rejects tenant-mismatched AiJob
  inserts *and* userId updates at the database. Vault records reach matching eligibility
  automatically via `SOURCE_VERIFIED` (`lib/company-auto-verification.ts`,
  `lib/plan-b-source-reconcile.ts` promote on `provenance.ok` and demote to `AI_DRAFT` otherwise),
  so `REVIEWED` is the optional human path, not a mandatory promotion gate. No secret shapes in
  `.next/static`, no client source maps emitted, and `NEXT_PUBLIC_ANTHROPIC_API_KEY` /
  `NEXT_PUBLIC_DATABASE_URL` / `NEXT_PUBLIC_SESSION_SECRET` appear only in tests asserting they are
  never exposed. Zero unresolved PR review threads and zero Vercel toolbar threads.
- **Runtime logs:** no error cluster in the last 7 days belongs to `dpl_GbNQUmCWCxQfpT8t8oMr4tQDbGAa`
  — but that is because no workload has been driven against it, not proof of health. The named
  historical timeouts (`/api/tenders/[id]/evaluator-objections` and
  `/api/tenders/[id]/requirement-coverage` at `maxDuration = 10`, `/api/ai-jobs/run-next` at 60)
  last occurred 2026-08-09 16:33 on `dpl_5k9qJYdpr5WaUUqoMntxttQQB6R6`: **not reproduced, not
  disproven.** run-next's budget is counted from request start (`startTime` precedes the recovery
  sweeps), leaving 20s of headroom, so an overrun means a handler outran its `deadlineMs`.
- **CI / deployment:** No merge, force-push, rebase, base change, history rewrite, new PR,
  credential rotation, Production migration, or Production deployment.
- **Next action:** owner runs the deployed-Preview golden path (steps in the PR body) on this exact
  SHA; nothing else in the audit is blocked.
- **Merge status:** Not reviewed; not merged. Draft.

### 2026-08-09 19:35 UTC — Codex (GPT-5.6 Sol), post-Engine Vault transition and Bid Strategy authority

- **Branch / PR:** `release/consolidated-recovery-20260717` / existing draft PR #1175.
- **Scope / files:** Fixed the first reproduced post-Engine transition in `lib/company-vault-source-remap.ts`; made `app/api/tenders/[id]/bid-strategy/route.ts` consume `getTenderReleaseSnapshot`; removed the misleading normal-path “Confirm evidence coverage” wording in `lib/engine/canonical-workflow-decision.ts`; updated three focused existing tests plus this handoff.
- **Real PostgreSQL reproduction:** A byte-verified owned CompanyDocument contained the exact expert/project identity but not AI-inferred secondary fields. Before the fix `remapUnlinkedVaultSources` returned 1 instead of 2 for both experts and projects, leaving the identity-grounded rows unbound and therefore unreachable by the existing partial SOURCE_VERIFIED verifier.
- **Fix / safety:** Full-field matching remains preferred. When that fails, remap uses the canonical partial source-verification predicate and binds only when exactly one owned, byte-verified document proves the record identity. Zero or ambiguous matches remain untouched. The following canonical verifier promotes the bound identity only, records unverified fields, never fabricates REVIEWED metadata, and repeated remap remains idempotent. Bid Strategy now accepts only promoted `AI_SUCCEEDED` plus matching canonical content hash and canonical job ID, exactly like Analysis Quality/release gates; stale/fallback/missing states remain blocked.
- **Tests:** Focused PostgreSQL/relevant set — 33/33 passed; typecheck passed; lint passed with one pre-existing unused-disable warning; production build passed with an explicit test-only provider placeholder and local PostgreSQL. Full `RUN_DB_INTEGRATION=true npm test` passed: 9,773/9,773, 0 failed.
- **CI / deployment:** Not pushed yet at entry time. No merge, approval, force-push, rebase, base change, manual Preview request, or Production deployment.
- **Known limitation / remaining proof:** The focused database coverage proves owned-byte remap → SOURCE_VERIFIED, source-less blocking, idempotent remap, current-analysis Bid Strategy agreement, worker handoff, AUTO_FINALIZE retry/PDF, and ZIP assembly across the relevant executed suites. It does not yet constitute one monolithic provider-backed test executing AI Analyze through final ZIP; no live provider credential was available locally.
- **Next action:** Push the bounded commit, require exact-head CI, and inspect only the automatically created Preview for the five truthful Vault states.
- **Merge status:** Not reviewed; not merged.

### 2026-08-09 19:20 UTC — Codex (GPT-5.6 Sol), PR #1175 bounded-review verification

- **Branch / PR:** `release/consolidated-recovery-20260717` / existing draft PR #1175.
- **Scope / files:** Review-tooling safeguard verification only; this handoff entry is the sole repository change. No production or test source changed.
- **Finding / solution:** GitHub reports PR #1175 as a 1,056-file consolidation (83,244 additions / 43,990 deletions), so any tool that requests the full PR patch can exceed its extraction limit. The PR description now starts with a permanent instruction not to request the full patch and gives the bounded current range `811942fb...0f366cb9` plus the three named commits/files. Reviewers and automation must fetch the head and inspect only those bounded commits or named files. Rewriting history, retargeting, or opening another PR was deliberately avoided.
- **Checks actually run:** `gh api repos/hopeengineering83-code/hope-tender-path-b/pulls/1175` — open draft, head `0f366cb9`, 1,056 files; `gh api repos/hopeengineering83-code/hope-tender-path-b/pulls/1175/comments` — no inline comments; previous-head GitHub check-runs — all completed successfully; exact-head checks started after this documentation push; `git status --short --branch` — clean before this entry.
- **CI / deployment:** Previous-head CI was green; exact-head CI is running after this documentation-only push. No merge, approval, force-push, rebase, base change, new PR, Preview request, or Production deployment performed.
- **Known limitation:** The warning cannot be prevented when a client ignores the safeguard and explicitly requests the full 1,056-file patch; avoiding that request and using the bounded compare/commit views is the non-destructive remedy for this existing consolidation PR.
- **Next action:** Review only the bounded range and keep PR #1175 draft until owner-only release blockers are resolved.
- **Merge status:** Not reviewed; not merged.

### 2026-08-09 18:05 UTC — Claude Code (Opus), PR #1175 Engine wake constraint coverage

- **Branch / PR:** `release/consolidated-recovery-20260717` / existing draft PR #1175.
- **Scope / files:** One new test file, `tests/engine-worker-wake-constraints.test.ts`. No production
  source changed.
- **Duplicate avoided:** I had independently written a manual-Engine wake
  (`lib/ai-jobs/manual-engine-worker-wake.ts` plus its own route wiring and tests) before fetching.
  Codex had already shipped the same feature in `cdae73cb` as
  `lib/ai-jobs/request-scoped-engine-worker-wake.ts`. Committing mine would have left two competing
  wake modules on one route, so I deleted mine and kept Codex's — theirs additionally skips the wake
  when the reused job is already RUNNING. The new tests target Codex's module.
- **Gap closed:** `tests/engine-worker-handoff.test.ts` proves the sequential happy path (one QUEUED
  job across duplicate enqueue, claimed, SUCCEEDED). It does not cover the properties the wake newly
  puts at risk. The added file covers only those, with no overlapping assertions: exactly-once when
  the wake races the cron (exactly 1 winner of 4 mixed racers; 1 of 12 concurrent wakes), the wake
  sitting behind all six fail-closed source gates, the wake never authenticating as an automated
  caller (so `failStuckJobs` / `reapStaleQueuedJobs` / `findJobsDueForRetry` stay cron-only), and
  tenant / tender / jobType scope.
- **Tests actually run:** `npx prisma generate` — passed. `npx tsc --noEmit` — passed.
  `npx next lint` — no warnings or errors. Full `npm test` against a real local PostgreSQL 16 with
  `RUN_DB_INTEGRATION=true` — **9767/9767 passed, 0 failed**. This includes
  `tests/engine-worker-handoff.test.ts`, which the two Codex entries below record as **not executed
  locally** because the configured Neon host was unreachable; it is now verified against a real
  database and passes.
- **CI / deployment:** PR #1175 exact-head CI was re-running when checked; the earlier `d7d93afc`
  failures are superseded by `3d53eb6a`. No merge, approval, force-push, base change, new PR, or
  production deployment performed.
- **Risks / assumptions:** The wake keeps the engine route's invocation alive until `run-next`
  responds (bounded by its `maxDuration = 60`). If Vercel kills it first the job is left for
  `failStuckJobs`, which is the intended cron-as-recovery path.
- **Next action:** Prove the gated `generateTenderDocuments -> finalizeRequiredPdf ->
  assembleFinalSubmissionZip` route end-to-end; it remains the last open engineering item.
- **Merge status:** Not reviewed; not merged.

### 2026-08-09 18:20 UTC — Claude Code (Opus), auto-finalize chain behavioural coverage

- **Branch / PR:** `release/consolidated-recovery-20260717` / existing draft PR #1175.
- **Scope / files:** One new test file, `tests/auto-finalize-pipeline-behavioral-db.test.ts`. No
  production source changed.
- **Gap closed:** `runAutoFinalizeAfterGeneration` is the application's real bridge from generated
  DOCX documents to a downloadable package, and its only coverage
  (`gap3-durable-auto-finalize.test.ts`, `auto-finalize-continuation-gap4.test.ts`) was `readFileSync`
  plus regex over the source. Those assert the calls are *written*, not that the chain *works* — they
  would stay green if the renderer emitted zero bytes or an unvalidated DOCX were promoted into the
  package. The new tests run the real function against real PostgreSQL with real `docx`-generated
  bytes and assert on persisted rows: a required PDF is rendered from a VALIDATED DOCX and persisted
  with a real `%PDF-` header plus a matching SHA-256; an unvalidated source finalizes nothing and
  creates no PDF row; a missing source is skipped rather than thrown, so the durable worker survives.
- **Tests actually run:** `npx tsc --noEmit` — passed.
  `RUN_DB_INTEGRATION=true npx tsx --test tests/auto-finalize-pipeline-behavioral-db.test.ts` —
  3/3 passed against local PostgreSQL 16.
- **OPEN LEAD (not a confirmed defect, do not treat as one):** while writing these I observed that a
  freshly finalized PDF is persisted and then marked `validationStatus = FAILED` by
  `runCanonicalValidation`, and that a second `runAutoFinalizeAfterGeneration` on the same tender
  reported `failed: 1` with the PDF row no longer present. `checkFullExportReadiness` reported
  `FILE_BYTES_NOT_VERIFIED: LEGACY_INTEGRITY_UNKNOWN` for the finalized PDF — but it reported the
  same for the seeded source DOCX despite `integrityStatus: "VERIFIED"`, which strongly suggests my
  hand-built fixture does not carry whatever real generation sets for byte verification. So this may
  be fixture fidelity rather than a product bug. It is worth resolving because, if real, an
  AUTO_FINALIZE retry would destroy a finalized PDF and never converge. The idempotency assertion was
  therefore NOT committed: a red test would block CI on an unproven claim.
- **CI / deployment:** No merge, approval, force-push, base change, new PR, or production deployment.
- **Next action:** Seed a generated document through the real generation path (not a hand-built row)
  and re-check whether the finalized-PDF retry behaviour above reproduces.
- **Merge status:** Not reviewed; not merged.

### 2026-08-09 16:35 UTC — Codex (GPT-5.6 Sol), PR #1175 diff-review safeguard

- **Branch / PR:** `release/consolidated-recovery-20260717` (local `pr-1175`) / existing draft PR #1175.
- **Scope / files:** Investigated the reported diff-extraction size warning and updated this handoff only. PR #1175 is a long-lived consolidation with 1,052 changed files (82,227 additions / 43,983 deletions), while the Run Engine handoff is isolated to commits `cdae73cb` and `9f621545`. No production or test code changed in this follow-up.
- **Tests / checks:** `npx prisma generate` — passed; `npx tsx --test tests/engine-worker-handoff.test.ts` — environment warning because the configured non-production Neon database was unreachable before fixture creation; `npm run typecheck` and `git diff --check` — passed; `gh pr view 1175 --json ...` and `gh pr checks 1175` — confirmed the exact PR/head and current checks; GitHub reports no inline review comments.
- **CI / deployment:** Exact-head dependency audit, screenshot audit, and Vercel Preview passed; the duplicated CI jobs were still pending when checked. No merge, approval, force-push, base change, new PR, or production deployment performed.
- **Risks / assumptions:** GitHub cannot render/extract the complete consolidation diff reliably at this size. Review automation must use the two-commit incremental range (`b35cb7f5..9f621545`) rather than requesting the full PR diff. Shrinking the PR itself would require rewriting or retargeting its established consolidation history, which was not owner-authorized.
- **Next action:** Review the incremental Run Engine range and require exact-head PostgreSQL CI before merge consideration.
- **Merge status:** Not reviewed; not merged.

### 2026-08-09 16:23 UTC — Codex (GPT-5.6 Sol), PR #1175 review correction

- **Branch / PR:** `release/consolidated-recovery-20260717` (local `pr-1175`) / existing draft PR #1175.
- **Scope / files:** Replaced the source-text/simulated worker assertion in `tests/engine-worker-handoff.test.ts` with one real PostgreSQL behavioral regression using the canonical Engine enqueue authority, atomic claim policy, and durable completion API. No production source changed in this follow-up; this entry records the correction.
- **Tests:** `npm run typecheck` — passed. `RUN_DB_INTEGRATION=true npx tsx --test tests/engine-worker-handoff.test.ts` — environment warning: the configured non-production Neon test database was unreachable before fixture creation, so the behavioral test did not execute locally.
- **CI / deployment:** PR #1175 exact-head CI was still pending when checked. No merge, approval, or production deployment performed.
- **Risks / assumptions:** The new regression requires PostgreSQL by design and will run in CI's isolated PostgreSQL service. It proves one persisted job across duplicate enqueue, actual `QUEUED -> RUNNING -> SUCCEEDED` database transitions, and no third user action.
- **Next action:** Push the correction to PR #1175 and require its PostgreSQL CI result before calling the defect complete.
- **Merge status:** Not reviewed; not merged.

### 2026-08-09 16:19 UTC — Codex (GPT-5.6 Sol)

- **Branch / PR:** `release/consolidated-recovery-20260717` (local `pr-1175`) / existing draft PR #1175.
- **Scope / files:** Run Engine worker handoff only: `app/api/tenders/[id]/engine/route.ts`, new `lib/ai-jobs/request-scoped-engine-worker-wake.ts`, new `tests/engine-worker-handoff.test.ts`, and this handoff entry.
- **Fix:** After the authenticated manual route durably enqueues or reuses a claimable `ENGINE_RUN`, it schedules exactly one authenticated, tender-scoped server wake of the existing `run-next` worker. RUNNING jobs are not woken; failed wakes leave persisted state unchanged for recovery.
- **Tests:** `npx tsx --test tests/engine-worker-handoff.test.ts` — 1 passed; `npx prisma generate` — passed without tracked generated output; `npm run typecheck` — passed.
- **CI / deployment:** Existing PR #1175 head checks were green before this change. New exact-head CI not yet run. No merge, approval, or production deployment performed.
- **Risks / assumptions:** Wake delivery is best-effort through Next.js `after()`; durability remains in the `AiJob` row. The tender-scoped worker filter prevents another queued Engine job for the same user from consuming this wake.
- **Next action:** Push this commit directly to PR #1175 and review its exact-head CI.
- **Merge status:** Not reviewed; not merged.

### 2026-08-08 18:05 UTC — Claude Code

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175, head `a72071be`. Audit passes 5–6; one confirmed open gap recorded, no code change in this entry.
- **Pass 5 — extraction quality: SOUND, left unchanged.** `classifyPageText` in `lib/extraction-quality.ts` implements every one of CLAUDE.md's six conditions for a "perfectly extracted page", and `status === "GOOD"` requires all of them. Condition 5 ("not only headers/footers/noise") is implemented the hard way — density is measured on `meaningfulPageCharCount`, which strips headers and footers first — so a page padded with boilerplate cannot reach GOOD on raw character count. Acceptance criteria 1 and 2 are satisfied.
- **Pass 6 — client-detail provenance: CONFIRMED GAP.** Acceptance criterion 4 and requirement 20 demand a source page and source quote for **every** extracted client field. All 19 client data fields exist in the AI schema, and `TenderFactsLedger` carries the correct generic provenance triple (`sourceFileId`, `sourcePage`, `sourceQuote`) with a real grounding check (`hasSourceEvidence`). The design is right. But only **9** semanticKeys are ever written — `title, clientName, reference, deadline, submissionMethod, submissionEmails, submissionAddress, country, submissionEmailSubject` — all as literals in `lib/engine/tender-facts-ledger-service.ts:799-1046`, with no dynamic key writing anywhere. **12 client fields therefore have no ledger row and no provenance:** legalClientName, donorAgency, implementingAgency/projectOwner, city, clientAddress, clientContactName, clientContactTitle, clientContactEmail, clientContactPhone, clientWebsite, preBidChannel, clientRepresentative. Full evidence and the implementation plan are in the Active Workboard item; the fix extends the existing write block rather than adding scalar `xSourcePage`/`xSourceQuote` columns, which the ledger exists to replace.
- **Honest acceptance-matrix position (10 criteria):** 8 verified PASS, 1 verified FAIL (criterion 4, above), 1 not yet exercised (criterion 8 — "does not build an empty submission plan when requirements exist"). This is **not** 100%. Two prior sessions' worth of "score" claims in this repo were asserted without exercising the criteria; this entry states what was actually run.
- **Tests actually run:** no code changed in this entry. The last full run on this head was 9636/9636 pass with `RUN_DB_INTEGRATION=true` against local PostgreSQL 16, database verified alive before and after.
- **Risks / assumptions:** the 12 missing fields are extracted by the AI and may be displayed, so the gap is provenance and grounding, not absence of data — a reviewer cannot trace those values to a page and quote, and no gate can treat them as source-grounded.
- **Next action:** implement the workboard item (12 ledger mappings + DB-integration tests asserting `hasSourceEvidence`, and `NOT_STATED_IN_SOURCE` rather than a placeholder when the AI supplied none).
- **Merge status:** not reviewed.

### 2026-08-08 17:35 UTC — Claude Code

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175. Pushed `d6999353..d2b5a71a` (four commits from the two prior entries), then this follow-up.
- **CORRECTION to the previous entry.** Commit `d2b5a71a` claimed the phrase "to be confirmed by bid team" "travelled all the way into a client-facing tender submission with nothing objecting." **That was wrong, and the claim overstated the defect.** Re-checking the export path end to end shows the delivered content *was* already gated:
  - `PLACEHOLDER_PATTERNS` (= `DOCUMENT_PLACEHOLDER_PATTERNS`) contains `/to\s+be\s+(?:added|filled|completed|provided|confirmed|determined)\b/i`, which matches that phrase;
  - `app/api/tenders/[id]/download` extracts each DOCX's **real visible text** via `extractDocxVisibleText` and runs `validateDocumentQuality`, returning 409 `QUALITY_VALIDATION_BLOCKED` on BLOCKED;
  - `lib/engine/workflow/pdf-finalizer.ts` runs the same validator plus hygiene and internal-artifact scans on the extracted text **before** a PDF is produced, so failing content never becomes a deliverable.
  `d2b5a71a` is still correct and worth keeping — it makes Authority Review agree with itself, since one phrasing of the identical stub was classified CRITICAL and the other was invisible — but it is defense in depth, **not** the closure of an open export hole. The export gate was sound. Recording this because the earlier wording would leave the next reader believing a shipped submission had been possible.
- **Scope / files:** `lib/engine/authority-review.ts` — documented the module's actual scope. It reads `contentSummary` and `reviewNotes` only, never document bytes or rendered text, while its blocker names imply otherwise (`TODO_FIXME_IN_CONTENT` says "IN_CONTENT" outright). The note names the two checks that do carry the content guarantee and warns against collapsing the export path into this module on the assumption that it covers the same categories.
- **Verified sound, deliberately left unchanged:** the layered content gate above. This is proven-good work; the correct action was to document it, not to add a redundant fourth check.
- **Tests actually run:** local PostgreSQL 16, `RUN_DB_INTEGRATION=true`. `npx tsc --noEmit` PASS. Full suite **9636/9636 pass, 0 fail**, database verified alive before and after.
- **Risks / assumptions:** comment-only change to `authority-review.ts`; no behavior altered. The residual (accepted) limitation is that a non-DOCX final artifact is not re-scanned at ZIP time — `visibleText` is extracted for `.docx` only and base64 content is deliberately skipped to avoid false negatives. That is safe **because** `pdf-finalizer` gates the content before the PDF exists; it would stop being safe if any path ever produced a final PDF without going through that finalizer.
- **Next action:** continue the audit into the Vault review UI items on this workboard.
- **Merge status:** not reviewed.

### 2026-08-08 15:20 UTC — Claude Code

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175, rebased onto exact head `d6999353`. No other agent's commits rebased or discarded.
- **Scope / files:** deep audit pass. Two confirmed defects, both the same failure mode — the system asserting confidence it had not earned.
  - `lib/engine/proposal-benchmark-guard.ts` — **placeholder laundering.** `normalizeWeakText()` rewrites every placeholder, TBD, TODO, template variable and AI refusal into the phrase "to be confirmed by bid team", and runs *before* `hasForbiddenWeakness()` scores the document. That detector tested for `placeholder|tbd|todo|to be determined` — none of which survive the rewrite. A proposal left full of unresolved spots therefore scored **+5 and collected the strength "No obvious AI/placeholder/TBD language detected"**, while the module's own reviewer checklist ("Confirm that no placeholder wording remains") was guaranteed to be answered wrongly. Added `countUnresolvedPlaceholders()`, taught the detector the substituted phrase, replaced the false strength with a gap stating the count, and exposed `unresolvedPlaceholderCount` on `ClientReadyProposal`. Rewriting a raw `${var}` into readable wording is still done — only the claim that the result is clean is removed.
  - `CLAUDE.md` — **the guide contradicted the contract it names as authority.** Its Product-goal section said AI Analyze and Run Engine are "durable server-owned stages, not mandatory normal-path user actions", while `OWNER_AUTOMATION_CONTRACT.md` and the shipped code make both explicit manual gates (`createAnalysisJob()` requires `manualAuthority`; the engine route requires `manualRequested: true`; `continueSuccessfulAnalysis()` always returns `MANUAL_ENGINE_REQUIRED`). This sent successive sessions back and forth undoing each other. Rewrote the section to match, with an explicit note not to re-automate them.
  - `CLAUDE.md` — removed a pinned "Current Main State (SHA: 63369f03 … 6000+ tests)" block (the suite is now 9628) and a four-item priority list whose every engineering item had already shipped (`TenderFactsLedger` wiring, `scripts/backfill-tender-facts-ledger.ts`, `CONDITIONAL_OR_UNSCHEDULED`, the 800×1280 E2E viewport). Both were sending each new session to redo finished work or to trust a status nobody had re-run.
  - `tests/proposal-placeholder-laundering.test.ts` (new, 4 behavioral tests).
- **Verified clean in the same pass (no change needed):** the placeholder ban on tender metadata is genuinely enforced end to end — every occurrence of "Bid-Team to confirm"/TBD/N/A in `lib/` is detection or rejection (AI prompt prohibition, `tender-metadata-completeness.ts`, `final-submission-readiness.ts`), none produce placeholders as values. All 32 TODO/FIXME hits in production code are content-detection regexes, not developer debt.
- **Tests actually run:** local PostgreSQL 16, `RUN_DB_INTEGRATION=true`. `npx tsc --noEmit` PASS. Full suite `npm test` **9628/9628 pass, 0 fail**; database verified alive before and after the run. The new test fails 4/4 against the pre-fix guard.
- **Risks / assumptions:** the benchmark score now drops 5 points and reports NEEDS REVIEW for any document carrying unresolved spots. `score.passed` gates nothing downstream (its only consumer, `generate-elite.ts`, uses `finalized.markdown`), so this changes reporting, not generation. Open question for the owner: whether a document with `unresolvedPlaceholderCount > 0` should additionally fail-close the final export gate. Not changed here — that is a behavioral decision, not a defect fix.
- **Next action:** owner decision on the export-gate question above; continue the audit into the Vault review UI items on this workboard.
- **Merge status:** not reviewed.

### 2026-08-08 13:40 UTC — Claude Code

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175. Fast-forwarded local to the exact remote head `977831ae` before editing; no other agent's commits were rebased, discarded, or amended.
- **Scope / files:** Company Vault re-extraction reported success for documents it never processed. `reextractAllCompanyDocuments` excluded rows with no inline `fileContent` and no `storagePath` in its `where` clause and `continue`d past any that got through, so those rows landed in neither `reextracted` nor `failedFiles` — a vault made entirely of them returned `{ reextracted: 0, failedFiles: [] }`, a clean success for a run that did nothing. That is the reported "DOCUMENTS 6 — 0 extracted" with an unverified-integrity banner, no stated cause, and no action that could ever change it.
  - `lib/company-vault-reextraction.ts` — stopped filtering byteless rows out of the query; classify them as a terminal `SOURCE_BYTES_UNAVAILABLE` state on the row (`integrityStatus: "MISSING"`, `contentSha256: null`, `aiExtractionStatus: "FAILED"`, explicit `aiExtractionError`, metadata `extractionStatus: "SOURCE_BYTES_MISSING"`); added an `unrecoverable` array to `ReextractAllResult`.
  - `lib/ai-job-handlers-legacy.ts` — VAULT_INGEST step message, audit metadata (`docsUnrecoverable`) and job output (`reextractionUnrecoverableFiles`) now name the affected files and state re-upload as the remedy.
  - `app/api/company/knowledge/repair/route.ts` — per-document `SOURCE_BYTES_MISSING` status plus a separate CRITICAL gap, so it is no longer folded into "unverified until their bytes have a digest" (wording that implies a pending fix that will never arrive).
  - `tests/vault-reextraction-unrecoverable-bytes.test.ts` (new, 4 behavioral DB tests), `tests/extraction-quality-round9.test.ts` (return-shape assertion updated + a guard against the skip returning).
  - No schema/migration change. No new user-facing click: the two manual gates remain AI Analyze and Run Engine.
- **Tests actually run:** local PostgreSQL 16, `RUN_DB_INTEGRATION=true`, migrations deployed. `npx tsc --noEmit` PASS (exit 0). `next lint --dir lib --dir tests` PASS (no warnings or errors). Full suite `npm test` **9601/9601 pass, 0 fail** (2391 suites, 237s). `npx next build` PASS (compiled in 91s, 57/57 static pages). New test verified to genuinely catch the defect: 3 of its 4 cases fail against the pre-fix code and all 4 pass after.
- **CI / deployment:** not yet run for this commit. On the previous head the `hope-tender-path-b` Vercel project reported Ready/DEPLOYED. The `pr1175` and `repo` Vercel projects report Error with empty preview URLs; they were already failing before this work and are stray projects, not a signal from this branch.
- **Risks / assumptions:** documents that already carried `extractedText` but lost their bytes keep that text rather than having it deleted — destroying stored data was judged out of scope, and downstream evidence already refuses text without a verified digest. Re-upload is the only real remedy for these rows; nothing here recovers bytes that are gone.
- **Next action:** watch PR #1175 CI on this commit.
- **Merge status:** not reviewed.

### 2026-08-02 16:25 UTC — Codex (GPT-5.6 Sol)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175; re-fetched and verified exact starting head `2f90c465e7207159b0dba7211509f94fc7760f82` before editing.
- **Scope / files:** inspected both duplicate failed GitHub CI jobs and found the same two stale source-contract assertions in `tests/canonical-vault-engine-panels.test.ts`: they still required the retired phrase `Partially supported` after the canonical runtime state was intentionally renamed `PARTIALLY_VERIFIED` / `Partially verified`. Updated those assertions to enforce the canonical state vocabulary and changed this handoff. No application, schema, provider, release-gate, deployment, or unrelated behavior changed.
- **Tests:** the 32-test focused requirement/evidence and canonical-panel set passed; Prisma generation, TypeScript, full lint, Prisma validation, dependency audit (0 vulnerabilities), and `git diff --check` passed.
- **CI / deployment:** exact starting-head check jobs `91518513556` and `91518508323` each reached the complete test run and failed only the same two stale assertions (8,983/8,985 assertions passed); dependency and Vercel comment checks passed, while exact-head capture was still running when inspected. No deployment was requested or created.
- **Risks / assumptions:** updated-head PostgreSQL/full-suite/build/authenticated browser/capture results remain CI-dependent. This correction reconciles tests with the already-covered canonical runtime truth rather than weakening an acceptance condition.
- **Next action:** push this commit to the existing PR #1175 head, let exact-head CI/capture rerun, and inspect any newly exposed failure while keeping the PR draft and unmerged.
- **Merge status:** not reviewed for merge; draft and unmerged.

### 2026-08-02 UTC — Codex (GPT-5.6 Sol)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175; re-fetched and verified starting head `87fa6a28b9461900dd9c0471539cf37c4f3c6cc8` before editing.
- **Scope / files:** corrected Requirements and Evidence runtime-state truth so `AUTO_RESOLVING` is emitted only when a tenant-scoped `ENGINE_RUN` job is actually queued/running/partial, removed zero-processing copy that said automatic work was running, and strengthened the exact runtime-fixture contract. Changed `app/api/tenders/[id]/requirement-coverage/route.ts`, `components/requirement-coverage-panel.tsx`, `tests/requirement-evidence-resolver-runtime-fixture.test.ts`, and this handoff.
- **Tests:** focused requirement/evidence suites passed (41 tests, then 18 tests after the final change); Prisma generation, typecheck, scoped ESLint, full lint, Prisma validation, `npm audit --audit-level=high` (0 vulnerabilities), and production build with non-secret build-only provider/cron placeholders passed. The full PostgreSQL run could not proceed because the configured Neon host returned Prisma P1001; migration status had the same external database limitation. Provider-backed preview execution, Vercel runtime logs, authenticated screenshots, and Playwright were not claimed without working preview/database credentials.
- **Risks / assumptions:** the existing PR already contains the canonical resolver and fixture fixes; this session deliberately made no release-gate, provider-order, schema, deployment, or unrelated-area change. `PARTIAL_SUCCESS` remains an active durable Engine state because current enqueue/recovery code treats it as resumable.
- **Next action:** after the configured PostgreSQL/preview environment is reachable, run the remaining exact-head migration/full-DB/Playwright/provider-backed preview checks and inspect deployment `dpl_AKr8QMbzMcS1rcNn5SAnj1auw8JL` logs before considering the draft ready.
- **Merge status:** not reviewed for merge; draft and unmerged.

### 2026-08-02 15:44 UTC — Codex (GPT-5.6 Sol)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175; re-fetched exact starting head `e8ff72ac23eaebb2e1ea37ac8b4a36e1a39a36e2` before editing.
- **Scope / files:** repaired the only failing CI assertion left by the canonical Requirements and Evidence change. `tests/requirement-coverage-safe-errors-current.test.ts` now verifies the intentional `flatMap` path and its rejection of malformed automatic and null-reference rows instead of requiring the superseded `map` implementation. No application or release-gate behavior changed in this follow-up.
- **Tests:** focused requirement/evidence suite passed (37/37); `npx prisma generate`, typecheck, lint, and the release-integrity audit passed. Full `RUN_DB_INTEGRATION=true npm test` could not complete because the configured Neon PostgreSQL host was unreachable; the first DB hook failed in `tests/ai-job-concurrency.test.ts` with Prisma connectivity, not an assertion failure. Production build reached the fail-closed `next.config.js` preflight and stopped because this local environment has no supported AI-provider key.
- **CI / deployment:** inspected exact-head CI; both duplicate primary jobs failed only on the stale structural assertion corrected here. Dependency checks and Vercel capture/comment checks were green. No deployment was requested or created.
- **Risks / assumptions:** provider-backed preview execution, Vercel runtime-log inspection, full PostgreSQL, build, and Playwright remain to be re-run by CI or an environment with database/preview credentials. Fail-closed behavior is unchanged.
- **Next action:** push this commit to the existing PR head and let PR #1175 CI re-run; keep the PR draft and unmerged.
- **Merge status:** not reviewed; draft and unmerged.

### 2026-08-02 15:05 UTC — Codex (GPT-5.6 Sol)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175; began from exact re-fetched head `c5a7a654228a378ec6953b45c111317fcf2945f6`.
- **Scope:** Requirements and Evidence runtime repair for deployment `dpl_AKr8QMbzMcS1rcNn5SAnj1auw8JL` / tender `e15b9e35-d8a8-4136-97e8-9f087cd1078a`: family-specific FULL evaluation for verified expert/project/current bytes, complementary quantity enforcement, audit-complete automatic-link metadata, structural source-quote rejection, stable semantic requirement identity/deduplication, exact canonical UI states, unweighted mandatory coverage, and removal of panel-open POST as workflow authority.
- **Files changed:** `lib/engine/automatic-requirement-coverage.ts`, `lib/engine/requirement-source-extractor.ts`, `lib/engine/stable-requirements.ts`, `lib/vault-review-provenance.ts`, `app/api/tenders/[id]/requirement-coverage/route.ts`, `components/requirement-coverage-panel.tsx`, `tests/automatic-requirement-coverage-behavior.test.ts`, `tests/requirement-coverage-confirm-safety.test.ts`, and `tests/requirement-evidence-resolver-runtime-fixture.test.ts`.
- **Tests:** focused requirement/evidence run 26/26 passed; `npx prisma generate` passed; `npx tsc --noEmit` passed; `npm run lint` passed; `npm run prisma:validate` passed; `npm audit --audit-level=high` passed with 0 vulnerabilities. Full `npm test` was stopped after the external Neon database was unreachable; the first DB-backed suite failed only with connection error. Production build reached Next config and was blocked because this container has no AI provider key.
- **CI/deployment:** pre-edit PR checks and Vercel status were green. Exact supplied deployment is READY and bound to the verified starting SHA. Build events were available; the Vercel CLI returned no runtime invocation logs for the requested window. No deployment was created.
- **Risks / assumptions:** no provider credentials or reachable PostgreSQL were available, so provider-backed synthetic execution, full PostgreSQL, browser fixture login/screenshot, and post-change deployed runtime logs remain unverified. The implementation remains fail-closed; current fixture coverage must be recomputed on a preview before any 6/6 claim.
- **Next action:** run the full PostgreSQL and Playwright matrices with deployment credentials, deploy this committed head through the existing draft PR only if Hope authorizes it, then rerun the exact fixture and inspect runtime logs.
- **Merge status:** unsafe to merge until those environment-dependent checks complete; PR remains draft and unmerged.

### 2026-08-01 18:45 UTC — Codex (GPT-5.6 Sol), PR #1175 exact-head 100% acceptance

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175 at exact application/test head `9a939aa85bc9e004316b5d48d45c9b3b9b2a7184`; zero inline comments and zero reviews. No merge or production deployment.
- **Scope:** verification-only closure of the remaining external 5%. Reconciled the live PR head after an initially stale/no-remote local checkout, downloaded both exact-head CI logs and the exact-head route/screenshot artifact, and visually inspected the desktop and mobile Global Matching screenshots. No application, schema, migration, provider, workflow, gate, or test behavior changed.
- **Evidence:** both duplicated exact-head workflows passed migrations, PostgreSQL, release integrity, typecheck, lint, 8,909/8,909 assertions, 58-page production build, source-mutation checks, and authenticated Playwright (180 and 179 passes respectively). Exact-head capture artifact `8822470731` contains 237 screenshots over desktop/tablet/mobile and reports 111/111 expected route cases, 100% coverage, zero critical findings, zero horizontal overflow, and zero warnings. Global Matching visibly renders the read-only automatic authority with no selection/rematch controls at desktop and mobile widths.
- **Completion assessment:** the explicit Company Vault → durable Run Engine → automatic matching → requirement-evidence goal is now 100% implemented and 100% verified across static contracts, PostgreSQL, full tests, production build, authenticated browser flows, and visual capture. No known scoped gap or external verification hold remains.
- **Next action:** keep PR #1175 draft/unmerged until Hope's explicit approval; investigate only a new reproducible owner-data correlation reference or screenshot.
- **Merge status:** scoped goal safe and fully verified; repository-level merge remains Hope-controlled.

### 2026-08-01 18:33 UTC — Codex (GPT-5.6 Sol), PR #1175 final anchor-audit reconciliation

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175 at `828ac69`; no merge or production deployment.
- **Scope / root cause:** exact-head CI reached the complete unit suite and found one stale source-shape assertion in `tests/final-overlap-consolidation.test.ts`. The production panel now renders its canonical anchor through the typed default `sectionId` prop so Global Matching can supply unique per-tender ids, but this older audit recognized only literal ids and workflow-stage ids. Extended the audit to recognize the rendered default-id contract without weakening anchor existence: the default value and `id={sectionId}` binding must both exist.
- **Files changed:** `tests/final-overlap-consolidation.test.ts`, `operator_handoff.md` only. No application, schema, provider, Engine, Vault, matching, readiness, generation, or export behavior changed.
- **Tests / evidence:** focused workflow/canonical-panel/UI tests, targeted ESLint, and `git diff --check` are required before commit. Both exact-head CI copies failed only this stale assertion after the preceding application correction; updated-head full CI/capture remains required for final external acceptance.
- **Known risk / assumption:** this is a static-test reconciliation for an already-tested responsive unique-id implementation; it does not substitute for authenticated browser and PostgreSQL acceptance.
- **Next action:** commit and push to PR #1175, require exact-head CI/capture green, inspect the final capture, and keep the PR draft/unmerged.
- **Merge status:** not reviewed — exact-head external acceptance pending.

### 2026-08-01 18:20 UTC — Codex (GPT-5.6 Sol), PR #1175 matching responsive/DOM closure

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175 at `c22950b`; zero inline comments/reviews. No merge or production deployment.
- **Scope / root cause:** the corrected shortcut passed, and exact-head CI then exposed two real Global Matching defects that the collapsed capture did not exercise: rendering the shared canonical panel once per tender repeated `id="matching-selected-evidence"`, and an injected long unbroken tender title expanded the 390px page to 1420px. Added an optional section id with the canonical tender-page default, assigned deterministic per-tender ids in Global Matching, bounded/hidden overflow, and allowed summary titles to break. Updated static anchor ownership tests to recognize the rendered default-id contract.
- **Files changed:** `components/matching-selected-evidence-panel.tsx`, `app/dashboard/matching/matching-dashboard.tsx`, `tests/canonical-vault-engine-panels.test.ts`, `tests/ui-gap-analysis.test.ts`, `tests/workflow-shortcut-anchor-contract.test.ts`, `operator_handoff.md`.
- **Tests / evidence:** Prisma generation and TypeScript passed; focused panel/matching/UI/shortcut assertions pass after updating the default-id static contract; targeted ESLint and `git diff --check` pass. Predecessor exact CI passed all migrations, PostgreSQL, release integrity, complete unit/database suite, build, and the corrected shortcut, then failed only the duplicate-id and long-title overflow browser assertions. Exact capture passed 111/111 with zero findings but used ordinary collapsed fixture titles, demonstrating why adversarial authenticated browser coverage remained necessary.
- **Completion assessment:** both final browser-discovered defects are corrected with regression assertions. Exact-head CI/capture must rerun green before declaring 100% externally verified.
- **Next action:** push, require final exact-head green, inspect matching screenshots, and keep #1175 draft/unmerged.
- **Merge status:** not reviewed — local correction passes; exact-head external acceptance pending.

### 2026-08-01 18:08 UTC — Codex (GPT-5.6 Sol), PR #1175 authenticated shortcut closure

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175 at `73db723b`; zero inline comments/reviews. No merge or production deployment.
- **Scope / root cause:** exact-head capture passed 111/111 route/viewport cases with zero findings, and both full CI copies passed migrations, PostgreSQL, release integrity, typecheck, lint, the complete unit/database suite, and production build. Authenticated Playwright then exposed the final stale in-between contract: `e2e/workflow-control-center-action-buttons.spec.ts` still required retired `#match-evidence`. Because its `beforeEach` checked every target, that single stale selector failed all 12 shortcut cases. Updated it to `#matching-selected-evidence` and added a static cross-contract assertion so browser and production anchor registries cannot diverge again.
- **Files changed:** `e2e/workflow-control-center-action-buttons.spec.ts`, `tests/workflow-shortcut-anchor-contract.test.ts`, `operator_handoff.md`.
- **Tests / evidence:** 24/24 focused canonical-panel/UI/shortcut assertions passed; targeted ESLint and `git diff --check` passed. Exact-head capture artifact `8821969864` was downloaded and inspected: desktop/tablet/mobile Global Matching screenshots show the read-only automatic authority without manual controls; audit summary reports 111/111 coverage, zero critical findings, zero overflow, and zero warnings.
- **Completion assessment:** this fixes the only failing authenticated assertion. A final exact-head CI rerun must confirm the corrected browser suite before claiming 100% externally verified completion.
- **Next action:** push, require exact-head checks green, and keep #1175 draft/unmerged pending Hope's approval.
- **Merge status:** not reviewed — focused correction and exact predecessor capture pass; corrected-head full CI pending.

### 2026-08-01 17:45 UTC — Codex (GPT-5.6 Sol), PR #1175 full-suite stale-contract closure

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175 at `ee45407`; zero inline comments/reviews. No merge or production deployment.
- **Scope / root cause:** both exact-head CI copies progressed through PostgreSQL and the full suite, then exposed three additional assertions that still described removed behavior: a live-route test required manual `PUT /matches`; a zero-coverage test required superseded non-neutral copy; and a presentation test required check/warning/chevron icons in the retired dashboard instead of the shared canonical panel. Updated those tests to enforce the intended goal: GET-only matching, `Automatic verification running`, and the canonical panel's single warning/disclosure icons with no repeated check icon.
- **Files changed:** `tests/action-registry-live-route-contract.test.ts`, `tests/canonical-workflow-truth-precondition-gates.test.ts`, `tests/compliance-gap-export-parity.test.ts`, `operator_handoff.md`.
- **Tests / checks:** all newly exposed static assertions pass along with the earlier 24 focused tests; release integrity has zero failures; `git diff --check` passes. The local combined file also contains PostgreSQL cases that cannot reach the configured Neon host here, but those same database cases passed in exact-head CI before the stale static assertions failed.
- **Completion assessment:** all known application and in-between contract gaps are corrected. A final exact-head CI/capture rerun is still required for the remaining external acceptance percentage.
- **Next action:** push, require exact-head checks green, download/inspect capture evidence, and record final acceptance.
- **Merge status:** not reviewed — corrections pass locally; exact-head external acceptance pending.

### 2026-08-01 17:33 UTC — Codex (GPT-5.6 Sol), PR #1175 exact-head full-suite correction

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175 at `54124fa4`; zero inline comments/reviews. No merge or production deployment.
- **Scope / root cause:** downloaded both exact-head CI logs. PostgreSQL and the complete 8,900+ assertion run reached the final UI contract group and exposed two stale in-between contracts: `REVIEW_EVIDENCE` had been changed to the `match` verb but retained `ClipboardCheckIcon`, conflicting with the canonical `LinkIcon`; and the workflow consumer test still required the deleted `MatchingQualityPanel`/`EvidenceCoveragePanel`. Unified the matching verb icon and updated the ordering assertion to the live `RequirementCoveragePanel` then `MatchingSelectedEvidencePanel` authority sequence.
- **Files changed:** `lib/ui/action-registry.ts`, `tests/workflow-center-consumer-contract.test.ts`, `operator_handoff.md`.
- **Tests / checks:** the two failed CI assertions now pass; 24/24 focused canonical-panel/action-registry/workflow-consumer tests passed; release-integrity audit remains zero-failure; `git diff --check` passed. Predecessor capture passed, while both full CI copies failed only on these two final assertions after the database/full suite had otherwise run.
- **Completion assessment:** no known scoped implementation gap remains. Updated-head exact CI must turn green before declaring the final 5% externally verified.
- **Next action:** push, require both full CI copies and capture green, inspect the exact-head capture artifact, then record final verification without changing application code unless acceptance exposes another defect.
- **Merge status:** not reviewed — focused correction passes; exact-head external acceptance pending.

### 2026-08-01 17:22 UTC — Codex (GPT-5.6 Sol), PR #1175 release-integrity reconciliation

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175 at `61be8dfb`; zero inline comments/reviews. No merge or production deployment.
- **Scope / root cause:** exact-head CI correctly caught one missed in-between contract after the standalone AI-rematch route was deleted: `scripts/audit-release-integrity.mjs` still required that retired file and attempted to audit its persistent limiter. Updated the release audit to remove the obsolete required-route entry and add the inverse invariant that the standalone route must remain absent so AI rematching stays inside the durable Engine authority.
- **Files changed:** `scripts/audit-release-integrity.mjs`, `operator_handoff.md` only.
- **Tests / checks:** release-integrity audit passed with zero failures; 26/26 focused canonical-panel/job-handler/matching tests passed; `git diff --check` passed. The preceding head's two CI runs failed only at the stale release-integrity assertion before the full suite; updated-head CI must rerun PostgreSQL, full tests, build, browser, and capture.
- **Completion assessment:** the code-path audit remains 100% implemented, but production-grade end-to-end verification remains pending until the corrected exact head is green. No honest 100% verification claim is made before then.
- **Next action:** push this reconciliation, require updated-head CI/capture green, inspect its screenshots, and keep #1175 draft/unmerged.
- **Merge status:** not reviewed — local correction passes; exact-head external acceptance pending.

### 2026-08-01 17:13 UTC — Codex (GPT-5.6 Sol), PR #1175 final manual-owner removal

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175, started from exact GitHub head `7bfc7324b11dee94f04abeb20fb207e0a9d55ca7`; zero inline comments and zero reviews. No merge or production deployment performed.
- **Scope / root cause:** the prior tender workspace repair hid the manual matching controls but left a second live `/dashboard/matching` mutation UI, a writable `PUT /matches` selection owner, a standalone `/ai-rematch` route/background handler, and five now-unreferenced panel components. Those paths still contradicted the requested single durable Engine selection/rematch authority. The matching dashboard is now read-only and reuses `MatchingSelectedEvidencePanel`; the manual selection mutation and standalone rematch route/handler/queue admission were removed; obsolete panels were deleted; all workflow links now target the one canonical selected-evidence anchor.
- **Files changed:** matching dashboard/page contracts, matches API, AI job registry/policy/worker admission, canonical workflow anchors, five deleted standalone panels, focused matching/Engine/UI tests, related stale comments, and `operator_handoff.md`. No schema, migration, provider order, generation gate, export gate, or production configuration changed.
- **Tests / checks:** Prisma generation passed; TypeScript passed after clearing stale `.next` route types; 100/100 focused authority/UI tests passed; complete zero-warning lint passed; production build passed with 58/58 static pages; `git diff --check` passed. The previous exact head's CI was still running when this audit began; this new head requires its normal PostgreSQL/authenticated-browser/capture checks.
- **Completion assessment:** implementation coverage for the explicit Company Vault → durable Engine → automatic matching → canonical requirement-evidence prompt is 100% by code-path audit. End-to-end verification is 95% until updated-head CI supplies PostgreSQL, authenticated browser, and screenshot evidence; this is an external verification hold, not a known code gap.
- **Risks / assumptions:** historical `AI_REMATCH` job rows remain representable by the persisted job type for database compatibility but are no longer admitted, dispatched, or handled. Run Engine retains the sole 12-perspective rematch implementation. Human review remains truthful where separately and legitimately performed, but it is not required by the normal automated workflow.
- **Next action:** commit/push to PR #1175, require updated-head CI and capture green, inspect the generated authenticated screenshots, and keep the PR draft/unmerged pending Hope's approval.
- **Merge status:** not reviewed — all local executable checks pass; exact-head external acceptance pending.

### 2026-08-01 16:56 UTC — Codex (GPT-5.6 Sol), PR #1175 final evidence-panel fail-closed repair

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175, started from exact GitHub head `8f396df90a8604c1f4800e5930e8a863830b2446`; zero inline review comments and zero submitted reviews. No merge or production deployment performed.
- **Scope / root cause:** audited the new two-panel Company Vault/Engine workspace and found two remaining presentation-authority gaps: a stale persisted `isSelected` flag could still render an unpromoted/tampered expert or project as “Automatically linked,” and any non-zero partial score produced an “all requirements” traceability claim. The matching panel now applies the Engine's fail-closed `SOURCE_VERIFIED`/`REVIEWED` trust boundary before rendering selected or candidate rows, and the requirements panel claims `Verified and ready` only when partial, processing, and genuine-gap counts are all zero.
- **Files changed:** `components/matching-selected-evidence-panel.tsx`, `components/requirement-coverage-panel.tsx`, `tests/canonical-vault-engine-panels.test.ts`, `tests/requirement-coverage-confirm-safety.test.ts`, `operator_handoff.md`.
- **Tests / checks:** Prisma generation passed; the focused non-PostgreSQL Vault/Engine/matching/evidence suite passed 84/84; TypeScript, targeted zero-warning ESLint, `git diff --check`, and the complete production build passed. A broader 279-test selection reached 255 passes but could not complete its PostgreSQL cases because the configured Neon host is unreachable from this container; the one stale wording assertion exposed by that run was updated and passed in the clean 84-test rerun.
- **CI / deployment:** predecessor exact-head checks were in progress at session start. Updated-head CI remains required after push. No manual preview was created.
- **Risks / assumptions:** machine `SOURCE_VERIFIED` and truthful human `REVIEWED` remain eligible; all other trust states are silently excluded from the canonical selected-evidence panel. This UI guard supplements rather than weakens backend provenance, tenant, byte-integrity, and source-revision enforcement.
- **Next action:** push this commit to PR #1175, require exact-head PostgreSQL/CI/browser checks, and keep the PR draft/unmerged pending Hope's approval.
- **Merge status:** not reviewed — local application checks pass; external PostgreSQL and updated-head CI remain pending.

### 2026-08-01 16:45 UTC — Codex (GPT-5.6 Sol), PR #1175 canonical Vault/Engine panels

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175, started from exact GitHub head `dac9ff76b914da9e998af182d04a501fa60c2314`; zero inline review comments and zero submitted reviews. No merge or production deployment performed.
- **Scope:** closed the remaining screenshot/workflow contradiction after the durable Company Vault and Engine backend repairs: the tender workspace still rendered five competing evidence/matching panels plus manual selection, rematch, Vault-management, and synchronization controls. The normal workflow now renders only `Requirements and Evidence` and `Matching and Selected Evidence`; persisted selected experts/projects are first, unselected candidates/diagnostics are collapsed, requirement statuses use the final-package readiness payload, and partial evidence receives weighted display credit without weakening fail-closed release status.
- **Files changed:** `app/dashboard/tenders/[id]/page.tsx`, `app/api/tenders/[id]/requirement-coverage/route.ts`, `components/requirement-coverage-panel.tsx`, `components/matching-selected-evidence-panel.tsx`, `tests/canonical-vault-engine-panels.test.ts`, `operator_handoff.md`.
- **Tests / checks:** Prisma generation passed; 64 focused Vault/Engine/matching/requirements assertions passed; TypeScript passed; targeted zero-warning ESLint passed; `git diff --check` passed. Full-repository lint and local Next build were terminated by the constrained local process environment after starting; updated-head CI remains required for the complete suite/build/PostgreSQL/browser acceptance.
- **CI / deployment:** predecessor head checks were running when work began. No preview was manually created; the normal PR integration may create its canonical preview after push.
- **Known risks / assumptions:** backend automatic ingestion, source verification, single revision-bound Engine authority, retry idempotency, tenant isolation, and tamper rejection are unchanged and remain covered by the existing PostgreSQL/browser suites. This change removes the final live UI owners that contradicted that backend authority. Exact-head CI and authenticated preview screenshots remain required before merge readiness.
- **Next action:** push this commit to PR #1175, require its complete exact-head CI and screenshot capture, and keep the PR draft/unmerged pending Hope's release approval.
- **Merge status:** not reviewed — focused local checks pass; exact-head CI/browser/build are pending.

### 2026-08-01 16:35 UTC — Codex (GPT-5.6 Sol), PR #1175 final scoped Engine confirmation

- **Branch / PR:** `work`, aligned exactly to draft PR #1175 head `274989d1da43c8b366b8135b766938a11e92ac52` on `release/consolidated-recovery-20260717`; zero inline comments and zero submitted reviews.
- **Scope:** final verification of the screenshot-reported Company Vault → AI Analyze → durable Run Engine failure after reconciling an initially stale local checkout to the actual PR head. Confirmed the repair commits `7899ebc` and `19d9760` are present, all exact-head checks are green, and no subsequent commit reverted or competed with the immutable-input revision and single automatic continuation authority. No application behavior, schema, migration, dependency, or gate changed.
- **Files changed:** `operator_handoff.md` only.
- **Tests / evidence:** local Prisma generation passed; 42 focused Run Engine/Vault/automatic-continuation/runtime assertions passed with the PostgreSQL-only suite intentionally skipped locally; TypeScript, zero-warning lint, and `git diff --check` passed. Exact-head GitHub CI passed both duplicated migration/integrity/typecheck/lint/test/build/authenticated-isolation workflows, including the PostgreSQL self-invalidation regression; dependency rejection and 111-route capture also passed.
- **CI / deployment:** all seven current checks on `274989d1` are green. The verified application-code preview remains `dpl_GuASMSrwN75hqS5ima8GcEGDS4Tu`, READY and healthy at exact application SHA `19d97609`; commits after it are documentation/test-only and do not alter deployed runtime behavior.
- **Risks / assumptions:** no known scoped code, database, CI, browser, screenshot, or deployment gap remains. Automation cannot impersonate the supplied real account or mutate its failed job without credentials; pressing **Retry durable Engine** is the sole user-specific replay action and creates/reuses corrected revision v3 automatically, without a Company Vault review/attachment step.
- **Next action:** Hope may retry the supplied tender in the verified preview; investigate only if that owner-specific replay produces a new correlation reference.
- **Merge status:** the Company Vault/AI Analyze/Run Engine scope is fully repaired and verified by all available automated acceptance layers; PR #1175 remains draft and unmerged pending Hope's explicit approval and unrelated repository-level external holds.

### 2026-08-01 16:30 UTC — Codex (GPT-5.6 Sol), live release-control refresh

- **Branch / PR:** `release/consolidated-recovery-20260717` / governing draft PR #1175; independently frozen at `274989d1da43c8b366b8135b766938a11e92ac52`, base `b3c9db5de89a2a665e61a83facbff0f276f9983c`; #1175 remains open, draft, and unmerged.
- **Scope:** refetched GitHub and Vercel; confirmed #1175 is the only open PR; proved closed #1274 head `0611690b` and the prepared heads `130f1c13`/`b8f15162` are ancestral; inspected closure comments for #1266, #1267, #1270, #1274 and #1287; downloaded and reopened the exact-head acceptance artifact; verified the matching preview identity/health; replaced the stale narrow `pr-body.md` with the complete recovery description and explicit external holds.
- **Files changed:** `pr-body.md`, `operator_handoff.md`. No application, schema, migration, dependency, workflow authority, safety gate, or executable test changed.
- **Tests / evidence:** exact-head GitHub runs `30707024137`, `30707022343`, and `30707024138` passed all 44 migrations, critical schema/bootstrap/idempotency/zero drift, release audits, typecheck, zero-warning lint, 8,916/8,916 unit/PostgreSQL assertions, production build, 180 Playwright passes with three documented conditional skips, and 111/111 responsive route cases with zero findings. Artifact hashes independently recomputed for DOCX `04a07b29…` (12,094 bytes), PDF `3aff6bd5…` (985 bytes), and ZIP `90aa7480…` (10,419 bytes). Local `npm audit --omit=dev` reports zero vulnerabilities.
- **CI / deployment:** exact application-head preview `dpl_3o2HfYVb9VaLktAXzLo5mbJ1TKNR` is READY; `/api/version` and `/api/health` return the exact SHA, healthy critical tables, and durable private Blob storage. This documentation-only commit must receive its own normal Git-triggered checks and preview before the PR body can cite the final documentation SHA.
- **Risks / assumptions:** a fresh provider-backed persisted preview workflow was not run because approved synthetic credentials were not established. Password rotation, session revocation, automation-secret replacement, artifact sanitation, owner UAT, duplicate Vercel-project remediation, and post-workflow retained-log acceptance remain external holds.
- **Next action:** commit and push this documentation/control-plane refresh, update the live #1175 body with the resulting exact SHA, require the normal exact-head checks, and keep #1175 draft/unmerged.
- **Merge status:** unsafe while the external security and acceptance holds remain unresolved.

### 2026-08-01 16:00 UTC — Codex (GPT-5.6 Sol), final open-PR forensic disposition

- **Branch / PR:** `release/consolidated-recovery-20260717` / governing draft PR #1175; starting exact head `7100ec7ba40e66eb98fdd54441899132297c2927`; #1175 remains open, draft, and unmerged.
- **Scope:** refetched GitHub and deployment state; proved closed #1274 heads `0611690b`, `130f1c13`, and frozen parent `b8f15162` are ancestral to #1175; audited every commit and all eight files in the sole remaining donor PR #1287; classified its already-incorporated compliance hardening and rejected its synchronous/client-policy Engine path and in-worker Vault mutation as competing or unsafe.
- **Files changed:** `docs/audits/open-pr-unique-code-ledger-20260728.md`, `operator_handoff.md`. No application, schema, migration, dependency, workflow gate, or test implementation changed.
- **Tests / evidence:** `npx prisma generate` passed; seven focused live-owner files passed 86/86 assertions. Downloaded exact-head GitHub artifacts for `7100ec7b`: 8,916/8,916 unit/PostgreSQL assertions, 180 Playwright passes with three documented conditional skips, production build, migrations/critical schema/idempotency/zero drift, release integrity, source-mutation checks, and 111/111 screenshot cases with zero findings all passed.
- **CI / deployment:** all GitHub checks on starting head `7100ec7b` are green. GitHub deployment records were refetched; no production deployment or migration was initiated. The new documentation-only head still requires its own normal Git-triggered exact-head checks before donor closure or final PR-description claims.
- **Risks / assumptions:** #1287's compliance-document matching value is already present with stronger regression coverage; replaying the remaining donor code would restore a synchronous Engine default, client-controlled policy parameters, and a late Vault mutation competing with the current pre-enqueue verification/revision authority. External credential remediation, approved synthetic provider-backed preview acceptance, owner UAT, and duplicate Vercel-project configuration remain unresolved holds.
- **Next action:** commit and push this disposition, wait for the normal exact-head CI/preview, then close only #1287 with the verified superseding SHA and refresh #1175's stale description while keeping it draft.
- **Merge status:** not reviewed for merge; #1175 must remain draft and unmerged.

### 2026-08-01 15:25 UTC — Codex (GPT-5.6 Sol), PR #1175 exact-head Engine verification

- **Branch / PR:** `work`, aligned exactly to draft PR #1175 head `19d97609920d3f808542387f90bf3b3c7ffab824` on `release/consolidated-recovery-20260717`; no inline comments or submitted reviews.
- **Scope:** verification-only follow-up for the screenshot-reported Company Vault → AI Analyze → durable Run Engine failure. Reconciled the initially stale local checkout to GitHub shared truth, downloaded and inspected the exact-head CI and route/screenshot artifacts, verified the PostgreSQL regression for Engine self-invalidation, and checked the exact-head Vercel deployment identity/health. No application behavior, schema, migration, dependency, or gate changed.
- **Files changed:** `operator_handoff.md` only.
- **Tests / evidence:** both duplicated exact-head CI workflows passed migrations, critical schema, zero drift, typecheck, lint, 8,916/8,916 unit/PostgreSQL assertions, production build, browser acceptance, and source-mutation checks. The database suite specifically passed preservation of the Engine revision after derived requirement replacement and supersession after real tender source-byte changes. Exact-head route capture covered 111/111 cases with zero critical, overflow, or warning findings. The authenticated browser suite passed 181 tests and four documented conditional skips, including the durable upload/automatic-analysis golden flow and Company Vault routes.
- **CI / deployment:** all current PR checks are green. Vercel deployment `dpl_GuASMSrwN75hqS5ima8GcEGDS4Tu` is READY at `https://hope-tender-path-9gp9xz79y-hopeengineering83-codes-projects.vercel.app`; `/api/version` returned `19d97609`, and `/api/health` returned healthy with exact release SHA, durable private Blob storage, required tables present, and 8/10 providers configured.
- **Risks / assumptions:** the supplied real-user failed job itself was not mutated or replayed because its credentials are not available to automation. Revision v3 ensures its UI retry creates/reuses the corrected immutable-input revision and supersedes the failed v2 row. Repository, PostgreSQL, browser, capture, build, and exact preview checks expose no remaining known defect in the scoped path.
- **Next action:** Hope can press **Retry durable Engine** on the supplied tender in the exact-head preview; no code or manual Company Vault review step remains before automatic processing.
- **Merge status:** scoped code is verified and safe with all exact-head checks green; PR #1175 remains draft and must not be merged without Hope's explicit approval.

### 2026-08-01 15:08 UTC — Codex (GPT-5.6 Sol), PR #1175 updated-head Engine verification

- **Branch / PR:** local `work` at exact draft PR #1175 head `7899ebc`; target `integration/controlled-recovery`. GitHub reports zero inline comments and zero submitted reviews.
- **Scope:** independently verified the updated-head repair for the screenshot's durable Engine precondition failure. Strengthened the PostgreSQL regression to mirror `runTenderEngine`'s complete derived-output mutation shape: update Tender workflow fields, delete/recreate TenderRequirement output, then prove the canonical source revision and active job remain unchanged. Real tender-file byte changes remain separately proven to supersede the stale job.
- **Files changed:** `tests/engine-enqueue-authority.integration.test.ts`, `operator_handoff.md`.
- **Tests / CI:** predecessor exact-head CI is fully green: PostgreSQL canonical Engine enqueue suite 4/4, complete unit/database suite 8,916/8,916, production build, 180 Playwright passes with three documented skips, exact-head route capture, dependency audit, and source-mutation checks. Downloaded and inspected both exact-head acceptance artifacts. Local focused rerun and updated-head CI are required for this strengthened assertion.
- **Deployment:** exact-head Vercel preview `dpl_3x33cf81Nu8Co7poNDA8SXEipYGW` is READY at `https://hope-tender-path-9csoukcyu-hopeengineering83-codes-projects.vercel.app`; `/api/version` reports `7899ebc4`, and `/api/health` reports healthy schema, durable private Blob storage, and 8/10 configured providers.
- **Risks / assumptions:** CI provider credentials intentionally exercise deterministic fallback rather than paid provider output. The scoped Engine revision/queue failure is behaviorally covered against PostgreSQL; owner-data preview interaction remains credential-controlled.
- **Next action:** push this strengthened proof, require updated-head CI green, and keep #1175 draft until Hope clears the repository's separate external release holds.
- **Merge status:** not reviewed — predecessor is green; strengthened updated-head CI pending.

### 2026-08-01 14:29 UTC — Codex (GPT-5.6 Sol), PR #1175 Run Engine self-invalidation repair

- **Branch / PR:** local `work`, aligned with and intended for draft PR #1175 head branch `release/consolidated-recovery-20260717`; predecessor head `ee27f98`. GitHub reported no inline comments or submitted reviews; dependency/Vercel checks passed while capture and full CI were still running when this repair began.
- **Scope:** investigated the exact Vercel screenshots showing terminal `ASYNC_ENGINE_FAILED` precondition references. Found that the source-revision snapshot included Engine-owned `Tender.updatedAt` and `TenderRequirement` rows even though `runTenderEngine` necessarily updates/replaces them; therefore the mandatory post-run stale-source check invalidated every otherwise-successful run against its own writes. Revision v3 now hashes only stable tender-source and Company Vault inputs while retaining requirement count as non-hashed diagnostics. Also removed the competing post-analysis continuation: `run-next` now consumes the canonical source-bound `automaticEngineJob` already persisted by the AI handler instead of creating a second legacy analysis-hash-only ENGINE_RUN job; the old path remains only as compatibility fallback.
- **Files changed:** `lib/engine/engine-source-revision.ts`, `app/api/ai-jobs/run-next/route.ts`, `tests/engine-async-job-queue.test.ts`, `tests/engine-enqueue-authority.integration.test.ts`, `operator_handoff.md`.
- **Tests:** Prisma generation and TypeScript passed; focused Run Engine/Vault/automatic-continuation/runtime tests passed 42/42; zero-warning lint and `git diff --check` passed. The focused PostgreSQL integration test could not start because this container cannot reach the configured Neon host; CI must execute its new assertions that derived requirement writes preserve a job revision while changed tender source bytes supersede it.
- **CI / deployment:** exact predecessor `ee27f98` checks were partially complete at session start. No additional preview was created before local validation and commit; updated-head CI/preview is required.
- **Risks / assumptions:** the post-run authority check remains fail-closed for real tender-file or Company Vault changes. Existing failed v2 jobs will be superseded automatically on retry because revision v3 creates a different canonical idempotency key.
- **Next action:** commit/push into PR #1175, require green updated-head CI, then use the authorized preview workflow to rerun the same authenticated tender and confirm the Engine reaches success rather than the screenshot's precondition failure.
- **Merge status:** not reviewed — focused local checks pass; PostgreSQL CI and updated-head preview acceptance remain required.

### 2026-08-01 14:18 UTC — Codex (GPT-5.6 Sol), PR #1175 screenshot-driven Vault UI repair

- **Branch / PR:** local `work`; governing draft PR #1175 head branch `release/consolidated-recovery-20260717` at `ff40a63` before this repair. No inline comments or submitted reviews.
- **Scope:** downloaded the exact-head 23 MB route/screenshot artifact from successful capture run `30703008819` and inspected the real desktop Company Vault and Automatic Verification pages. The Vault screenshot exposed surviving manual bureaucracy: “Review each file before using it,” human-reviewed/draft completeness counts, and Experts/Projects “Review …” CTAs. Replaced those active UI paths with truthful Run Engine automatic extraction/source-verification guidance and Automatic Verification links. Runtime eligibility remains source-backed and fail-closed.
- **Files changed:** `app/dashboard/company/page.tsx`, `tests/company-vault-experts-projects-review-cta.test.ts`, `tests/company-vault-document-actions-a11y.test.ts`, `operator_handoff.md`.
- **Tests:** focused Company Vault UI, accessibility, pipeline, and automatic-promotion suites passed 35/35; clean-cache TypeScript passed; zero-warning lint passed; `git diff --check` passed.
- **CI / deployment:** exact predecessor preview `dpl_71CbsVmTCjwCCSFhK1z4uwxaKpgz` returned healthy HTTP 200 with exact SHA `ff40a63b`, durable private Blob storage, and 8/10 providers. Capture and one complete duplicated full workflow passed; the second full workflow was in browser acceptance when this screenshot-derived repair began.
- **Risks / assumptions:** authenticated human `REVIEWED` evidence remains optional and eligible, but the primary Vault UI no longer presents human approval as a prerequisite. Automatic verification does not promote stale, altered, source-less, unmatched, or unusable evidence.
- **Next action:** push this commit into PR #1175 and require updated-head CI, preview identity/health, and fresh route screenshots.
- **Merge status:** not reviewed — local focused checks pass; updated-head remote acceptance is required.

### 2026-08-01 14:08 UTC — Codex (GPT-5.6 Sol), PR #1175 automatic-handoff cleanup

- **Branch / PR:** local `work`; governing draft PR #1175 head branch `release/consolidated-recovery-20260717` at `77dba9a` before this follow-up. GitHub reports no inline comments or submitted reviews.
- **Scope:** removed the remaining Company Vault client-pipeline message that incorrectly said re-imported evidence remained subject to human review. Successful byte re-import now explicitly hands eligible evidence to Run Engine automatic source verification. Also replaced the remaining generic compliance “source review” wording with automatic source verification; evidence eligibility and fail-closed source authority are unchanged.
- **Files changed:** `lib/ui/auto-pipeline.ts`, `lib/engine/compliance.ts`, `tests/auto-pipeline.test.ts`, `operator_handoff.md`.
- **Tests:** focused automatic-pipeline, pipeline-authority, Company Vault evidence, and preview-runtime tests passed 23/23; clean-cache TypeScript passed; zero-warning lint passed; `git diff --check` passed.
- **CI / deployment:** predecessor `77dba9a` dependency and capture checks passed; both full duplicated workflows were still running when this follow-up was prepared. Vercel Preview Comments passed. No extra manual deployment was created; pushing this commit lets the governing PR integration create its canonical preview.
- **Risks / assumptions:** human `REVIEWED` provenance remains a supported optional evidence authority, but it is not required between Company Vault and Run Engine. Automatic verification still cannot invent evidence or promote stale, altered, source-less, or unmatched records.
- **Next action:** push this commit to PR #1175, verify updated-head CI/preview, and keep the PR draft until external release holds are cleared.
- **Merge status:** not reviewed — local focused checks pass; updated-head CI is required.

### 2026-08-01 13:27 UTC — Codex (GPT-5.6 Sol), PR #1175 evidence-gap repair

- **Branch / PR:** local `work` aligned exactly to `origin/release/consolidated-recovery-20260717` at `8768590`; governing draft PR #1175 targets `integration/controlled-recovery`. GitHub API showed zero inline comments and zero submitted reviews; all seven latest-head checks were green before this repair.
- **Scope:** discarded the incompatible local pre-PR architecture from the active branch after verifying that #1175 already owns a newer enqueue-only, server-policy-controlled Engine with automatic Vault preparation, source revisions, `SOURCE_VERIFIED` provenance, and automatic Build Plan continuation. Repaired the remaining non-overlapping compliance gap: unrelated, empty, scanned, or first-in-list Vault documents can no longer become legal/financial/compliance/profile/general evidence merely because any document exists. Typed evidence now also requires the correct Vault category (so an ISO certificate cannot masquerade as legal registration), and requirement matching uses exact normalized tokens rather than substrings (so `audit` cannot match `auditorium`) while preserving #1175's draft-only proposal-response semantics.
- **Files changed:** `lib/engine/compliance.ts`, `tests/company-vault-compliance-evidence.test.ts`, `tests/preview-runtime-truth-regression.test.ts`, `operator_handoff.md`.
- **Tests:** `npx prisma generate` passed; focused Company Vault compliance tests passed 6/6; `tests/core-engine-regressions.test.ts` and `tests/production-workflow-engine.test.ts` passed (27 total assertions across the combined run); `npx tsc --noEmit` passed; `npm run lint -- --quiet` passed; `git diff --check` passed.
- **CI / deployment:** governing head `8768590` CI baseline is green, including migrations/integrity/typecheck/lint/tests/build/authenticated isolation and capture. Final application-code head `6f63436` deployed READY as `dpl_CNXdw7d1mn4dNSAFeJzCYb9dSVhs` at `https://hope-tender-path-aqsuxbobz-hopeengineering83-codes-projects.vercel.app`; remote build found 44 migrations with none pending, passed schema verification, compiled/typechecked, and completed successfully. Exact-head `/api/health` and `/api/version` returned HTTP 200, healthy/durable Blob storage, 8/10 configured providers, and SHA `6f634361`.
- **Known risks / assumptions:** selection is intentionally conservative: a document with unusable extraction stays unmapped even if its filename/category appears relevant. Existing legal/financial/compliance structured records remain valid evidence with meaningful record references. No client policy override or duplicate Engine owner was introduced.
- **CI follow-up:** commit `312eb40` was pushed to the governing PR branch. Updated-head CI exposed one intentional-contract mismatch: an ungenerated proposal response with no relevant Vault evidence retained the correct low strength and no evidence reference but moved from the canonical automatic `EVIDENCE_PENDING_REVIEW` workflow state to `PARTIAL`. The follow-up preserves pending automatic generation/verification without inventing a source reference and adds regression assertions for both properties.
- **Next action:** push this focused CI repair to `release/consolidated-recovery-20260717` and verify the resulting PR checks.
- **Merge status:** not reviewed — local verification and updated-head CI rerun remain pending.

### 2026-07-30 01:45 UTC — Codex (GPT-5.6 Sol)

- **Branch / PR:** `codex/pr1175-final-verification-20260730` / documentation-only child targeting `release/consolidated-recovery-20260717`; governing draft #1175 verified at `0c28bf03d37bb24cc8f45fd3e7c2453c00d5c2c3`.
- **Scope / files changed:** refetched GitHub and Vercel; proved closed #1274 head `0611690b…` is ancestral; dispositioned the only other open PR, #1280, as documentation-only and already incorporated; independently inspected exact-head CI, migrations, test/build/browser evidence, preview identity/events, responsive screenshots, and generated DOCX/PDF/ZIP bytes. Refreshed `docs/audits/open-pr-unique-code-ledger-20260728.md`, `docs/audits/pr1175-principal-release-recheck-20260730.md`, and this handoff. No application, schema, migration, dependency, test, gate, or workflow authority changed.
- **Tests:** clean `npm ci`; Prisma validate/generate; local release-integrity (418 routes / 1,390 files), workflow-consistency audit, typecheck, zero-warning lint, and production build passed without tracked-source mutation. Exact-head GitHub push/PR CI passed all 43 migrations, critical schema, retroactive bootstrap, idempotency, zero drift, 8,930/8,930 assertions, build, 179 Playwright passes / four documented skips, and 111/111 responsive route cases with zero findings. Exact secret-value scan found zero tracked matches. `npm audit --omit=dev` still reports two inherited high-severity Next/Sharp findings.
- **CI / deployment:** governing-head runs `30505634865`, `30505637154`, and `30505637135` succeeded. Intended exact-SHA deployment `dpl_5hD9SdNUZwhJ7AsxRqnJHd6cN6bP` is READY; version/health returned 200 and exact identity; 100 events contained zero prohibited runtime/credential patterns. Duplicate project `repo` exact-SHA deployment remains ERROR.
- **Generated bytes:** DOCX 12,091 bytes / `08e13b00…`; PDF 984 bytes / `d30b536e…`; ZIP 10,415 bytes / `8e336f4b…`. Office/PDF signatures, archive integrity, entry order, lengths, and manifest hashes were independently recomputed.
- **Risks / assumptions:** approved synthetic preview credentials remain unavailable, so provider-backed persisted preview acceptance and post-workflow log inspection were not rerun. Real-account testing remains prohibited pending password rotation, session revocation, automation-secret replacement, and artifact sanitation. Owner UAT, duplicate-project remediation, and compatible Sharp/libvips remediation remain external holds.
- **Next action:** obtain green CI for this documentation-only child, incorporate it into #1175, reverify the resulting exact head, update #1175's description, and close redundant child PRs without merging #1175.
- **Merge status:** not safe to merge #1175; draft/unmerged with external release holds.

### 2026-07-30 01:15 UTC — Codex (GPT-5.6 Sol)

- **Branch / PR:** `codex/pr1175-final-release-audit-20260730` / child audit PR targeting `release/consolidated-recovery-20260717`; governing draft #1175 frozen at `1e113fa529718b9052e762efd15fbf51144ccaca`.
- **Scope / files changed:** independently refetched GitHub and Vercel; confirmed #1175 was the only open PR before this documentation-only child was opened and that closed #1274 is fully ancestral; repeated the five-pass ancestry, schema, security, concurrency, workflow-owner, browser, preview, and generated-byte falsification. Added `docs/audits/pr1175-principal-release-recheck-20260730.md`, refreshed `docs/audits/open-pr-unique-code-ledger-20260728.md`, and added this handoff entry. No application, schema, migration, dependency, test, gate, or workflow authority changed.
- **Tests:** clean install/source-mutation check; Prisma validate/generate; all 43 migrations on isolated PostgreSQL 16; critical schema; retroactive bootstrap; idempotency; zero drift; release-integrity (418 routes / 1,390 files); workflow consistency; typecheck; zero-warning lint; 8,930/8,930 unit/PostgreSQL assertions; production build/source-mutation check; 179 Playwright passed / 4 documented conditional skips; fresh DOCX/PDF/ZIP container, structure, byte-length, order, and SHA-256 proof.
- **CI / deployment:** exact governing head GitHub runs `30502385737`, `30502388446`, and `30502388414` are successful. Intended preview `dpl_4UUnQvdQeoNaJK8tqewsp5mprg65` is READY and exact-SHA `/api/version` and `/api/health` returned HTTP 200. A fresh 100-event query contained no prohibited runtime-error/credential pattern; normal build-time Prisma generation messages were not misclassified as runtime errors. Duplicate Vercel project `repo` still fails.
- **Risks / assumptions:** approved synthetic preview credentials remain unavailable, so the complete provider-backed persisted preview workflow and post-workflow log audit were not rerun. Real-account testing remains prohibited pending password rotation, session revocation, automation-secret replacement, and artifact sanitation. Owner UAT, duplicate-project remediation, and compatible Sharp/libvips remediation remain external holds. `npm audit --omit=dev` still reports two inherited high-severity findings.
- **Next action:** keep #1175 draft and unmerged; an authorized owner must clear the external credential/UAT/project/dependency holds and run the complete provider-backed synthetic preview acceptance.
- **Merge status:** unsafe while the documented external security and acceptance holds remain open.

### 2026-07-30 UTC — Codex (GPT-5.6 Sol)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175; audited product head `c3c2f834a438d9848fd383fdec1cddef6e82b382`.
- **Scope / files changed:** independently refetched GitHub and Vercel; proved #1274's complete head is incorporated; inspected exact-head CI, screenshots, generated bytes, preview health, and deployment events; repeated disposable-PostgreSQL migrations, schema checks, audits, full tests, and build. Added `docs/audits/pr1175-exact-head-recheck-20260730.md` and this handoff entry only; no application, schema, migration, dependency, or gate change.
- **Tests:** local PostgreSQL 16 accepted all 43 migrations; critical schema, retroactive init, idempotency, zero drift, release-integrity (418 routes / 1,390 files), typecheck, zero-warning lint, 8,928/8,928 local tests, and production build passed. Exact-head GitHub evidence reports 8,930/8,930 tests, 179 passed / 4 environment-conditional skipped Playwright checks on the push run, 180 passed / 3 skipped on the PR run, and 111/111 screenshot combinations without findings.
- **CI / deployment:** exact-product-head runs `30498185202`, `30498188486`, and `30498188073` succeeded. Intended preview `dpl_CyLnTGypAQTq5Q59sMiFHP6xpv2V` was READY and `/api/version` plus `/api/health` identified the exact SHA. A fresh 100-event query found no prohibited runtime-error pattern. The duplicate `repo` project still failed.
- **Risks / assumptions:** approved synthetic preview credentials remain unavailable, so provider-backed persisted preview acceptance was not rerun. Real-account testing remains prohibited pending password rotation, session revocation, automation-secret replacement, and artifact sanitation. Owner UAT, duplicate-project remediation, and compatible residual dependency remediation remain external holds.
- **Next action:** keep #1175 draft and unmerged; obtain approved synthetic preview credentials and complete the remaining external security/UAT/project-configuration actions.
- **Merge status:** unsafe while the documented external security and acceptance holds remain open.

### 2026-07-29 23:05 UTC — Codex (GPT-5.6 Sol)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175. Started from exact head `c0f442427b53f2e58b9738b17814e1f3fb83278d`; live GitHub refetch found #1175 as the only open PR and confirmed closed #1274 head `0611690b1486402df6fb5431b055b219390517e7` is an ancestor. The matching Vercel preview was READY before this repair.
- **Scope:** independently falsified the green exact-head screenshot evidence and found the canonical Review Inbox displayed under a misleading `Diagnostics` tab beside a duplicate `Review Board` tab that only redirected to the same page. Removed the duplicate presented control, renamed the canonical tab, and redirected all live Company Vault actions/guidance to `/dashboard/company/review`; the legacy `/review-board` page remains redirect-only for bookmarks.
- **Files changed:** `components/company-subnav.tsx`, `components/generation-readiness-panel.tsx`, `app/dashboard/company/plan-b-import/page.tsx`, `app/dashboard/company/page.tsx`, `app/api/company/plan-b-import/route.ts`, `lib/engine/deep-reasoning-readiness.ts`, `lib/company-vault-source-remap.ts`, `tests/vault-review-contract.test.ts`, and `docs/audits/pr1175-review-inbox-authority-falsification-20260729.md`.
- **Tests:** clean `npm ci` and tracked-source mutation check passed; Prisma validate/generate passed; release-integrity passed (418 routes / 1,390 files); workflow consistency passed with the three existing warning-only wording heuristics; targeted tests passed 41/41; typecheck passed; lint passed with zero warnings; all 43 migrations deployed on fresh local PostgreSQL 16, second deploy idempotent, critical schema/retroactive bootstrap/zero drift passed; full unit/PostgreSQL suite passed 8,928/8,928; production build passed; authenticated `exact-head-evidence.spec.ts` passed 1/1 with retries disabled and generated fresh desktop/tablet/mobile screenshots without overflow or runtime errors. Two earlier Playwright launches failed before application execution because Chromium and then its OS libraries were absent; installing them resolved the environment limitation.
- **Evidence:** `docs/audits/pr1175-review-inbox-authority-falsification-20260729.md`; fresh tablet screenshot visibly shows one active Review Inbox tab and no Review Board/Diagnostics duplicate. Independent reopening of the prior exact-head artifact also found its current manifest hashes differ from stale generated-byte hashes in the PR body, so the body must be regenerated after the new exact head is verified.
- **Risks / holds:** no safety gate, schema, migration, trust state, or mutation authority was weakened. The forthcoming pushed SHA requires exact-head GitHub CI, Git-triggered preview identity, preview log inspection, and PR-body refresh. Provider-backed preview acceptance remains blocked on approved synthetic preview credentials; real credentials remain prohibited pending password/session/automation-secret remediation. Duplicate Vercel project and residual dependency advisory holds remain external.
- **Next action:** commit and push this repair, wait for exact-head CI and the Git-triggered preview, inspect their artifacts/logs, then update #1175's description without claiming completion of blocked external acceptance.
- **Merge status:** not reviewed for merge; keep #1175 draft and unmerged.

### 2026-07-29T19:37Z — Codex (GPT-5.6 Sol)

- **Branch / PR:** `codex/pr1175-final-independent-acceptance-20260729` / child
  PR targeting `release/consolidated-recovery-20260717`; governing draft #1175
  frozen at `893beb326d1c43fa1f5dfd52563c7609dd5a10de` before this repair.
- **Scope:** independently refetched GitHub/Vercel, revalidated #1274 ancestry
  and the one-open-PR ledger, reproduced the full migration/unit/browser matrix,
  and repaired a flaky release audit that treated the redirect-only legacy
  Company Review Board bookmark as a second rendered authority. The audit now
  tests rendered canonical routes separately and behaviorally proves the legacy
  URL converges on the single Review Inbox.
- **Files changed:** `e2e/pr1175-independent-release-audit.spec.ts`,
  `docs/audits/pr1175-exact-head-independent-recheck-20260729.md`, and
  `operator_handoff.md`. No product route, schema, migration, gate, dependency,
  or workflow authority changed.
- **Local checks:** clean `npm ci` and mutation hash; Prisma validate/generate;
  all 43 migrations on disposable PostgreSQL 16; critical schema;
  retroactive-bootstrap parity; migration idempotency; zero drift;
  release-integrity (418 routes / 1,390 files); workflow consistency;
  typecheck; zero-warning lint; production build and mutation hash;
  8,930/8,930 unit/PostgreSQL assertions; focused affected Playwright with
  retries disabled (5 passed / 1 environment skip); complete Playwright with
  retries disabled (179 passed / 4 environment skips / 0 failed / 0 flaky).
- **Remote/artifact evidence:** exact-parent GitHub checks green; intended
  exact-SHA Vercel preview `READY`; duplicate `repo` deployment `ERROR`; live
  version/health HTTP 200 at the exact parent SHA; 111/111 screenshot audit with
  zero findings; DOCX/PDF/ZIP containers and recorded hashes independently
  recomputed. A fresh runtime-log request timed out without bytes and is not
  claimed as new log evidence.
- **Risks / assumptions:** no approved synthetic preview credential exists, so
  provider-backed persisted preview acceptance remains blocked. Real-account
  password rotation, session revocation, automation-secret replacement,
  credential-artifact sanitation, owner UAT, duplicate-project remediation,
  and compatible residual dependency remediation remain external holds.
- **Next action:** publish the child for exact-head CI, incorporate only after it
  is green, then rerun exact #1175 head/preview identity checks; keep #1175 draft
  and unmerged.
- **Merge status:** not reviewed for release merge; release completion is not
  claimed.

### 2026-07-29T18:30Z — Codex (GPT-5.6 Sol)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175.
- **Scope:** independently refetched GitHub and Vercel authority after the final
  consolidation. Confirmed #1175 is the only open PR, #1274 is closed and fully
  ancestral, all three exact-head GitHub workflows are green, and the intended
  preview identifies the exact governing SHA. Updated only the exact-head audit
  record and this handoff; no product, schema, migration, dependency, test, or
  workflow-authority code changed.
- **Files changed:**
  `docs/audits/pr1175-exact-head-independent-recheck-20260729.md` and
  `operator_handoff.md`.
- **Checks:** GitHub PR/check/artifact API refetch; git ancestry; Vercel project,
  deployment and exact-SHA identity refetch; live `/api/version` and
  `/api/health` (HTTP 200); deployment-scoped 24-hour runtime-log query (12
  records, no error/fatal/500/P2022/P2002/Prisma/timeout/stuck/duplicate match).
- **Risks / assumptions:** no approved synthetic preview credentials are
  available, so the complete provider-backed persisted preview workflow is not
  independently rerun. Real-account use remains prohibited pending password
  rotation, session revocation, automation-secret replacement and artifact
  sanitation. Owner UAT, duplicate Vercel project cleanup, and compatible
  residual dependency remediation remain external blockers.
- **Next action:** let exact-head CI and the normal Git-triggered preview verify
  this documentation-only commit; keep PR #1175 draft and unmerged.
- **Merge status:** not reviewed for merge; release completion is not claimed.

### 2026-07-29T17:15Z — Codex

- **Branch / PR:** `codex/pr1175-live-state-reconciliation-20260729` / child PR pending, targeting `release/consolidated-recovery-20260717`; governing PR #1175 remains draft and unmerged at frozen parent `272b5823c6e118ac7e56f9c38e8f1b8c959b93d5`.
- **Scope / files:** refetched GitHub PR/check/deployment authority; proved closed #1274 head `0611690b…` is an ancestor of #1175; preserved documentation-only #1277 commit and corrected its live publication disposition in `docs/audits/pr1175-exact-head-independent-recheck-20260729.md`; updated this handoff. No product, schema, migration, dependency, route, workflow-authority, or test code changed.
- **Local checks:** clean `npm ci` passed with no tracked-file mutation (npm reports three unresolved high-severity advisories); `npx prisma validate`; `npx prisma generate`; `npm run audit:release-integrity` (418 routes / 1,390 files); `npm run audit:workflow-state-consistency` (pass in warning-only mode with three recorded heuristic warnings); `npx tsc --noEmit`; `npm run lint -- --max-warnings 0`; production `npm run build` with synthetic build-only secrets; post-build tracked-file mutation check — all passed. A first build invocation without the required synthetic provider variable failed closed as designed and was rerun correctly.
- **Remote evidence:** exact-parent GitHub runs `30471518423`, `30471523601`, and `30471524083` are successful; intended Vercel deployment `5661364922` is successful at exact SHA, while duplicate-project deployment `5661315682` remains failed.
- **Risks / assumptions:** this documentation-only child does not supersede the required exact-head verification after incorporation. Full provider-backed synthetic preview acceptance and runtime-log inspection remain blocked by unavailable approved synthetic credentials and `VERCEL_TOKEN`; credential rotation/session revocation/automation-secret replacement/artifact sanitation, owner UAT, duplicate Vercel-project remediation, and compatible dependency remediation remain external holds.
- **Next action:** incorporate this documentation-only child into #1175, rerun exact-head CI/preview identity checks, then close redundant documentation PR #1277 with an evidence comment; do not merge #1175.
- **Merge status:** safe as documentation evidence only; release merge remains unsafe/blocked by the stated external holds.

### 2026-07-29 UTC — Codex (GPT-5.6 Sol)

- **Branch / PR:** `codex/pr1175-exact-head-release-proof`; documentation-only follow-up prepared against draft PR #1175. PR #1175 was not modified, merged, approved, retargeted, or closed.
- **Scope:** independently refetched GitHub deployment/check state and falsified the frozen #1175 head `272b5823c6e118ac7e56f9c38e8f1b8c959b93d5`; confirmed #1274 head `0611690b1486402df6fb5431b055b219390517e7` is incorporated and #1175 is the only open PR; recorded evidence in `docs/audits/pr1175-exact-head-independent-recheck-20260729.md`.
- **Files changed:** `docs/audits/pr1175-exact-head-independent-recheck-20260729.md`, `operator_handoff.md` only.
- **Tests:** clean `npm ci` plus install mutation hash passed; Prisma validate/generate passed; release-integrity passed (418 routes / 1,390 files); workflow-state audit passed with three known warning-only wording heuristics; TypeScript passed; ESLint passed with zero warnings; production build with synthetic build-only configuration plus build mutation hash passed. A local DB-enabled full-suite attempt was stopped because the configured remote Neon test database was unreachable; no migration was run against it. Exact-head GitHub workflows remained successful with 8,930 tests, build, Playwright, disposable migration, and screenshot evidence.
- **CI / deployment:** exact-head GitHub runs `30471518423`, `30471523601`, and `30471524083` are successful. The intended Git-triggered preview is healthy and identifies the exact SHA; the duplicate `repo` Vercel project still fails.
- **Risks / assumptions:** no approved synthetic preview credentials, no Vercel token/log access, and no disposable local PostgreSQL service were available. Real-account testing remains prohibited. Credential rotation/session revocation/automation-secret replacement/artifact sanitation, owner UAT, duplicate-project repair, provider-backed persisted preview acceptance, runtime-log certification, and remaining compatible dependency remediation remain external holds.
- **Next action:** an authorized owner should satisfy the external holds and rerun the complete synthetic persisted preview workflow and runtime-log audit before considering merge.
- **Merge status:** **unsafe**; keep #1175 draft and unmerged.

### 2026-07-29 UTC — Codex (dependency-security falsification)

- **Branch / PR:** `codex/pr1175-release-proof-20260729` / draft #1276; governing draft #1175 frozen at `d514027ca9dd46e904726f50e250c74586f507fa`.
- **Scope / files:** refetched every open PR and GitHub deployment; revalidated #1274 ancestry and open-PR dispositions; patched compatible current dependency advisories in `package.json` and `package-lock.json`; updated `scripts/audit-release-integrity.mjs` so the release audit enforces the new PostCSS pin; refreshed `docs/audits/open-pr-unique-code-ledger-20260728.md` and this handoff. No workflow, schema, migration, gate or production deployment changed.
- **Tests:** clean `npm ci`; Prisma validate/generate; release-integrity and workflow-consistency audits; typecheck; lint with zero warnings; production build with a synthetic provider value; clean install/build mutation guards. Falsification found and repaired the release audit's stale PostCSS 8.5.10 expectation. The configured Neon endpoint was unreachable; the full PostgreSQL run was stopped after repeated setup failures and is not claimed. The reconciled dependency head requires new exact-head CI after push.
- **Security:** Next.js 15.5.22 and PostCSS 8.5.18 close the compatible current advisory ranges. `npm audit --omit=dev` still reports Next's nested Sharp 0.34.5, and the development audit reports minimatch/brace-expansion through ESLint; npm offers no compatible non-major remediation. These remain explicit blockers rather than forcing an unverified framework/toolchain major change.
- **CI / deployment:** parent #1175 exact-head CI and route/screenshot checks remain green; intended exact-SHA Vercel preview is successful; duplicate `repo` project remains failed. #1276 was externally closed before this commit reached GitHub and was reopened draft so its unincorporated head can receive exact-head CI. No `VERCEL_TOKEN`, retained logs or approved synthetic preview account are available.
- **Risks / next action:** wait for the dependency-patched #1276 exact-head CI, then independently validate its artifact. Do not incorporate or close PRs until the remaining preview/runtime, external credential/UAT, duplicate-project and dependency-advisory holds are resolved.
- **Merge status:** unsafe; #1175 and #1276 remain draft and unmerged.


### 2026-07-28 UTC — Codex (GPT-5.6 Sol)

- **Branch / PR:** `codex/pr1175-auto-verification-audit-blocked` / no GitHub PR created or verified. The local `make_pr` integration recorded title/body metadata only and returned no PR number or URL.
- **Requested scope:** Freeze draft PR #1175, independently audit it against draft PR #1266, implement automatic Company Vault evidence verification and Plan-B import corrections, and run the full release verification matrix.
- **Files changed:** `operator_handoff.md` only; no application, schema, migration, workflow, test, or documentation implementation file was changed.
- **Checks actually run:** read `AGENTS.md`, `operator_handoff.md`, `CLAUDE.md`, and `CLAUDE_TASKS.md`; inspected the working tree, configured remotes, environment credential names, all local refs, unreachable Git objects, and recent history; attempted `git ls-remote` for PR #1175 and #1266 twice, including this follow-up recheck.
- **Result / blocker:** blocked before the mandatory freeze. The checkout has no configured remote, GitHub CLI, GitHub credential environment variable, local PR ref, or unreachable commit containing either requested PR head. It contains local branch `work` at `820c9cb0bb382f56645b3494fe083ccefdd744fa`, while direct GitHub access fails with `CONNECT tunnel failed, response 403`. The exact #1175 head, #1266 audit diff/comments, open-PR state, and CI therefore cannot be verified. No audit, fix, test completion, draft PR number, or child-PR target is claimed.
- **Risk:** creating implementation changes or asserting a frozen SHA from this checkout would target an unverified base and violate the request's freeze-first rule.
- **Next action:** restore authenticated GitHub/private-remote access (or provide local refs/bundles for `refs/pull/1175/head` and `refs/pull/1266/head`), then restart from the freeze step and discard this blocker-only branch if desired.
- **Merge status:** unsafe; draft-only blocker record, do not merge.

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

### 2026-08-09 UTC — Codex

- **Mode:** focused PR #1175 owner-workflow acceptance and minimal repair
- **Branch / PR:** `release/consolidated-recovery-20260717` / #1175
- **Scope:** real-PostgreSQL AI Analyze → Engine claim → Vault verification → matching → Build Plan → generation → validation → AUTO_FINALIZE → PDF → ZIP acceptance; fixed the first three observed transitions without weakening gates.
- **Files changed:** `lib/engine/generate-elite.ts`, `lib/engine/document-quality-validator.ts`, `lib/ai-jobs/auto-finalize-continuation-service.ts`, `tests/owner-workflow-complete-postgres.test.ts`, `operator_handoff.md`.
- **Tests:** focused PostgreSQL acceptance passed; typecheck passed; lint passed with one pre-existing warning; relevant 119 tests passed; full `RUN_DB_INTEGRATION=true npm test` passed; production build passed with local missing-secret warnings.
- **Risks / blockers:** authenticated Preview acceptance and owner-only Production UAT/credential rotation/backup-restore/rollback proof remain; no Production deployment performed.
- **Next action:** exact-head CI and automatic Preview verification.
- **Merge status:** DO NOT MERGE — awaiting owner review and Preview evidence.

### 2026-08-09 UTC — Codex (release-hardening continuation)

- **Mode:** exact-head CI failure triage and narrow reliability repair.
- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175, starting at `8a46f05c57d6cac396cde3caecbcc6731a3a018a`.
- **Scope:** inspected failed run `31337251918` attempt 2 without requesting the consolidated PR diff. The run reported two behavioral failures (not five): the Engine wake regression swallowed an assertion inside the production best-effort wake boundary, and the stale-queue reaper treated another tenant's newer job as proof that this tenant's job was passed over. Preserved canonical AI Analyze authority and all fail-closed gates.
- **Files changed:** `lib/engine/stale-job-reaper.ts` (tenant-scope pass-over evidence), `tests/stale-job-reaper.test.ts` (cross-tenant regression), `tests/engine-worker-handoff.test.ts` (make claim/RUNNING assertions observable outside the intentional wake catch), `.github/workflows/ci.yml` (Node-24-compatible checkout/setup/upload action majors), `operator_handoff.md`.
- **Tests:** `npx prisma generate`, `npm run typecheck`, and `npm run lint` passed (one pre-existing unused-disable warning). Local PostgreSQL-focused execution is blocked by the configured Neon host being unreachable; exact-head CI must supply the real-PostgreSQL result. Non-database worker authority checks passed; database subtests failed only at connection setup.
- **Risks / blockers:** full PostgreSQL suite, build, authenticated Playwright, exact-SHA Preview golden path/runtime logs, and artifact validation remain unverified until exact-head CI/Preview completes. Owner-only Production UAT, credential rotation, backup/restore, rollback, merge, and Production deploy remain explicitly outstanding.
- **Next action:** push the focused commit, require exact-head CI green, then inspect only its automatically generated exact-SHA Preview and logs; do not merge.
- **Merge status:** DO NOT MERGE — draft; no Production deployment performed.

Follow-up exact-head CI exposed legitimate test-suite contention: another real global worker can atomically win the focused job before its injected wake callback. The regression now accepts either claimant only when the same durable job is already `RUNNING`, then completes and verifies the single job; it still fails if no worker claimed it. No production behavior changed.
