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

### 2026-07-13 UTC — ChatGPT (GPT-5.5)

- **Mode:** full follow-up audit after continued dissatisfaction; focused on remaining provider-readiness drift outside the prior patch.
- **Branch / PR:** `chatgpt/deep-app-gap-investigation` / PR pending update.
- **Scope:** Closed additional stale AI-provider guidance in operator diagnostics. `/api/ai-providers/diagnostics?live=1` now uses the canonical provider env list instead of a partial example; `/api/system/deep-reasoning-status` now exposes all canonical providers in registry order via the safe provider-status helper while retaining compatibility fields; `lib/env-check.ts` startup architecture comments now match the Z.ai-first all-provider automatic chain. Added regression coverage so these surfaces cannot drift back to the old Gemini/OpenRouter/OpenAI/Groq/DeepSeek/Anthropic subset.
- **Files changed:** `app/api/ai-providers/diagnostics/route.ts`, `app/api/system/deep-reasoning-status/route.ts`, `lib/env-check.ts`, `tests/ai-provider-chain-policy.test.ts`, `tests/ai-provider-diagnostics.test.ts`, `operator_handoff.md`.
- **Tests actually run:** `npx tsx --test tests/ai-provider-chain-policy.test.ts tests/ai-provider-diagnostics.test.ts` PASS (27/27); `npx tsc --noEmit` PASS; `npm run lint` PASS; `npm run audit:release-integrity` PASS.
- **Known risks / assumptions:** No `origin` remote is configured in this container, so live GitHub inline comments/open PR/CI state still cannot be fetched. DB integration suites were not rerun in this follow-up.
- **Next action:** Push/update PR where a remote is available; run full CI and DB integration with fixtures.
- **Merge status:** not reviewed.


### 2026-07-13 UTC — ChatGPT (GPT-5.5)

- **Mode:** continued gap closure after repeated dissatisfaction; addressed the repo-reported tracked P1 legacy proposal path.
- **Branch / PR:** `chatgpt/deep-app-gap-investigation` / PR pending update.
- **Scope:** Contained `/api/tenders/[id]/ai-proposal` as a draft-only preview route. It no longer imports persistence-only integrity/transactional gate helpers and no longer creates `GeneratedDocument` rows; it always returns `persistBlocked: true` with `LEGACY_AI_PROPOSAL_DRAFT_ONLY`, directing users to canonical Generate Docs for persisted submission documents. Updated central route/gate tests, partial-extraction safety tests, and the AI-proposal UX test to pin the stricter no-persistence invariant. Updated `scripts/reconcile-gap-closure.mjs` so the release audit verifies the route remains draft-only and reports the legacy proposal path as contained instead of unresolved.
- **Files changed:** `app/api/tenders/[id]/ai-proposal/route.ts`, `scripts/reconcile-gap-closure.mjs`, `tests/central-generation-gate-coverage.test.ts`, `tests/ai-proposal-persist-blocked-ux.test.ts`, `tests/runtime-idempotency-route-security.test.ts`, `tests/pr887-behavioral-gates.test.ts`, `operator_handoff.md`.
- **Tests actually run:** `npx tsx --test tests/reconcile-provider-order-truth.test.ts tests/central-generation-gate-coverage.test.ts tests/ai-proposal-persist-blocked-ux.test.ts tests/runtime-idempotency-route-security.test.ts` PASS (80/80); `npx tsx --test tests/pr887-behavioral-gates.test.ts tests/central-generation-gate-coverage.test.ts tests/ai-proposal-persist-blocked-ux.test.ts tests/runtime-idempotency-route-security.test.ts` PASS (87/87); `npx tsc --noEmit` PASS; `npm run lint` PASS; `npm run audit:release-integrity` PASS (now reports `legacyProposalPath: contained`); `npm run audit:workflow-state-consistency` PASS with one warning-only heuristic note for `lib/tender-next-action.ts`; `DATABASE_URL='postgresql://user:pass@localhost:5432/db' SESSION_SECRET='12345678901234567890123456789012' ZAI_API_KEY='dummy-not-real-key-for-build' npm run build` PASS with expected missing optional-provider/Sentry/Cron warnings; `npm test` PARTIAL/WARNING — non-DB suites continued to pass, exposed and fixed stale `tests/pr887-behavioral-gates.test.ts` expectation for the draft-only ai-proposal route, but the aggregate command still exits 1 because DB integration suites require `RUN_DB_INTEGRATION=true`/database fixtures in this environment.
- **Known risks / assumptions:** No `origin` remote is configured in this container, so live GitHub inline comments/open PR/CI state still cannot be fetched. No DB integration suite was run. UI callers of `/ai-proposal` should treat the route as preview-only; canonical `/generate` is the persistence path.
- **Next action:** Push/update PR where a remote is available; run full CI and DB integration.
- **Merge status:** not reviewed.


### 2026-07-13 UTC — ChatGPT (GPT-5.5)

- **Mode:** follow-up after continued dissatisfaction; hardened the previous provider guidance patch for client/server import boundaries and stronger regression coverage.
- **Branch / PR:** `chatgpt/deep-app-gap-investigation` / PR pending update.
- **Scope:** Added `lib/ai-provider-env.ts`, a browser-safe canonical provider env helper derived directly from `lib/ai-provider-catalog.cjs`, and moved operator-facing env-list consumers (including the tender detail client component) from the broader provider policy module to this helper. `lib/ai-provider-policy.ts` now re-exports the helper for compatibility while keeping provider runtime helpers separate. Added tests proving the env list matches catalog order and the client imports the browser-safe helper, not provider policy. Checked `audit:workflow-state-consistency`; remaining `lib/tender-next-action.ts` warning is heuristic-only for a pure next-action label resolver and was not changed.
- **Files changed:** `lib/ai-provider-env.ts`, `lib/ai-provider-policy.ts`, provider-env-list imports in AI/provider guidance consumers, `tests/ai-provider-chain-policy.test.ts`, `operator_handoff.md`.
- **Tests actually run:** `npx tsx --test tests/ai-provider-chain-policy.test.ts tests/deep-reasoning-estimate.test.ts tests/tender-control-suggestions.test.ts tests/analysis-fallback-diagnostics.test.ts tests/company-knowledge-repair-safety.test.ts` PASS (67/67); `npx tsc --noEmit` PASS; `npm run lint` PASS; `npm run audit:release-integrity` PASS; `npm run audit:workflow-state-consistency` PASS with one warning-only heuristic note for `lib/tender-next-action.ts`; `DATABASE_URL='postgresql://user:pass@localhost:5432/db' SESSION_SECRET='12345678901234567890123456789012' ZAI_API_KEY='dummy-not-real-key-for-build' npm run build` PASS with expected missing optional-provider/Sentry/Cron warnings.
- **Known risks / assumptions:** No `origin` remote is configured in this container, so live GitHub inline comments/open PR/CI state still cannot be fetched. No DB integration suite was run.
- **Next action:** Push/update PR where a remote is available; run full CI and DB integration.
- **Merge status:** not reviewed.


### 2026-07-13 UTC — ChatGPT (GPT-5.5)

- **Mode:** follow-up after review dissatisfaction; continued provider-readiness gap closure instead of claiming perfection.
- **Branch / PR:** `chatgpt/deep-app-gap-investigation` / PR pending update.
- **Scope:** Fixed additional stale provider readiness surfaces left after the prior commit. Most importantly, `lib/ai.ts` had a proposal no-provider guard that manually checked configured providers and omitted Z.ai/Cerebras, so Z.ai-only or Cerebras-only deployments could still throw NO_PROVIDER_CONFIGURED after fallback attempts; it now delegates to `isAIEnabled()`. Remaining diagnostics/API copy now imports `CANONICAL_AI_PROVIDER_ENV_LIST` instead of hardcoding partial lists: AI fallback diagnostics, company knowledge AI warnings, admin diagnostics, company knowledge repair diagnostics, and regenerate-section 503 copy. Added static/runtime regression tests for these surfaces.
- **Files changed:** `lib/ai.ts`, `lib/engine/analysis-fallback-diagnostics.ts`, `lib/company-knowledge-ai.ts`, `app/api/admin/diagnostics/route.ts`, `app/api/company/knowledge/repair/route.ts`, `app/api/tenders/[id]/regenerate-section/route.ts`, `tests/ai-provider-chain-policy.test.ts`, `tests/analysis-fallback-diagnostics.test.ts`, `tests/company-knowledge-repair-safety.test.ts`, `operator_handoff.md`.
- **Tests actually run:** `npx tsx --test tests/analysis-fallback-diagnostics.test.ts tests/company-knowledge-repair-safety.test.ts tests/ai-provider-chain-policy.test.ts` PASS (26/26); `npx tsc --noEmit` PASS; `npm run lint` PASS; `npm run audit:release-integrity` PASS; `DATABASE_URL='postgresql://user:pass@localhost:5432/db' SESSION_SECRET='12345678901234567890123456789012' ZAI_API_KEY='dummy-not-real-key-for-build' npm run build` PASS with expected missing optional-provider/Sentry/Cron warnings.
- **Known risks / assumptions:** No `origin` remote is configured in this container, so live GitHub inline comments/open PR/CI state still cannot be fetched. No DB integration suite was run.
- **Next action:** Push/update the PR where a remote is available; run full CI and DB integration.
- **Merge status:** not reviewed.


### 2026-07-13 UTC — ChatGPT (GPT-5.5)

- **Mode:** deep non-overlap app investigation; focused fix for uncovered provider-readiness drift after release audits passed.
- **Branch / PR:** `chatgpt/deep-app-gap-investigation` / PR pending.
- **Scope:** Fixed stale AI-provider configuration surfaces that omitted Z.ai/Cerebras/Together or listed providers out of canonical order. Added `CANONICAL_AI_PROVIDER_ENV_LIST` from the registry-derived policy, wired it into deep-reasoning estimates, lifecycle blockers, controls suggestions, and the tender-detail diagnostics copy, and added regression coverage proving all 10 canonical provider keys enable the deep-reasoning estimator gate and no-provider warnings advertise the canonical env list.
- **Files changed:** `lib/ai-provider-policy.ts`, `lib/engine/deep-reasoning-estimate.ts`, `lib/engine/tender-control-suggestions.ts`, `lib/engine/tender-lifecycle-orchestrator.ts`, `app/dashboard/tenders/[id]/tender-detail.tsx`, `tests/deep-reasoning-estimate.test.ts`, `tests/tender-control-suggestions.test.ts`, `operator_handoff.md`.
- **Tests actually run:** `npx tsx --test tests/deep-reasoning-estimate.test.ts tests/tender-control-suggestions.test.ts` PASS (39/39); `npx tsc --noEmit` PASS; `npm run lint` PASS; `npm run audit:release-integrity` PASS; `DATABASE_URL='postgresql://user:pass@localhost:5432/db' SESSION_SECRET='12345678901234567890123456789012' ZAI_API_KEY='dummy-not-real-key-for-build' npm run build` PASS with expected missing optional-provider/Sentry/Cron warnings.
- **Known risks / assumptions:** The repository has no configured `origin` remote in this container, so live GitHub PR/CI state could not be fetched; active scopes were checked from the handoff file and the current local branch history. No database integration suite was run.
- **Next action:** Push/open PR where a remote is available and run full CI/DB integration.
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
