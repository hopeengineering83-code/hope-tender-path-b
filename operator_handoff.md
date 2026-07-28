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
| Codex | `audit/pr1175-complete-five-pass-forensic-audit` / draft PR #1271, auditing `release/consolidated-recovery-20260717` / PR #1175 | Five-pass current-head forensic audit of PR #1175 | source/review authority, signature approval, upload/extraction queue, generation/export truth, audit ledgers | Active; F017 published; stale synchronous-extraction Playwright expectations fixed locally | Publish F021 after frozen-head recheck, inspect replacement exact CI/artifact, then continue Build Plan/action reconciliation |

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

### 2026-07-28T17:31:00Z — Codex

- **Mode:** five-pass forensic audit checkpoint — exact-CI authenticated upload acceptance.
- **Branch / PR:** `audit/pr1175-complete-five-pass-forensic-audit` / draft PR #1271; governing PR #1175 remains frozen, draft and unmerged.
- **Root cause and fix:** exact CI run `30381329357` passed migrations/schema/drift/release integrity/typecheck/lint/unit+database tests/build and 176 browser assertions, but three upload tests still expected text extraction and `AI_ANALYZE` directly in the upload response. That contradicted the intended durable extraction fix. Added one authenticated acceptance helper that wakes the user-scoped `EXTRACT_TEXT` worker and polls persisted source-file state; updated all three flows to expect `WAIT_FOR_SOURCE_EXTRACTION` / `EXTRACT_TEXT_QUEUED`; the golden flow also verifies the completed extraction job queued canonical analysis.
- **Tests:** exact-CI failing-before is 3 stale Playwright failures (176 passed / 3 skipped); focused durable extraction/queue suite passes 35/35 locally; TypeScript, ESLint and release-integrity are clean.
- **CI / deployment:** replacement exact-head CI is pending. No preview, deployment, production/database mutation or real-account test was triggered.
- **Next action:** recheck PR #1175, publish, inspect replacement CI and its exact-head artifact, then continue F018 Build Plan/PDF reconciliation.
- **Merge status:** **UNSAFE — DO NOT MERGE OR DEPLOY.**

### 2026-07-28T17:22:05Z — Codex

- **Mode:** five-pass forensic audit checkpoint — one effective requirement-coverage authority.
- **Branch / PR:** `audit/pr1175-complete-five-pass-forensic-audit` / draft PR #1271; governing PR #1175 remains frozen, draft and unmerged.
- **Root cause and fix:** manual FULL/SUBSTANTIAL could be stored without active source-file/page/exact-quote containment, a competing fallback route could write the same state, three panels interpreted rows independently, the heatmap multiplied requirements by compliance rows, and the release snapshot/lifecycle still counted raw strong rows. Strong manual confirmation now fails closed without contained source evidence; the duplicate mutator is removed; `mapRequirementsToEvidence` emits the effective `FULLY_MET`/`PARTIALLY_MET`/`NEEDS_TRACE`/`NOT_MET` status consumed by the API, all three panels, release snapshot and lifecycle controls; heatmap cardinality is one row per requirement.
- **Tests:** new contract failed 4/4 before implementation and passes 5/5 after; 112/112 focused lifecycle/release/workflow assertions and 219/219 broader related assertions pass; TypeScript, ESLint and release-integrity are clean.
- **CI / deployment:** no database mutation, preview, deployment or real-account test was triggered. Exact-preview proof remains open.
- **Next action:** recheck governing PR #1175, publish this checkpoint, inspect exact-head CI/artifact, then continue F018 Build Plan reconciliation.
- **Merge status:** **UNSAFE — DO NOT MERGE OR DEPLOY.**

### 2026-07-28T17:02:48Z — Codex

- **Mode:** five-pass forensic audit checkpoint — screenshot release-evidence consistency.
- **Branch / PR:** `audit/pr1175-complete-five-pass-forensic-audit` / draft PR #1271; governing PR #1175 remains frozen, draft and unmerged.
- **Root cause and fix:** the screenshot producer used route coverage both as a success percentage and as the count of missing findings, so a complete run emitted `routeCoveragePercent: 100` beside `counts.routeCoverage: 0`. Replaced those duplicate fields with one versioned `{expected, covered, uncovered, percent}` authority in both JSON artifacts and an explicit `findingCounts.missingRouteCoverage`. A pre-write gate recomputes all dimensions and compares exact viewport/pattern identities for uncovered rows.
- **Tests:** new contract failed 2/2 before implementation and passes 3/3 after, including behavioral rejection of contradictory percentage and uncovered-route details; 9/9 related screenshot/repair assertions pass; both scripts pass `node --check`; TypeScript, ESLint and the complete release-integrity audit are clean.
- **CI / deployment:** prior exact-head CI for `9502c578…` was in progress when this checkpoint began. No preview, deployment, database mutation or real-account test was triggered.
- **Next action:** complete static validation, recheck governing PR #1175, publish, then inspect exact-head CI and continue the remaining cross-panel truth/runtime gaps.
- **Merge status:** **UNSAFE — DO NOT MERGE OR DEPLOY.**

### 2026-07-28T16:55:46Z — Codex

- **Mode:** five-pass forensic audit checkpoint — fail-closed exact-head CI evidence.
- **Branch / PR:** `audit/pr1175-complete-five-pass-forensic-audit` / draft PR #1271; governing PR #1175 remains frozen, draft and unmerged.
- **Root cause and fix:** success artifacts retained only selected logs, omitted lint/tests/Playwright and permitted missing files with a warning. Added one streaming command recorder for 16 mandatory commands with exact source SHA, timestamps, duration and exit status in an NDJSON ledger; added a success-only completeness verifier that requires every non-empty log and exact-head successful entry; exact acceptance upload now fails on missing files and never publishes from a partial run.
- **Tests:** completeness contract failed 3/3 before implementation and passes 3/3 after; command runner records real success/failure exits; verifier accepts a complete fixture and rejects a missing log; 36/36 related CI/migration contracts pass; workflow YAML parses; TypeScript, ESLint and release-integrity audits are clean.
- **CI / deployment:** exact-head CI for `115d28b7…` is in progress as run `30380110604`; publishing this checkpoint will supersede it through normal concurrency. No deployment or real-account test was triggered.
- **Next action:** publish after rechecking PR #1175, then inspect the resulting exact-head run and artifact before treating F008 as runtime-verified.
- **Merge status:** **UNSAFE — DO NOT MERGE OR DEPLOY.**

### 2026-07-28T16:48:29Z — Codex

- **Mode:** five-pass forensic audit checkpoint — deterministic migration test ownership.
- **Branch / PR:** `audit/pr1175-complete-five-pass-forensic-audit` / draft PR #1271; governing PR #1175 remains frozen, draft and unmerged.
- **Root cause and fix:** two parallel `node:test` files each spawned two `prisma migrate deploy` commands against the shared CI schema even though CI already performs deploy and idempotency checks sequentially before `npm test`. Removed all four in-test migration subprocesses; CI is now the one migration executor, while the suites retain their post-migration row-behavior assertions.
- **Tests:** the ownership contract failed before implementation and passes 2/2 after; 73/73 related CI routing, migration, export-gate and release-integrity assertions pass; TypeScript is clean. Database execution is not claimed locally.
- **CI / deployment:** exact-head CI for prior Final ZIP checkpoint `611b638d…` is in progress as run `30379756743`; no deployment or real-account test was triggered.
- **Next action:** publish after rechecking governing PR #1175, then continue F007/F008 and the cross-panel runtime truth gaps.
- **Merge status:** **UNSAFE — DO NOT MERGE OR DEPLOY.**

### 2026-07-28T16:41:45Z — Codex

- **Mode:** five-pass forensic audit checkpoint — Final ZIP manifest authority and duplicate-code removal.
- **Branch / PR:** `audit/pr1175-complete-five-pass-forensic-audit` / draft PR #1271; governing PR #1175 remains frozen, draft and unmerged.
- **Root cause and fix:** production ZIP manifests discarded exact plan positions and omitted envelope/format, while a second test-only finalizer could let release tests pass without exercising the production owner. Removed that finalizer and reconnected its consumers to `assembleFinalSubmissionZip`; canonical scope now carries unique positive plan order, envelope and canonical format into a persisted manifest with exact filename, byte length and SHA-256. Assembly sorts by plan order, rejects duplicate positions and reopens/re-hashes every archive entry.
- **Tests:** new authority contract failed 3/3 before implementation and passes 3/3 after; 213/213 affected scope, assembly, Build Plan, release-package, PDF-safety, static-safety and binary-inspection assertions pass; TypeScript, ESLint and release-integrity audits are clean. The binary fixture remains synthetic and is not represented as upload-to-export acceptance.
- **Security/runtime:** no real-account test, database mutation, deployment or authenticated download was performed. Persisted `ExportPackage.manifestJson` acceptance remains open.
- **Next action:** run lint/release-integrity and broader affected tests, recheck governing PR #1175, publish this checkpoint, then continue the remaining screenshot/workflow/release-evidence gaps.
- **Merge status:** **UNSAFE — DO NOT MERGE OR DEPLOY.**

### 2026-07-28T16:23:58Z — Codex

- **Mode:** five-pass forensic audit checkpoint — complete Company Vault review authority.
- **Branch / PR:** `audit/pr1175-complete-five-pass-forensic-audit` / draft PR #1271; governing PR #1175 remains frozen, draft and unmerged.
- **Root cause and fix:** the canonical Review Inbox omitted Legal, Financial and Compliance records, while manual POST routes misleadingly stamped unsupported entries `REVIEWED` with an actor identity. Added bounded independently paginated DTOs and review controls for all three families; manual creation now persists `MANUAL_DRAFT` with no reviewer/timestamp, and only the existing durable source-backed review route can promote it.
- **Concurrency disposition:** the earlier F003 stale-write finding was stale against the frozen head. All three detail routes bind writes to exact record and source revisions and return `409 CONCURRENT_UPDATE`. Exact checkpoint CI run `30377357481` passed the isolated PostgreSQL stale-write test and all 8 authenticated Legal/Financial/Compliance route assertions.
- **Tests:** new contract failed before implementation and passes 4/4 after; 60/60 related privacy, RBAC, provenance and concurrency assertions pass; TypeScript and ESLint clean. The prior exact-checkpoint CI reached 8,918/8,919: its sole failure was the workboard’s missing governing PR branch identity, now fixed locally and passing in the 28/28 owning test. `npm test` cannot start `tsx` IPC under this sandbox/Node 24 (`EPERM`).
- **Security/runtime:** no real-account test, database mutation or deployment was performed. Authenticated preview acceptance remains open.
- **Next action:** publish this checkpoint after rechecking the governing head, then audit the final ZIP/generation authority roots.
- **Merge status:** **UNSAFE — DO NOT MERGE OR DEPLOY.**

### 2026-07-28T16:14:00Z — Codex

- **Mode:** five-pass forensic audit checkpoint — preview schema/runtime truth.
- **Branch / PR:** `audit/pr1175-complete-five-pass-forensic-audit` / draft PR #1271; governing PR #1175 remains frozen, draft and unmerged.
- **Runtime evidence:** supplied screenshot deployment `dpl_DNyVb6zVZZgtxUyso5Z1c6apPwKN` is bound to `aed98737…`; its visible P2022 reports missing `LegalRecord.trustLevel`. Vercel no longer retains those historical lines. Governing deployment `dpl_yYMggEEnQbJemQtmMHioee15eZnN` is bound to `ec0eaa83…` and has no retained last-day error/500 rows, but no authenticated traffic proves the affected path.
- **Root cause and fix:** the additive review-provenance migration and runtime fail-closed compatibility loader exist, but the deploy-time critical-schema gate did not require any Legal/Financial/Compliance review columns. Extracted one pure schema contract used by the production probe and added all three authority-bearing tables/column families; a missing column now fails the actual evaluator.
- **Documentation:** consolidated evidence into the four exact mandated `docs/audits/pr1175-*` ledgers and removed the temporary duplicate root ledgers.
- **Tests:** new contract failed before implementation; 3/3 behavioral schema assertions and 63/63 related schema/migration/preview assertions pass; TypeScript and ESLint clean. No database execution is claimed because this workspace has no isolated PostgreSQL service.
- **Security:** no real-account test was run. Password rotation, session revocation, GitHub secret update and retained-artifact sanitization remain mandatory.
- **Next action:** publish this fail-closed checkpoint, renew exact-head CI/deployment identity, then continue the Review Inbox/concurrency and generation/export authority roots.
- **Merge status:** **UNSAFE — DO NOT MERGE OR DEPLOY.**

### 2026-07-28T16:03:00Z — Codex

- **Mode:** five-pass forensic audit checkpoint — background extraction authority.
- **Branch / PR:** `audit/pr1175-complete-five-pass-forensic-audit` / draft PR #1271; governing PR #1175 remains draft and unmerged.
- **Frozen source:** governing PR head rechecked unchanged at `ec0eaa83af3d3616bf935b9a3f950af734bcc6ca` before this checkpoint.
- **Root cause and fix:** both tender request paths performed extraction inline and bypassed the registered durable worker; company upload trusted request-time text; a dead duplicate extraction implementation remained. Upload now persists verified bytes/source/package state plus exact hash-bound `EXTRACT_TEXT` jobs, the canonical worker exclusively owns extraction/metadata/continuation, replay returns durable state, and Vault ingestion forces background re-extraction.
- **Files changed:** both tender upload handlers; canonical and legacy AI job handlers; metadata/re-extraction/pipeline UI helpers; tender upload UI consumers; focused upload, integrity, extraction, package, sequencing, metadata, and provenance tests; all four five-pass ledgers; this handoff.
- **Tests:** new wiring contract failed 7/7 before the fix and passes 7/7 after; `npx tsc --noEmit`, ESLint, and the complete release-integrity audit clean; affected transitive suite 382/382 across 92 suites.
- **CI / deployment:** no claim yet for the audit-head CI, isolated PostgreSQL integration, or audit-head Vercel preview. Local Node 24.14 differs from required Node `>=22 <23`.
- **Security:** real-account testing remains prohibited until the leaked app password is rotated, active sessions are revoked, the GitHub secret is updated, and retained artifacts are sanitized.
- **Next action:** publish this checkpoint, then reproduce and repair the preview `LegalRecord.trustLevel` schema/runtime boundary without touching a shared or production database.
- **Merge status:** **UNSAFE — DO NOT MERGE.**

### 2026-07-28T15:34:40Z — Codex

- **Mode:** five-pass forensic audit checkpoint — work remains active.
- **Branch / PR:** `audit/pr1175-complete-five-pass-forensic-audit` / child draft pending first checkpoint commit; governing PR #1175 remains draft and unmerged.
- **Frozen source:** PR #1175 head `ec0eaa83af3d3616bf935b9a3f950af734bcc6ca`; base `b3c9db5de89a2a665e61a83facbff0f276f9983c`; governing branch rechecked unchanged before editing.
- **Scope completed locally:** restored truthful automatic evidence authority (`SOURCE_VERIFIED`, never fabricated `REVIEWED`); removed automatic signature/stamp mutation from generation and auto-finalize; added the four five-pass audit ledgers.
- **Files changed:** `lib/company-auto-verification.ts`; generation/auto-finalize routes; removed `lib/engine/apply-signature-stamp.ts`; provenance/repair/signature tests; `five-pass-pr1175-*.md`; this handoff.
- **Tests:** `npx tsc --noEmit` clean; 126/126 focused and transitive tests pass across provenance, matching, signature approval, auto-finalize, PDF finalization, and export format.
- **CI / deployment:** governing exact-head CI and screenshot runs were green and exact-head Vercel deployment was READY before this audit; no audit-head CI/preview exists yet.
- **Known risks:** request-bound OCR still bypasses the registered durable extraction worker; the supplied preview shows database migration and cross-panel truth contradictions; no local PostgreSQL service; local Node 24.14 differs from required Node `>=22 <23`; real-account security hold remains active.
- **Next action:** publish/open the child draft PR, then reconnect both upload paths to deterministic background extraction and continue the remaining pass ledger.
- **Merge status:** **UNSAFE — DO NOT MERGE.**

<!-- Add newest entry at the top. -->

### 2026-07-27 16:44 UTC — Codex, latest-preview runtime and workflow-truth repair

- **Branch / PR:** `release/consolidated-recovery-20260717` / PR #1175 (keep draft). The user referenced PR #1275, but GitHub returns no such PR in `hopeengineering83-code/hope-tender-path-b`; the latest-preview footer and active branch both resolve to PR #1175.
- **Three-pass screenshot audit:** inspected all 20 supplied screenshots line by line, OCR-cross-checked the visible values/actions, and compared the screenshot preview (`aed98737`), current PR head (`cef5926e58a1825bd2e9da49127fa33ec176ddca` before this repair), local source, `main`, migrations, and the intended Vercel project. Confirmed contradictions included: 5/5 mandatory coverage beside a 4/5 trace blocker; analysis 100/100 beside requirements 76; 28 experts/50 projects labelled reviewed while canonical matching had zero eligible evidence; manual FULL coverage rendered UNKNOWN; proposal-response rows marked fully met before generated content existed; explicit tender scope presented as a confirmed Build Plan in one panel and absent in another; duplicated blockers/finalize actions; and `Technical Proposal.pdf` incorrectly classified as ADMIN.
- **Vercel runtime root cause:** the screenshot deployment (`aed98737`) and current-head deployment both skipped preview migrations under the repository's safety policy because no isolated preview database was enabled. Runtime logs contain repeated Prisma P2022 failures for missing review-provenance columns, including `LegalRecord.trustLevel`; `/api/tenders/[id]/bid-strategy` returned 500 and background Engine jobs failed. No production/shared database migration was attempted.
- **Runtime repair:** added `lib/prisma-schema-compatibility.ts` as a narrow, fail-closed compatibility boundary. Legal/financial/compliance evidence loads only through canonical provenance checks; a stale preview schema yields zero eligible support records rather than unreviewed fallback evidence. Engine, AI proposal, section regeneration, canonical document generation, and bid strategy now use that boundary. AI job failures persist only a safe diagnostic category plus correlation reference; raw Prisma/model/column details remain server-log-only. Both initial polling and later “check status” paths give the correct isolated-preview migration action rather than the misleading duplicate/oversized-input advice.
- **Workflow-truth repair:** proposal responses cannot be FULL before generated, source-linked content exists; the heatmap recognizes canonical FULL/SUBSTANTIAL/NONE values and excludes orphan historical rows; the Vault panel counts only source-verified or provenance-backed generation-eligible records; only a current confirmed Build Plan receives confirmed/green authority; explicit tender scope remains unconfirmed; duplicate readiness items/finalize actions are suppressed; technical deliverables outrank generic FORM-to-ADMIN classification.
- **Files changed:** `app/api/ai-jobs/run-next/route.ts`; tender `ai-proposal`, `bid-strategy`, and `regenerate-section` routes; `lib/prisma-schema-compatibility.ts`; engine compliance, generation, run, and submission-plan modules; compliance heatmap, Engine action, generation readiness, submission-plan truth/completeness, and Vault evidence panels; focused regression tests.
- **Verification:** `git diff --check`, `npm run typecheck`, `npm run lint`, and `npm run audit:release-integrity` passed; the audit checked 423 routes and 1,364 files. Ten locally executable focused assertions passed. The PostgreSQL persistence assertion remains intentionally gated on `RUN_DB_INTEGRATION=true` and an isolated database. The repository `npm test` wrapper could not open its `tsx` IPC socket in this sandbox; an alternate all-suite invocation was rejected by the environment's execution-approval limit, so no full-suite claim is made. A complete optimized Next production build passed with non-secret build-only placeholders.
- **First exact-head CI correction:** migrations, critical schema checks, zero-drift verification, release audit, typecheck, and lint passed. The test step then found three stale source-contract assertions: one expected the pre-compatibility `company` query variable, and two expected the old “reviewed” disclosure labels instead of the new canonical “eligible” labels. The assertions now verify the compatibility loader remains after the canonical gate and that eligible disclosure counts match their rendered unselected lists. No product behavior was reverted.
- **Second exact-head CI correction:** the renewed suite passed the three corrected contracts, then found one safety-source convention: the Finalize PDF mutation was correctly gated by `canMutate`, but the expression placed the action comparison before the capability guard. Reordered it to the repository's explicit `canMutate && action` convention and kept the read-only link fallback; permission behavior is unchanged and duplicate execute controls remain removed.
- **Security hold:** do not perform real-account testing. The previously exposed application password must be replaced, active sessions revoked, the canonical GitHub secret `REAL_APP_PASSWORD` (and any actually-used legacy alias) updated, and retained credential-bearing artifacts sanitized first. The leaked value is intentionally not recorded here.
- **Known risk / required infrastructure action:** compatibility code stops the preview crash without weakening evidence authority, but it does not replace the pending migration. The durable end state still requires an isolated preview database plus the repository-approved preview migration flag and post-migration schema verification. Never point preview migration automation at a production/shared database.
- **Next action:** wait for exact-head CI and the intended Vercel preview, inspect build/runtime logs without a real account, then resume synthetic/authenticated acceptance only after the security rotation checklist is complete.
- **Merge status:** not reviewed — draft; do not merge or deploy.

### 2026-07-26 18:55 UTC — Codex, resumable intake and runtime fact-authority completion

- **Branch / PR:** `release/consolidated-recovery-20260717` / PR #1175 (keep draft).
- **Open-PR re-audit:** #1258–#1261 were unchanged from the prior audit. #1258's native Word TOC is already in #1175; its alternate action center remains deliberately rejected as a duplicate. #1259 contains only a handoff note and no product code. #1260's disconnected, Pharo/healthcare-specific modules remain unsafe to treat as universal runtime authority. #1261's unsupported intake pseudo-job and non-atomic/id-from-time design remain unsafe. No donor commit is suitable for wholesale merge.
- **Durable intake completion:** multi-request tender packages now use ownership-scoped `TenderWorkflowRun` session and batch ledgers with a manifest hash, byte-bound batch fingerprints, stable idempotency keys, lost-response replay, stale-run recovery, exact batch/file completeness, and resumable UI. Analysis is queued only after server-verified package completion and still uses the canonical `AI_ANALYZE` job service/content hash.
- **Fact-authority completion:** successful foreground and background AI promotion now synchronizes persisted tender facts into `TenderFactsLedger` under the tender mutation advisory lock. Source grounding requires an active file and a quote proven on the stored page. Human-confirmed/not-applicable authority is preserved and grounded facts are never downgraded. Historical `title` and canonical `projectTitle` ledger aliases resolve consistently.
- **Overlap removal:** the 452-line duplicate TenderFactsLedger backfill implementation is replaced by a thin CLI wrapper around the canonical service; email normalization now reuses the existing source-driven parser helper.
- **Required PDF:** no second PDF workflow was added. The app already has two guarded paths: in-engine content rendering from an approved DOCX and `attach-original` for an official tender-issued, byte-verified PDF when exact vendor/page rendering is required. Final validation, reviewer approval, byte integrity, required-format, and ZIP gates remain fail closed.
- **CI-caught contract correction:** the first exact-head CI run passed migrations, schema/drift checks, release audits, typecheck, and lint, then found one stale source-contract test that still required the Active Workboard to list PRs #1030/#1031 and an obsolete branch. The workboard is intentionally current and single-authority, so the test now requires PR #1175 and rejects those retired entries.
- **Verification:** release-integrity audit passed (including 407 API routes and 1,334 source files); workflow-state audit passed with the same three warning-only wording findings; typecheck and lint passed; focused changed-area suite passed **139/139**; Prisma validate/generate passed; production Next build passed with non-secret build-only placeholders. The complete no-provider/no-database run produced **8,523/8,535 passing**; the same 12 environment-gated tests failed because disposable PostgreSQL and production/provider variables are absent, not because of assertion regressions. Exact-head GitHub CI must renew the database/browser proof after publication.
- **Security hold:** do not perform real-account testing. The previously exposed application password must be replaced, active sessions revoked, the canonical GitHub secret `REAL_APP_PASSWORD` (and any actually-used legacy alias) updated, and retained credential-bearing artifacts sanitized first. The leaked value is intentionally not recorded here.
- **Known production limits:** no current environment here can verify real provider output, real PostgreSQL integration, the exact Vercel preview, or real-account acceptance. In-engine PDF generation preserves approved content and branded structure but is not a page-faithful Microsoft Word renderer; use the existing official-original attachment path when exact pagination is contractually required.
- **Next action:** publish the verified commit, renew exact-head CI/screenshot/preview checks, close #1258–#1261 with precise dispositions, then wait for credential rotation and owner UAT before merge/deploy.
- **Merge status:** not reviewed — draft; do not merge or deploy.

### 2026-07-26 17:38 UTC — Codex, upload-once workflow and open-PR consolidation audit

- **Branch / PR:** `release/consolidated-recovery-20260717` / PR #1175 (kept draft).
- **Audit scope:** inspected `main`, PR #1175, every open PR known at the start (#1258 and #1259), the current navigation/action contracts, tender intake and durable job continuations, Company Vault use in generation, DOCX branding/TOC output, release gates, and unreferenced engine modules. PR #1258's native Word TOC field is the only goal-aligned product donor incorporated; its deleted `TenderWorkflowActionCenter` was rejected because PR #1175 intentionally consolidated that duplicate action surface. PR #1259 contains handoff documentation only.
- **Live-state follow-up:** PRs #1260 and #1261 appeared after the implementation commit was published, both based on the former PR #1175 head. They were audited before final handoff and no code was accepted. #1260 adds eight unconnected runtime modules plus tests; the modules have no production consumers and include Pharo-specific default appendix/runtime fixtures, so copying them would recreate dead code and risk tender-scope leakage. #1261 overlaps this pass's upload work but bypasses the canonical analysis-content hash/service, queries nonexistent `TenderFile` fields, uses unsupported queued `INTAKE_SESSION` pseudo-jobs, derives a supposedly idempotent ID from `Date.now()`, and increments batches without an ownership-bound atomic duplicate guard. Its disconnected readiness helper also re-declares provider assumptions. PR #1175's implementation instead uses canonical `createAnalysisJob` idempotency and treats the browser only as an optional worker wake-up.
- **Workflow fix:** a complete new-tender upload now creates or reuses one server-owned `AI_ANALYZE` job with `autoContinue`; multi-batch packages defer that job until the final successful batch; the browser only wakes the durable worker and never becomes job authority. The tender page now resumes/polls an active job. Promoted analysis continues to Engine, and a gate-clean Engine run continues to proposal generation. Production readiness now fails closed when neither `AI_JOBS_WORKER_SECRET` nor the accepted cron authentication is present, because browser-independent continuation would otherwise stall.
- **Evidence/branding fix:** generation no longer falls back to every reviewed Vault expert/project when no tender-scoped selection exists. Only tender-selected, reviewed projects can supply positive evidence. The active verified Company Vault logo is embedded in DOCX output; existing letterhead handling remains. Signature/stamp insertion remains deliberately human-controlled.
- **Consolidation:** removed nine confirmed unreferenced engine modules (1,203 lines) and hardened three audits so intentional pre-commit deletions can be validated. Existing consolidated five-destination navigation and semantic-icon contracts passed; no additional primary icon/page duplication was reintroduced.
- **CI-caught correction:** the first exact-head CI run found two source-contract failures in `lib/ui/auto-pipeline.ts`: the authority comment no longer contained its locked wording, and the cleanup had removed the safety-locked Company Vault byte-reimport helper. Restored the exact server-authority contract and the `/api/company/reimport` helper with privacy-safe logging. The helper remains non-promoting and cannot start AI Analyze.
- **E2E contract correction:** the next exact-head CI run passed unit/DB integration, migration, audit, typecheck, lint, build, Vercel preview, and 178/179 executed browser tests. Its only failure was the golden intake test still expecting the pre-automation `RUN_AI_ANALYZE` action even though the API correctly returned `WAIT_FOR_AI_ANALYZE`. Updated that test to require the new fail-safe contract: a non-empty `processingJobId`, `AI_ANALYZE_QUEUED`, and an owned durable `AI_ANALYZE` row in `QUEUED`/`RUNNING` state before the response is treated as successful.
- **Security finding:** the latest PR security comment records that the real-account login form previously had a pre-hydration GET fallback, placing the login email and password in the browser URL, which was then copied into an audit comment. The form is now explicitly POST-based, but the disclosed password remains compromised. No further real-account test was run. Rotate the app login password, replace the canonical GitHub Actions secret `REAL_APP_PASSWORD` (and the actual legacy alias too if the repository still uses one), revoke existing sessions, and sanitize retained artifacts before resuming real-account tests. Never reuse the disclosed password.
- **Validation:** `npm run audit:release-integrity` passed; `npm run audit:workflow-state-consistency` passed with the three pre-existing warning-only wording findings; typecheck and lint passed; focused upload/continuation, navigation/icon, safety, DOCX logo, and Word TOC suites passed (173 tests); production build passed with non-secret placeholders. Default full-suite execution remains environment-gated: the DB safety suite requires `RUN_DB_INTEGRATION=true` plus disposable PostgreSQL. A broader local attempt was stopped after the environment guard identified a possible external-provider call; no real provider output is claimed.
- **Known risks / assumptions:** real database acceptance, authenticated browser E2E, and exact-head GitHub CI must be renewed after publication. Multi-batch intake fails closed if the browser disappears before the final batch: stored source files remain recoverable on the tender, but there is not yet a migration-backed, ownership-scoped resumable intake-session ledger. Automatic work intentionally stops at human review/approval gates; Final ZIP and legally sensitive signature/stamp placement do not auto-unlock.
- **Next action:** publish the audited commit to PR #1175, renew exact-head CI, then rotate `REAL_APP_PASSWORD` before any real-account UAT.
- **Merge status:** not reviewed — draft; do not merge or deploy.

### 2026-07-26 15:35 UTC — Claude Code, wire CONDITIONAL_OR_UNSCHEDULED status (CLAUDE.md priority #4)

- **Mode:** continuing "fix every gap end to end." Closed CLAUDE.md's own priority-list item #4: "Add `CONDITIONAL_OR_UNSCHEDULED` status to canonical resolver + wire through STATUS_BADGE maps."
- **Finding:** `TenderFactsLedger`'s `AUTHORITY_STATE` enum (`lib/engine/tender-facts-ledger-service.ts`) and the shared `TenderFactAuthorityState` type (`lib/engine/effective-tender-context.ts`) have long included `CONDITIONAL_OR_UNSCHEDULED` for facts the source states conditionally or without a firm schedule (e.g. "site visit by arrangement", "pre-bid meeting TBD") — but `lib/engine/canonical-field-state.ts`'s resolver had no branch for it, and `components/canonical-field-status-badge.ts` had no entry (an unhandled `Record` key that would crash the badge lookup the moment any producer starts emitting this state). No extraction classifier currently produces this state, so this closes the resolver+badge half of the gap defensively.
- **Fix:** added `CONDITIONAL_OR_UNSCHEDULED` to `CanonicalFieldStatus`/`ClientChipStatus` type unions; a ledger-authority-resolution branch; a status-determination branch (guarded by `!override` so a human edit/confirm always outranks an earlier conditional classification) that blocks FINAL export for critical fields with an explanatory reason while leaving draft work unblocked; excluded it from `effectiveValid`/`effectiveGrounded`; added an explicit `exportHardBlockReasons` disjunct; added a `canonicalToClientChip` case; added a badge entry.
- **Branch / PR:** `release/consolidated-recovery-20260717` / PR #1175 (still draft). Commit `813a3eb5`.
- **Tests:** new `tests/canonical-field-state-conditional-or-unscheduled.test.ts` (9 tests) — verified load-bearing via `git stash` on the two source files (6/9 fail without the fix, confirming the tests actually exercise the new code), then restored. Writing the tests surfaced and fixed a real override-precedence bug in the resolver (without `!override`, the new branch could incorrectly outrank a later `USER_EDITED` override on the same field) before it reached validation. `npx tsc --noEmit` clean; `npm run lint` clean; `npm run audit:release-integrity` 0 failures; full suite **8519/8529 pass** in default mode (10 failures are pre-existing `RUN_DB_INTEGRATION=true`-gated DB-integration tests, unrelated to this change — re-ran all 10 files against the local disposable Postgres with proper env: **79/79 pass**); production build clean.
- **Known risk / scope note:** this only wires the resolver+badge plumbing. Nothing in the codebase yet classifies a source statement as `CONDITIONAL_OR_UNSCHEDULED` (no NLP/extraction producer exists) — building that classifier was out of scope for this pass and is a larger, unscoped feature.
- **Next action:** continue "fix every gap end to end" — remaining open CLAUDE.md priorities include full BuildPlan/document-generator wiring for `TenderFactsLedger` (noted in Round 5 as not yet ledger-aware) and the backfill script (`scripts/backfill-tender-facts-ledger.ts`).
- **Merge status:** DO NOT MERGE — draft, awaiting Hope's review.

### 2026-07-22 00:12 UTC — Claude Code, close remaining UX consolidation overlap + reconcile E2E drift

- **Mode:** follow-up to the UX consolidation pass below, per "continue until all gaps are fixed." Two rounds of real work, not narration:
- **Round 1 — CI regression from the sidebar consolidation itself:** the pushed consolidation (head `cc9c0950`) broke 6 E2E tests (`e2e/dashboard-role-navigation.spec.ts`, `e2e/tablet-universal-tender-intelligence.spec.ts`) that asserted the pre-consolidation "every route is its own literal sidebar `<a href>`" contract — now-consolidated member routes (settings, admin/ai-readiness, etc.) correctly stopped being literal sidebar links. Pulled real CI job logs (`get_job_logs` with `return_content=true`; the `logs_url` Azure blob link is network-blocked in this environment), diagnosed the exact assertions, and reconciled them to the new memberHrefs contract (parent-destination checks instead of literal-route checks; `/dashboard/search`'s zero-active-item case since Global Search moved to the header). Verified 30/30 pass against a real local PostgreSQL + production build + Playwright run before pushing (head `5c4c39cc`). CI went green (4/4 checks).
- **Round 2 — the previously-flagged residual duplicate, now actually fixed:** `components/tender-recovery-command-center.tsx` had two places dispatching `RUN_ENGINE` via `executeAction()` — the `EVIDENCE_NOT_ASSESSED` blocker quick-action, and the generic recovery-state "Execute" button when `primaryNextAction === "RUN_ENGINE"`. Traced `lib/recovery-command-actions.ts`'s `RUN_ENGINE` spec: a bare synchronous `POST /api/tenders/{id}/engine`, no `?async=`, no `?safe=` — meaning this component didn't just duplicate the *label*, it bypassed the async job-queue infrastructure entirely and risked the exact 60s Vercel timeout that infrastructure exists to prevent. Both call sites now render a `DisclosureAnchorLink` to the canonical `#run-engine-action` control (already-established pattern — `generation-readiness-panel.tsx` does the same for this action) instead of executing a second/third engine run. Capability preserved (still one click to get there), duplicate trigger removed.
- **Branch / PR:** `release/consolidated-recovery-20260717` / PR #1175 (still draft). Final SHA `b99bd380`.
- **Tests:** updated 4 test files whose assertions targeted the removed literal button text/call sites (`tests/action-icons-visibility.test.ts`, `tests/workflow-icons-affordance-round2.test.ts`, `tests/recovery-action-scoping.test.ts` — widened a stale fixed-offset string slice that no longer reached the still-present `canMutate` gate after the ternary insertion); added a new category-A test to `tests/ux-consolidation-overlap-regressions.test.ts` asserting neither `RUN_ENGINE` call site executes directly. Every new/changed assertion verified load-bearing (reverted the fix, confirmed the test fails, restored). `npx tsc --noEmit` clean; `npm run lint` clean; full unit suite **8452/8462 pass** (10 pre-existing `RUN_DB_INTEGRATION=true` guards, unrelated); production build clean.
- **Known risk:** none identified — this was a scoped, mechanically-verified fix preserving existing capability, not a deletion.
- **Next action:** none outstanding from the original 7-item spec or its flagged residual overlap. `EVALUATION_CRITERIA_NOT_EXTRACTED` vs `EVALUATION_CRITERIA_MISSING` remains the one deliberately deferred item, per explicit instruction.
- **Merge status:** not reviewed — draft, do not merge.

### 2026-07-21 22:35 UTC — Claude Code, UX consolidation pass (7-item spec)

- **Mode:** user provided a detailed 7-item UX consolidation spec starting from exact head `35160483`, using the exact-head screenshot artifact as visual evidence. Confirmed problem: not missing functionality, but duplicated actions, overlapping navigation, competing status panels, and too many internal tools exposed as separate primary pages. Audited desktop/tablet/mobile screenshots against the exact head before touching code.
- **Branch / PR:** `release/consolidated-recovery-20260717` / PR #1175 (still draft). Final SHA `3a7746e6`.
- **Item 1 — `components/engine-action-panel.tsx`:** removed the duplicated four-button design. Idle state now renders exactly two actions (`⚡ Run Safe Mode — Recommended` primary, `🕐 Run Full AI in Background` secondary), both through the async job queue. The amber large-vault banner is now info-only text, no buttons.
- **Item 2 — company sub-nav:** `Labeled Profile Editor` (new `components/section-subnav.tsx`-backed `components/company-subnav.tsx`) is now active only on `/dashboard/company/profile`, fixed via longest-matching-href selection instead of a hardcoded always-on tab.
- **Item 3 — primary sidebar:** consolidated 23 top-level items to 6 (Overview, Tenders, Company Vault, Engine, Documents & Export, Administration) via a new `memberHrefs` mechanism on `lib/dashboard-navigation.ts` plus new cross-nav tab bars (`section-subnav.tsx`, `dashboard-group-subnav.tsx`, `company-subnav.tsx`). No route moved/renamed/removed, so no redirects were needed — every href and memberHref still resolves to its original destination. Global Search moved to the header; Setup Wizard hides once `Company.setupCompletedAt` is set.
- **Item 4 — tender-detail workspace:** `NextActionPanel` is now the one authoritative status card (status, readiness score, bid verdict, next action), always visible. Recovery Command Center, Tender Release State (`showNextAction={false}`), and Final Submission Control Center moved into a collapsed "Advanced diagnostics" `<Disclosure>`. No fail-closed gate weakened — presentation/grouping only.
- **Item 5 — engine route parity:** `app/api/tenders/[id]/engine/route.ts`'s synchronous path now calls the same `checkEnginePostconditions` the async path already used (added in the prior async-job-queue pass) — a sync run with zero requirements/evidence/matches now reports partial/blocked instead of a plain success.
- **Item 6 — new `tests/ux-consolidation-overlap-regressions.test.ts`** (10 tests) directly covering the 5 named overlap categories (duplicate engine-action buttons; duplicate primary nav destinations; multiple primary next-actions on the tender page; wrong-route-active company sub-nav tab; overlapping sidebar icon identities). Every test confirmed load-bearing by reverting the fix and observing the failure before restoring.
- **Item 7 — `EVALUATION_CRITERIA_NOT_EXTRACTED` vs `EVALUATION_CRITERIA_MISSING`:** deliberately not touched, confirmed via `git diff | grep EVALUATION_CRITERIA` → no matches. Remains a deferred product decision.
- **Superseded a prior dated decision:** `tests/post-1162-executive-truth-density.test.ts` previously required (per a 2026-07-20 owner note) that the tender-page diagnostics section default open. This pass's instruction to keep it collapsed supersedes that note — the test was updated with an explicit comment recording the supersession, flagged here for visibility.
- **Tests actually run:** `npx tsc --noEmit` clean. `npm run lint` clean. Full unit suite **8451/8461 pass** in the default run (10 "failures" are the pre-existing `RUN_DB_INTEGRATION=true` fail-closed guards); re-ran those same 10 files for real against local PostgreSQL 16 with `RUN_DB_INTEGRATION=true` — **79/79 pass**. Production build (`npm run build`) clean, then verified with a real `next start` against the same local PostgreSQL instance. Real Playwright screenshots at desktop (1440×1000), tablet (800×1280), mobile (390×844) for dashboard, Company Vault, Company Profile Editor, Profile Readiness, tender detail, plus the 4 new consolidated hub routes — before/after comparison confirms the sidebar, company sub-nav, and single-status-card fixes all render as intended.
- **Known remaining overlap (flagged, not fixed — outside the named scope):** `components/tender-recovery-command-center.tsx` still has its own "Run Engine" quick-action button, a 3rd trigger for the same engine action. It's no longer simultaneously prominent (now inside the collapsed "Advanced diagnostics" section), reducing but not eliminating the overlap. Item 1 named only `engine-action-panel.tsx`, so this was left untouched.
- **Next action:** await CI on `3a7746e6`. The `tender-recovery-command-center.tsx` duplicate "Run Engine" quick action and the `EVALUATION_CRITERIA_NOT_EXTRACTED`/`MISSING` decision remain open.
- **Merge status:** not reviewed — draft, do not merge.

### 2026-07-21 20:33 UTC — Claude Code, icon overlap/contradiction audit

- **Mode:** user reported the app's main gap as "many unnecessary and overlapping icons with contradictions," theorized as the cause of "many unnecessary pages." Audited both halves with evidence before changing anything, on top of PR #1175's existing Phase 2 route/panel consolidation work.
- **Branch / PR:** `release/consolidated-recovery-20260717` / PR #1175 (still draft). Final SHA `767e3b7e`.
- **5 confirmed icon bugs found and fixed** (see PR #1175's description for full detail): (1) sidebar nav reused `ListIcon` for both Active Tenders and Activity Logs, and `SparklesIcon` for both Setup Wizard and AI Readiness (`lib/dashboard-navigation.ts`) — reassigned to `BellIcon`/`FlagIcon`. (2) `tests/dashboard-navigation-contract.test.ts` had a test named for icon uniqueness that never actually asserted it — added the real check. (3) `ai-copilot-suggestions-panel.tsx`'s `ICON_MAP` collapsed 3 distinct suggestion keys onto one `DocumentIcon` — split to `LinkIcon`/`FolderIcon`/`DocumentIcon`. (4) `submission-plan-completeness-panel.tsx` used the same clock icon for `PLANNED` (future) and `SUPERSEDED` (historical) — opposite temporal meanings; `SUPERSEDED` now uses `FolderIcon`. (5) `canonical-readiness-state.ts`'s `RUNNING`/`STALE` both render a static `RefreshIcon`, contradicting the original canonical status design doc which called for `RUNNING` to add a spinner — added `animate-spin` to `RUNNING` only.
- **Page-count finding — no code change, evidence says it's not a bug:** cross-checked all 30 `page.tsx` routes under `app/dashboard` against the nav registry, supplementary route labels, and the dynamic tender resolver — zero orphaned/dead pages. Read the "Global Analysis/Matching/Compliance" and Company Vault sub-pages directly: genuinely distinct, substantial, non-duplicate content. The perceived page bloat is a navigation-density/product question — already flagged in this same PR as needing a decision before any route consolidation — not a code defect. Did not unilaterally merge or delete any page.
- **Tests actually run:** all 5 new/updated regression tests verified load-bearing (reverted each fix individually, confirmed the test fails, restored). `npx tsc --noEmit` clean (after clearing a stale `.next/types` cache referencing an already-removed route). `npm run lint` clean. Full unit suite **8427/8437 passed** (remaining 10 are pre-existing tests that correctly require `RUN_DB_INTEGRATION=true` + real PostgreSQL — no DB-touching code was changed this pass, so these were not re-run against a live database). Production build passed with non-secret placeholder env vars.
- **Known risks:** did not re-run the full `RUN_DB_INTEGRATION=true` suite, production Playwright E2E, or a fresh screenshot capture this pass — scoped out because every change is a presentational icon/test-only diff with zero Prisma/route/gate logic touched, so the risk of a DB or rendering regression is minimal. If that judgment is wrong, the full DB-integration + E2E cycle documented in earlier entries above should be re-run before merge.
- **Next action:** await CI on `767e3b7e`. The Company Vault / Administration / global Engine dashboards route-consolidation product decision remains open and un-actioned.
- **Merge status:** not reviewed — draft, do not merge.

### 2026-07-17 15:42 UTC — Codex (GPT-5.6 Sol), dependency-state follow-up

- **Branch / PR:** `fix/post-1162-screenshot-gap-closure`; PR #1162 untouched.
- **Scope / files:** made Gemini fallback, Anthropic capacity, and OCR settings dependency-aware. Added ENABLED/DISABLED states for `PDF_OCR_ENABLED`, mirrored the runtime's Anthropic-dependent default-on/explicit-false behavior, and made OCR model/page/timeout defaults inactive when OCR cannot run. Added dependency transition tests.
- **Tests:** provider/fallback, environment reconciliation, and post-1162 suites passed (64 tests); `npx tsc --noEmit` and lint passed; production build passed with non-secret build-only placeholders and expected optional-provider/Sentry warnings.
- **Merge status:** **unsafe / not integration-ready** — remote exact-head and `ROUTING_BLOCKED_BY_DIVERGED_INTEGRATION_BASE` blockers remain.

### 2026-07-17 15:32 UTC — Codex (GPT-5.6 Sol), activation-truth follow-up

- **Branch / PR:** `fix/post-1162-screenshot-gap-closure`; PR #1162 untouched.
- **Scope / files:** made provider override states activation-aware. Registry aliases now count toward the displayed API-key state, and provider-specific base/model overrides report `INACTIVE` until the provider is usable rather than misleadingly reporting SET/DEFAULTED. Added alias-only DeepSeek and inactive/active default tests plus INACTIVE rendering coverage.
- **Tests:** provider/fallback, environment reconciliation, and post-1162 suites passed (63 tests); `npx tsc --noEmit` and lint passed; production build passed with non-secret build-only placeholders and expected optional-provider/Sentry warnings.
- **Merge status:** **unsafe / not integration-ready** — remote exact-head and `ROUTING_BLOCKED_BY_DIVERGED_INTEGRATION_BASE` blockers remain.

### 2026-07-17 15:22 UTC — Codex (GPT-5.6 Sol), registry-completeness follow-up

- **Branch / PR:** `fix/post-1162-screenshot-gap-closure`; PR #1162 untouched.
- **Scope / files:** replaced the incomplete manual provider-variable inventory in `lib/ai-environment-readiness.ts` with canonical-registry derivation. All supported key, base URL, proposal, analysis, and fast-model overrides are now reported in canonical order; registry defaults, Gemini fallbacks, and OCR defaults are explicit. Preserved OpenRouter free-model safety copy. Added uniqueness, full registry coverage, and default-parity tests.
- **Tests:** provider/fallback, environment reconciliation, and post-1162 suites passed (62 tests); `npx tsc --noEmit` and lint passed; production build passed with non-secret build-only placeholders and expected optional-provider/Sentry warnings.
- **Merge status:** **unsafe / not integration-ready** — remote exact-head and `ROUTING_BLOCKED_BY_DIVERGED_INTEGRATION_BASE` blockers remain.

### 2026-07-17 15:12 UTC — Codex (GPT-5.6 Sol), canonical-state follow-up

- **Branch / PR:** `fix/post-1162-screenshot-gap-closure`; PR #1162 untouched.
- **Scope / files:** removed purpose-copy parsing from AI readiness truth. `lib/ai-environment-readiness.ts` now emits explicit `configurationState` and `requirementLabel` fields, including explicit default metadata; `components/ai-environment-variable-status.tsx` only renders those canonical fields. Added resolver-to-renderer regression coverage.
- **Tests:** post-1162, AI-provider fallback, and screenshot-state truth suites passed (145 tests total); `npx tsc --noEmit` passed; lint passed; production build passed with non-secret build-only placeholders and expected optional-provider/Sentry warnings.
- **Merge status:** **unsafe / not integration-ready** — remote exact-head and `ROUTING_BLOCKED_BY_DIVERGED_INTEGRATION_BASE` blockers remain.

### 2026-07-17 15:02 UTC — Codex (GPT-5.6 Sol), density/truth follow-up

- **Branch / PR:** `fix/post-1162-screenshot-gap-closure`; PR #1162 untouched.
- **Scope / files:** closed the remaining F-05/F-10 presentation truth gap in `components/ai-environment-variable-status.tsx`: mobile groups now follow canonical provider order before OCR/database/auth/runtime functions, and display states distinguish SET, NOT CONFIGURED alternative providers, DEFAULTED, RECOMMENDED, OPTIONAL, and genuinely MISSING required configuration. Critical database/auth rows display as required; individual provider keys display as alternatives because readiness requires at least one provider, not every provider. Added rendered and resolver behavior coverage in `tests/post-1162-ui-truth.test.ts` and updated the finding record.
- **Tests / status:** targeted post-1162 tests 5/5 passed; `npx tsc --noEmit` passed; lint passed; production build passed with non-secret build-only placeholders and expected optional-provider/Sentry warnings. Remote, database, preview, CI, and screenshot blockers remain unchanged.
- **Merge status:** **unsafe / not integration-ready** — `ROUTING_BLOCKED_BY_DIVERGED_INTEGRATION_BASE`.

### 2026-07-17 14:48 UTC — Codex (GPT-5.6 Sol), review follow-up

- **Branch / PR:** `fix/post-1162-screenshot-gap-closure`; follow-up to draft PR metadata, PR #1162 untouched.
- **Scope / files:** hardened the AI-readiness repair by extracting `components/ai-environment-variable-status.tsx`, removing the `Object.groupBy` runtime dependency, enforcing deterministic scope order and a 44px disclosure touch target, and replacing brittle source-only readiness assertions with rendered-markup and grouping behavior tests in `tests/post-1162-ui-truth.test.ts`. Corrected F-13 from `SOLVED_BY_OPEN_PR` to `CLAIMED_BUT_NOT_PROVEN` because PR #1163's actual security boundary remains inaccessible.
- **Tests:** targeted post-1162 tests 4/4 passed; `npx tsc --noEmit` passed; lint passed; production build passed with non-secret build-only placeholders and expected optional-provider/Sentry warnings.
- **Risks / next action:** remote/CI/database/preview/screenshot blockers from the prior entry remain unchanged. Obtain authorized remote access and disposable test infrastructure, then complete exact-head evidence.
- **Merge status:** **unsafe / not integration-ready** — `ROUTING_BLOCKED_BY_DIVERGED_INTEGRATION_BASE`.

### 2026-07-17 14:36 UTC — Codex (GPT-5.6 Sol)

- **Branch / PR:** `fix/post-1162-screenshot-gap-closure`; new draft PR required after commit (PR #1162 was not touched).
- **Scope / files:** bounded post-merge source audit at `808ed4b8992647a3dec7bbd2a2a6a8aca149d800`; repaired the mobile AI-readiness presentation (`app/dashboard/admin/ai-readiness/page.tsx`), truthful proposal-document heading/empty state (`app/dashboard/documents/page.tsx`), and root-link labels (`app/not-found.tsx`, `app/error.tsx`); added `tests/post-1162-ui-truth.test.ts` and the explicit evidence/blocker record under `evidence/post-1162/808ed4b8992647a3dec7bbd2a2a6a8aca149d800/`.
- **Tests:** Prisma generation passed; targeted post-1162 tests passed (3/3); `npx tsc --noEmit` passed; lint passed; production build passed with build-only placeholder environment values and expected missing optional-provider/Sentry warnings. The first two build attempts correctly failed closed for missing required configuration. Playwright screenshot capture was attempted but blocked because no Chromium executable is installed.
- **CI / deployment:** operator-supplied production deployment `dpl_25rmPtkMEQ7D8R6SgncotgyL5ALc` is recorded but could not be independently queried. Exact-main Actions dispatch/inspection, private open-PR enumeration, artifact download, push, preview deployment, disposable-PostgreSQL validation, and authenticated screenshots are blocked: `gh` is absent, no session PAT/Vercel/test-user credentials are present, private API access returns 401, and shell GitHub access returns CONNECT 403.
- **Risks / assumptions:** this is not full post-merge completion. F-02/#1146, F-03/#1139, F-07/#1157, and F-13/#1163 remain delegated; F-14 remains a product decision; F-01 exact-main CI and F-15 integration routing remain blockers. No export/readiness/security gate was changed.
- **Next action:** provide a non-persisted fine-grained PAT plus reachable GitHub/Actions tooling and an isolated preview database/test users, then enumerate/diff all open PRs, dispatch exact-main CI, run full PostgreSQL/E2E evidence capture, reconcile routing, and attach exact-head preview proof.
- **Merge status:** **unsafe / not integration-ready** — `ROUTING_BLOCKED_BY_DIVERGED_INTEGRATION_BASE` and validation evidence is incomplete.

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
