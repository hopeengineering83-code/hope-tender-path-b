# Remediation Roadmap — 2026-07-04

Ordered, small-PR plan derived from [production-audit-2026.md](production-audit-2026.md). Constraints honored throughout: Node stays `>=22 <23`; the provider fallback order stays exactly `Z.ai → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Anthropic`; deterministic non-AI fallback is never export-eligible; no Vercel deploys/previews beyond what a normal PR push triggers; no force-push; no merges without green CI.

Every PR must ship with: changed-file list, exact tests run + results, exact head SHA, remaining known risks. Nothing is declared production-ready until the PR H release gate passes end-to-end.

---

## PR A — Fix PR #936 CI + provenance blockers (THIS BRANCH — implemented)

**Branch:** `hotfix/metadata-repair-crash-and-snapshot-consistency` (PR #936).

**Root cause of the CI failure (9 tests):** commit `7323c1cc` updated gate fixtures to the current API but left tests asserting pre-#914 semantics. The gate itself was correct and fail-closed; the tests were stale:
- 6 tests expected *generation* to be blocked by `exportReadyDocumentCount: 0` / `confirmedPlanDocumentsOk: false` — those are export/final-zip conditions by design (documents cannot exist before the first generation; requiring them would deadlock the workflow). Fixed by testing the same invariants under `purpose: "export"` / `"final-zip"` with exact blocker codes (`NO_EXPORT_READY_DOCUMENTS`, `CONFIRMED_PLAN_DOCUMENTS_INCOMPLETE`) — stronger than the old truthy asserts.
- 1 test asserted the wrong blocker code (`BUILD_PLAN_NOT_CONFIRMED` where the plan WAS confirmed → correct code is `NO_EXPORT_READY_DOCUMENTS`).
- 2 fixtures missed the fail-closed `confirmedBuildPlanItemsValid: true` field added by the K2 gate condition.
- 1 source-shape test asserted the build route still creates PLANNED rows — inverted to pin the current invariant (build route creates ZERO GeneratedDocument rows and delegates to `buildDraftBuildPlan`).

**Provenance blocker fixed (audit §6):** both AI Analyze route (`guardAiPageNumbers`) and the durable worker proved AI-claimed pages from a 20-char quote prefix, passed a normalized-string offset to `computeProvenPageNumber` (which slices the original text), and fell back to offset 0 for unfound quotes — inventing page-1 evidence. Replaced with the shared fail-closed `locateQuoteProvenPage` in `lib/engine/page-provenance.ts`: full-quote normalized match, exact normalized→original index map, null when absent, null when occurrences resolve to different pages (ambiguous), page bounds via `computeProvenPageNumber`.

**Changed files:**
- `tests/gate-safety-regression.test.ts`, `tests/persisted-submission-plan-evidence.test.ts`, `tests/route-level-gate-safety.test.ts` — stale-semantics fixes with exact blocker codes
- `lib/engine/page-provenance.ts` — `locateQuoteProvenPage` (+ `buildNormalizedIndexMap`)
- `app/api/tenders/[id]/ai-analyze/route.ts`, `lib/ai-jobs/analysis-job-service.ts` — guardPage rewired to the canonical resolver
- `tests/page-provenance-quote-location.test.ts` (NEW, 37 tests: duplicate quote across pages → ungrounded, duplicate prefix cases, offset-mapping proof, boundaryless totalPages rules, occurrence-cap, source-shape guards)
- `tests/durable-worker-grounding-guards.test.ts` — pins the new resolver and forbids the prefix/offset-0 patterns
- `docs/production-audit-2026.md`, `docs/route-authorization-matrix.md`, `docs/remediation-roadmap-2026.md`, `docs/golden-tender-benchmark-rubric.md` (NEW)

**Verification run:** targeted suites 109/109 pass; `tsc --noEmit` clean after `npm ci` + `prisma generate`; full local batched suite green except the 8 RUN_DB_INTEGRATION-gated files that require the CI Postgres service (they hard-fail by design without a DB). CI on push is the binding proof.

**Remaining risks:** none new; the fix is strictly fail-closed (pages that used to be invented now come back null → fields stay EXTRACTED_UNVERIFIED until repaired with real evidence).

---

## PR B — Shared provenance engine

**Goal (audit §6):** one library, one behavior. Create `lib/engine/provenance/` exporting: exact quote matching, normalized→original index mapping (move `buildNormalizedIndexMap` here), ambiguity detection, page-boundary detection, totalPages bounds, quote containment. Replace the duplicated logic in: `metadata-source-enrichment.ts` (own normalize/index copy), `tender-field-extractors.ts` (own `computePageNumber` copy), `metadata-source-attribution.ts`, upload-first, re-extract, repair-metadata, AI Analyze, durable worker, requirement extraction, BuildPlan gates.
**Hard rule:** no route may invent page 1 without stored `totalPages === 1` or real boundaries — enforced in exactly one function.
**Tests:** property-style suites with repeated phrases, whitespace mutations, OCR-like text, `[Page N]` markers, form feeds, missing boundaries; source-shape guard that no other module defines `computePageNumber`/`buildNormalizedIndex`.
**Risk:** behavior-neutral refactor; diff-cover with the PR A test suite.

## PR C — Security / tenant route fixes

**Targets (audit §3, §4, matrix):**
1. `proposal-versions/[versionId]` DELETE + restore → scope to `tender: { id, userId: actor.id }`; audit both delete and restore.
2. `controls/suggestions/reject` → remove the `?? findFirst({ id })` fallback.
3. `system/deep-reasoning-runs` → constrain to `actor.id` unless ADMIN.
4. `company/plan-b-import` → `requireRole("ADMIN","PROPOSAL_MANAGER")`, 10 MB body cap, JSON shape validation, imported trust capped at `AI_DRAFT`.
5. `/api/ai/health` → session-gate (or redact to a boolean readiness).
6. Decide + enforce role floors for `ai-rematch`/`copilot`/`evaluator-simulation`/`regenerate-cvs` and company bulk mutations.
**Tests:** real-Postgres cross-user route tests for every mutation above (user B on user A's ids → 404/403, zero mutation); role-floor tests; extend `e2e/cross-user-isolation.spec.ts`.

## PR D — BuildPlan / export / package invariants

**Targets (audit §9, §10, §11, §18):**
1. **Deterministic fallback export-eligibility (P0):** persist machine-readable provenance on GeneratedDocument (e.g. `generationProvenance: "AI" | "DETERMINISTIC_FALLBACK" | "PARTIAL_FALLBACK"`), set it in `generate-elite.ts` + section stitching; auto-finalize and seven-pass wiring must set `deterministicFallbackUsed` accordingly; gate blocks VALIDATED/READY_FOR_EXPORT for non-AI provenance. Stop `cleanLine` stripping fallback markers before the trace scan.
2. **Provider-chain alignment (P0):** route `generateOneSection`, `generateBenchmarkProposalWithAI`, `refineProposalWithAI`, and `tryTailFallbackProviders` through `CANONICAL_AI_PROVIDER_ORDER` (this preserves the required order — Z.ai first — rather than the legacy Gemini-first chains). Pin with a runtime-order test (stub all providers configured, assert attempt order equals the canonical array).
3. **Vocabulary unification (P1):** one validated constant set for `validationStatus` (`PASSED` vs `VALIDATED` split) — pick `VALIDATED`, migrate `PASSED` rows, update `lib/engine/validate.ts` writers and all readers.
4. Export tx unification: package supersede+create + `tender.update` + audit in one `$transaction`.
5. Concurrent-generation guard: replace dead `GENERATING/QUEUED` filters with a real in-flight lock (AiJob row or advisory lock) + 409 test for parallel POSTs.
6. Non-streaming promotion into the canonical tx (match the durable worker); repair-metadata audits after the write, in-tx.
**Tests:** deterministic-fallback-blocked e2e-of-record (unit + DB), chain-order runtime test, PASSED→VALIDATED migration test, rollback tests (fault-inject → no success audit), concurrent-generate 409.

## PR E — Generation quality benchmark harness

Per [golden-tender-benchmark-rubric.md](golden-tender-benchmark-rubric.md): fixtures under `fixtures/tenders/{sample-technical-rfp,sample-eoi,sample-financial-separated}/` + `fixtures/company/haec-sample-library/`; harness generates compliance matrix, technical proposal, financial proposal (where required), cover letter, annex list, ZIP; scores app output vs raw-prompt baselines; writes `test-results/proposal-quality-report.json`; release-gate thresholds enforced (coverage ≥95 %, zero unsupported claims / missing sections / wrong names / AI traces / package mismatches).

## PR F — Document formatting / export fidelity

DOCX structure snapshot tests (heading order, required sections, footer/header/signature block positions), placeholder/AI-trace scan on final bytes (`[INSERT]`, `TODO`, "As an AI"), PDF verification where supported, ZIP manifest = confirmed BuildPlan exactly, final package manifest with SHA-256 per file.

## PR G — Observability + e2e completion

1. Structured events: `generation.blocked`, `export.blocked`, `export.succeeded`, `build_plan.invalid`, `metadata.ungrounded`, `extraction.failed`, `provider.fallback_used` (some exist) — all with requestId, never secrets/document text; unit tests capture emission.
2. Admin diagnostics page consolidating provider health, queue health, failed jobs, extraction failures, blocker counts, release SHA (APIs already exist).
3. CI: set `E2E_GOLDEN_AUTH=true` so the golden workflow spec actually runs; add e2e for successful BuildPlan-confirm → generate → export → ZIP download; no-files and weak/corrupted-extraction UI states; axe accessibility checks on dashboard/tender-detail; keep the samsung-tablet project.
4. Schedule `/api/cron/ai-analyze-retry` (vercel.json or the drain workflow); delete the dead `cron/drain-ai-jobs.ts` helper.

## PR H — Performance / cost / data-integrity + final release gate

1. Cooldown persistence (`restoreHealthFromDbBounded`/persist) wired into `/generate`, `/ai-proposal`, `regenerate-section`, auto-finalize; registry `timeoutMs` threaded to all OpenAI-compatible callers; request-time key reads (drop the module-load Gemini cache).
2. Prisma enums or CHECK constraints for Tender.status/stage, GeneratedDocument.{generationStatus,validationStatus,reviewStatus}, AiJob.status, BuildPlan.status, TenderFile.deletionStatus (with backfill migration guarded by a failing-row check).
3. Composite indexes: Tender `(userId,status)`, `(userId,deadline)`, global `(status,deadline)` for the cron; AuditLog `(userId,createdAt)`; GeneratedDocument `(tenderId,generationStatus)`; ExportPackage `(tenderId,createdAt)`; drop the redundant TenderShare token index.
4. Implement the declared TenderFile soft-delete lifecycle (PENDING_DELETE → storage delete → DELETED; DB-first ordering; cron purge does storage cleanup) + `deletionStatus` filters at the ~15 unfiltered reader sites; deletion-lifecycle tests (ACTIVE/PENDING_DELETE/DELETED cannot feed extraction/matching/evidence/export).
5. AuditLog/AiJob retention job; per-user AI budget cap (soft warn, hard block env-tunable).
6. **Release gate** (script + CI job `release:gate`): `prisma validate` → `prisma generate` → `migrate deploy` on clean Postgres → `audit:release-integrity` → `typecheck` → `lint` → `RUN_DB_INTEGRATION=true npm test` → `build` → `test:e2e` (incl. golden) → benchmark report thresholds → 3× clean-tree checks → no deploy unless explicitly approved. (CI already runs most of this; the gate adds the benchmark + golden e2e and a single pass/fail summary.)

---

## Sequencing rationale

A unblocks CI (nothing merges before it). B is pure consolidation that D/E build on. C is independent and can land in parallel with B. D carries the two remaining P0s and must precede any release. E/F define "good output" before G's e2e proves it in-browser. H closes integrity/perf debt and owns the final gate. Do not merge any PR without: green CI at its exact head SHA, the tests listed in its section, and an updated "remaining risks" note.
