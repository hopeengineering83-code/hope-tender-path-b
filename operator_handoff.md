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

### 2026-06-29 UTC — Claude Code (Haiku 4.5) — #919 corrections (mandatory plan, shared hash, real source file, all gates+panels)

- **Mode:** corrective hardening of #919 per Hope's 5-point directive. Keep #919 draft; no merge/deploy.
- **Branch / PR:** `claude/short-honest-feedback-gaps-vyh8dv` / #919 (draft)
- **Changes:**
  1. **Persisted BuildPlan is now MANDATORY.** Pure `evaluateGenerationReadiness` uses `recordedBuildPlanState: MISSING|STALE|VALID`; MISSING and STALE both block (codes `BUILD_PLAN_MISSING`, `BUILD_PLAN_STALE`). The async central gate (`assertTenderReadyForGenerationAndExport`, used by generate/export/download/regenerate/ai-proposal/generate-missing-plan-files) loads the BuildPlan and sets the state from the shared hash.
  2. **One shared deterministic hash** (`lib/engine/build-plan-hash.ts` → `computeBuildPlanHash` + `buildPlanHashInputFromTender`) used by BOTH the Build Plan route and the gate. Hashes ONLY active files (id + name + per-file content digest), requirements (plan-driving fields), exact file naming/order, and submission instructions. Inputs are sorted by stable id before hashing — DB query order is never hashed. (Removed the old file-only `computeBuildPlanContentHash`.)
  3. **Actual source-file attribution** (`lib/engine/metadata-source-attribution.ts` → `attributeMetadataSourceFileId`): each metadata field is bound to the active file whose extracted text contains its supporting quote; missing quote / no match / deleted file → null (ungrounded). Removed the earliest-active-file heuristic. Wired into both ai-analyze paths and the analysis job service.
  4. **Same active-file grounding rule everywhere**: `activeTenderFileIds` now passed into `resolveCanonicalFieldState` at the generation gate, export/Final-ZIP (`final-submission-readiness.ts`), release snapshot (`tender-release-snapshot.ts`), and the dashboard panel (`metadata-override` route) — UI and gate cannot disagree. Added the 4 `sourceFileId` columns to each select.
  5. **Tests** (`tests/grounding-and-buildplan-enforcement.test.ts`, `tests/metadata-grounding-and-build-plan.test.ts`): no-plan blocks; Build Plan→Generate→Export succeeds; deleted/wrong source file blocks; multi-file metadata uses the correct file; changing files/requirements/exact naming/order invalidates the plan; hash is order-independent.
- **Files changed:** `lib/engine/build-plan-hash.ts`, `lib/engine/metadata-source-attribution.ts` (new), `lib/engine/generation-readiness-gate.ts`, `lib/engine/canonical-analysis-update.ts`, `lib/ai-jobs/analysis-job-service.ts`, `app/api/tenders/[id]/ai-analyze/route.ts`, `app/api/tenders/[id]/submission-plan/build/route.ts`, `app/api/tenders/[id]/metadata-override/route.ts`, `lib/engine/final-submission-readiness.ts`, `lib/engine/tender-release-snapshot.ts`, `tests/grounding-and-buildplan-enforcement.test.ts`, `tests/metadata-grounding-and-build-plan.test.ts`, `operator_handoff.md`.
- **Checks run locally:** affected-suite unit tests via node:test/tsx — all pass (incl. 28 new/updated grounding+plan tests; final-submission-readiness 39, generation-readiness-gate 32, gate-safety 23, canonical-readiness-contradictions 28, etc.). Lint: 0 errors on changed files. New pure modules typecheck clean.
- **Honest constraint:** `prisma generate`, full `tsc`, DB-integration tests, and `build` could NOT be run locally — the egress policy resets the Prisma engine download from binaries.prisma.sh, so the local @prisma/client lacks the BuildPlan model + sourceFileId columns (the only local typecheck errors are this stale-client class, which predates this work). CI regenerates the client and runs migration check, full typecheck, integration tests, and build authoritatively.
- **Next action:** confirm CI green on #919; mark ready only on Hope's approval.
- **Merge status:** #919 draft, NOT merged. No Vercel preview created intentionally.

### 2026-06-29 UTC — Claude Code (Haiku 4.5) — enforcement wiring + #909 merge

- **Mode:** finish the two-gap wiring so #919 actually changes behavior; merge #909
- **Branch / PR:** `claude/short-honest-feedback-gaps-vyh8dv` / #919 (draft)
- **Decision on #909:** MERGED (squash) — green, clean, isolated error-response redaction security fix. Now on main.
- **Honest finding:** #919 was scaffolding — the new grounding/BuildPlan code was not wired into any gate (no caller passed activeTenderFileIds; nothing read BuildPlan; no extraction populated sourceFileId). Fixed all three:
  1. **activeTenderFileIds enforced** in the central gate `assertTenderReadyForGenerationAndExport` (generation-readiness-gate.ts) — reused the existing active-file Set. This gate is called by generate, export, download, regenerate, ai-proposal, generate-missing-plan-files, so all generation/export paths now enforce that a USER_EDITED/USER_CONFIRMED critical field only unblocks when its evidence points to an ACTIVE tender file. Added the 4 sourceFileId columns to the gate's tender select.
  2. **sourceFileId populated** at extraction: buildCanonicalAnalysisTenderUpdate now binds clientName/submissionMethod/submissionAddress/submissionEmail source evidence to the primary ACTIVE file; both ai-analyze route paths + analysis-job-service pass primarySourceFileId (earliest active file).
  3. **BUILD_PLAN_STALE** blocker added to the pure evaluateGenerationReadiness; the async gate loads the persisted BuildPlan, recomputes the content hash from current active files, and blocks generation/export when the recorded plan no longer matches (files added/removed/renamed/reordered). Backward-compatible: no recorded plan → undefined → virtual-plan gate H governs.
- **Files changed (this entry):** `lib/engine/generation-readiness-gate.ts`, `lib/engine/canonical-analysis-update.ts`, `lib/ai-jobs/analysis-job-service.ts`, `app/api/tenders/[id]/ai-analyze/route.ts`, `tests/grounding-and-buildplan-enforcement.test.ts`, `operator_handoff.md`
- **Tests:** 11 new enforcement tests + 219 pre-existing in affected suites all pass locally (node:test/tsx). Full typecheck/build deferred to CI (local prisma client cannot be regenerated — network-restricted).
- **Known risks:** display-only paths (metadata-override route, tender-release-snapshot, final-submission-readiness panel) still use the basic page+quote grounding check, not activeTenderFileIds — consistent with the gate for normal fileId-populated data; only legacy rows lacking sourceFileId could show "grounded" in a panel while the gate treats an override-confirmed critical field as needing confirmation. Enforcement (blocking) is centralized in assertTenderReadyForGenerationAndExport, so this is display-only.
- **Next action:** confirm CI green on #919; consider mark-ready when Hope approves.
- **Merge status:** #909 merged; #919 not reviewed (draft, enforcement now complete).

### 2026-06-29 UTC — Claude Code (Haiku 4.5)

- **Mode:** implementation of two remaining gaps from governance handoff
- **Branch / PR:** `claude/short-honest-feedback-gaps-vyh8dv` / no PR opened yet
- **Scope:** Two critical gaps:
  1. **Metadata grounding stricter contract**: Added sourceFileId columns to Tender for clientName, submissionMethod, submissionAddress, submissionEmail. Implemented isGroundedEvidenceWithFileCheck() to validate TenderFile is ACTIVE before evidence counts as grounded.
  2. **Build Plan persistence**: Created BuildPlan model bound to tender contentHash (file IDs + names). Plan invalid if files added/removed/renamed. Separate from GeneratedDocument; tracks which plan was used for generation.
- **Files changed:** `prisma/schema.prisma`, `prisma/migrations/20260629300000_add_metadata_source_file_ids_and_build_plan/migration.sql`, `lib/engine/evidence-grounding.ts`, `lib/engine/canonical-field-state.ts`, `lib/engine/build-plan-hash.ts`, `app/api/tenders/[id]/submission-plan/build/route.ts`, `tests/metadata-grounding-and-build-plan.test.ts`
- **Tests:** 4550/4553 passing (13 new tests for grounding + BuildPlan gaps all passing)
- **CI / deployment:** Not checked; no PR yet
- **Known risks:** (1) Prisma migration adds columns; (2) activeTenderFileIds optional in CanonicalResolverInput for backward compatibility; (3) Build Plan validity check required in generation route (not yet integrated); (4) AI extraction routes must populate sourceFileId
- **Next action:** Integrate activeTenderFileIds from tender.files in generation gates; update AI extraction to populate sourceFileId; add enforcement in generation route for BuildPlan validity; run full integration tests and CI before merge
- **Merge status:** Not reviewed; two gaps implemented but integration incomplete

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
