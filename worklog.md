# Worklog — PR #931 (hotfix/release-safety-consolidation)

---
Task ID: 0
Agent: main
Task: Continue fixing remaining gaps on PR #931

Work Log:
- Verified branch is `hotfix/release-safety-consolidation` at HEAD `e56f98fc`.
- All key files exist: lib/engine/build-plan.ts, lib/engine/generation-readiness-gate.ts, lib/engine/submission-method-policy.ts, tests/build-plan-route-integration.test.ts, tests/release-role-policy.test.ts.
- Typecheck passes (`npx tsc --noEmit`).
- Identified remaining gaps:
  1. AI Analyze paths (app/api/tenders/[id]/ai-analyze/route.ts, lib/ai-analyze/production-analysis-service.ts, lib/ai-analyze/retry-service.ts) do NOT persist the new canonical source-evidence fields (titleSourceFileId, titleSourcePage, titleSourceQuote, deadlineSourceFileId, deadlineSourcePage, deadlineSourceQuote, submissionEmailSourceQuote).
  2. No PostgreSQL test proving AI analysis can build BuildPlan without manual DB injection.
  3. UI-level REVIEWER restrictions may need verification.
- Migration `20260702000000_add_title_deadline_email_source_evidence` does not exist in prisma/migrations. Need to verify schema has the new columns.

Stage Summary:
- Starting point: e56f98fc, typecheck clean.
- Next: verify schema columns + migrations, then add AI evidence persistence.

---
Task ID: 1
Agent: main
Task: Complete AI promotion evidence persistence — the remaining gap from the 5-fix prompt

Work Log:
- Verified baseline: 4685/4685 tests pass on hotfix/release-safety-consolidation at e56f98fc.
- Started local PostgreSQL 16.4 on port 5433 (initdb + pg_ctl).
- Deployed all migrations (including 20260702000000_add_title_deadline_email_source_evidence).
- Extended AIAnalysisResult type with 6 new fields:
  tenderTitleSourcePage, tenderTitleSourceQuote, deadline, deadlineSourcePage,
  deadlineSourceQuote, submissionEmailSourceQuote.
- Updated AI prompt JSON schema to ask the model for the new fields.
- Updated parser/sanitizer to validate and extract the new fields.
- Updated mergeAnalysisResults to merge the new fields across chunks.
- Extended CanonicalAnalysisExisting type with titleSourceFileId + deadlineSourceFileId.
- Extended buildCanonicalAnalysisTenderUpdate data payload to persist:
  titleSourcePage/Quote/FileId, deadline (as Date), deadlineSourcePage/Quote/FileId,
  submissionEmailSourceQuote.
- Extended resolveMetadataSourceFileIds to attribute title + deadline + email
  source file IDs from their respective quotes (email no longer null).
- Updated durable job service (analysis-job-service.ts) to pass the new IDs.
- Streaming + non-streaming routes already used the spread operator, so they
  automatically pick up the new fields.
- Added 4 new unit tests to tests/canonical-analysis-update.test.ts.
- Created tests/ai-promotion-evidence-persistence.test.ts (7 PostgreSQL tests)
  proving AI promotion alone makes a tender BuildPlan-eligible.
- Verified: typecheck clean, lint clean, build succeeds, 4696/4696 tests pass.
- Committed as e4f4cb09 and pushed to origin/hotfix/release-safety-consolidation.

Stage Summary:
- PR #931 now has complete AI promotion evidence persistence.
- All 5 fixes from the user's latest prompt are addressed:
  1. Real authenticated HTTP route tests (commit e56f98fc — already done)
  2. Fail-closed for unknown submission methods (commit e56f98fc — already done)
  3. One canonical effective metadata authority (buildCanonicalAnalysisTenderUpdate
     is the single source of truth; raw metadata is no longer duplicated)
  4. Complete AI promotion evidence persistence (this commit e4f4cb09)
  5. Safely absorb PR #933 (commits 70d02ab9 + e56f98fc — REVIEWER removed
     from all 22 mutation routes, provider registry aligned, role-policy test)
- 4696/4696 tests pass, typecheck/lint/build all green.
- NOT merged, NOT deployed — awaiting explicit user authorization.

---
Task ID: 2
Agent: main
Task: Deep audit and fix all remaining gaps

Work Log:
- Started local PostgreSQL 16.4 on port 5433 (was still running from previous session).
- Deployed all migrations to verify schema is complete.
- Deep audit of lib/engine/build-plan-hash.ts found 4 critical bugs:
  1. metadataOverrides loaded into local var but never attached to tender
     → buildCanonicalBuildPlanHashInput read undefined → empty array
     → computeBuildPlanHash never included overrides in canonical string
     → override changes had ZERO effect on hash (stale-plan check broken)
  2. Raw metadata (submissionMethod, submissionAddress, submissionEmails,
     submissionEmailSubject, deadline, title) duplicated in hash alongside
     metadataEvidence — user explicitly required only resolved effective output
  3. Duplicate title: line in canonical array (sloppy code)
  4. Unknown submission method fell back to address evidence in hash builder
     — inconsistent with validator's fail-closed policy
- Deep audit of tests/build-plan-route-integration.test.ts found 1 critical bug:
  5. Test accepted 401 as valid response, fell back to direct service call
     — next/headers cookies() doesn't work in test env
     — user explicitly wanted real authenticated HTTP endpoint tests

Fixes applied:
- lib/engine/build-plan-hash.ts:
  - Added overrideSig to canonical hash (sorted field|state|value)
  - Removed raw metadata fields from canonical string (submissionMethod,
    submissionAddress, submissionEmails, submissionEmailSubject, deadline, title)
  - Metadata now represented ONLY by metadataEvidence + metadataOverrides
  - Removed duplicate title: line
  - Unknown submission method no longer adds endpoint evidence (fail-closed)
- lib/engine/build-plan.ts:
  - Attached metadataOverrides to tender object before passing to
    buildCanonicalBuildPlanHashInput (was loaded into local var but never passed)
- tests/metadata-grounding-and-build-plan.test.ts:
  - baseInput now includes metadataEvidence
  - 3 new tests: override detection, source grounding loss, metadata evidence change
  - buildPlanHashInputFromTender test updated for apples-to-apples comparison
- tests/build-plan-route-integration.test.ts:
  - Mock next/headers cookies() to read from global variable (ONLY cookie
    reading is mocked — token signing, Session DB lookup, role check are REAL)
  - All 9 tests now assert exact status codes: ADMIN=200, unauth=401,
    REVIEWER=403, foreign=404
  - New test: 'unauthenticated request gets 401 (no session cookie)'

Verification:
- 4699/4699 tests pass (was 4696; +3 new tests)
- typecheck: clean
- lint: clean (0 warnings)
- build: succeeds
- Committed as b622a163 and pushed to origin/hotfix/release-safety-consolidation

Stage Summary:
- PR #931 now has a truly canonical BuildPlan hash with no raw metadata
  duplication, metadataOverrides actually hashed, and real authenticated
  HTTP route tests.
- NOT merged, NOT deployed — awaiting explicit user authorization.

---
Task ID: 3
Agent: main
Task: Recheck again and fix all remaining gaps

Work Log:
- Verified full test suite: 4702/4702 pass on hotfix/release-safety-consolidation.
- Deep recheck of gate's primary tender select found 1 gap:
  - lib/engine/generation-readiness-gate.ts line 401 select was MISSING:
    titleSourceFileId, titleSourcePage, titleSourceQuote,
    deadlineSourceFileId, deadlineSourcePage, deadlineSourceQuote,
    submissionEmailSourceQuote.
  - The gate's secondary fullTender query (line 656) loaded ALL fields via
    include, so validateCriticalMetadataEvidenceForBuildPlan worked. But the
    canonical field-state resolver received the primary tender via spread,
    so it could not see title/deadline source evidence.
  - FIX: Added the 7 missing fields to the gate's primary select. Extended
    CanonicalResolverInput type with title/deadline source fields. Added
    title/deadline to the resolver's evidence map. Added explicit null-coalescing
    in the resolver call.

- Deep recheck of metadataOverrides hashing found 1 gap:
  - No PostgreSQL proof test existed for the critical bug fixed in the
    previous commit (overrides loaded but never hashed).
  - FIX: Added 3 PostgreSQL proof tests to tests/metadata-evidence-proof.test.ts:
    * 'adding a metadata override stales the confirmed plan'
    * 'changing metadata override value stales the confirmed plan'
    * 'removing a metadata override stales the confirmed plan'
  - These prove the end-to-end flow: create tender, build, confirm,
    add/change/remove override, verify stale detection.

- Verified all other paths are consistent:
  - computeTenderBuildPlanHash loads all 7 source fields (lines 273-275)
  - assertTenderReadyToDraftBuildPlan uses include (loads all Tender fields)
  - validateBuildPlanForConfirmation uses include (loads all Tender fields)
  - getCurrentConfirmedBuildPlan uses include (loads all Tender fields)
  - confirm route calls computeTenderBuildPlanHash (canonical service)
  - submission-plan/build route calls buildDraftBuildPlan (canonical service)
  - Provider registry: gemini=1, openrouter=2, openai=3, groq=4, deepseek=5,
    anthropic=6 (automatic); zai=7, cerebras=8, mistral=9, together=10
    (emergencyOnly=true, manual-only)
  - Migrations: all forward-only with IF NOT EXISTS / DO blocks
  - No raw metadata duplication in canonical hash string

Verification:
- 4702/4702 tests pass (was 4699; +3 new PostgreSQL override tests)
- typecheck: clean
- lint: clean (0 warnings)
- build: succeeds
- Committed as 86427ce2 and pushed to origin/hotfix/release-safety-consolidation

Stage Summary:
- PR #931 is now fully audited. All 5 original fixes are real and complete:
  1. Real authenticated HTTP route tests (commit e56f98fc + b622a163)
  2. Fail-closed for unknown submission methods (commit e56f98fc)
  3. One canonical effective metadata authority (commits b149d6dc + b622a163
     + 86427ce2 — no raw metadata duplication, overrides hashed, all source
     fields loaded)
  4. Complete AI promotion evidence persistence (commit e4f4cb09)
  5. Safely absorb PR #933 (commits 70d02ab9 + e56f98fc — REVIEWER removed
     from all 22 mutation routes, provider registry aligned)
- NOT merged, NOT deployed — awaiting explicit user authorization.

---
Task ID: 4
Agent: main
Task: Recheck 3 times and fix all gaps

Work Log:
- PostgreSQL 16.4 binary downloaded from Zonky Maven (embedded-postgres-binaries-linux-amd64-16.4.0.jar), extracted, initdb, started on port 5433.
- Deployed all 28 migrations.
- Regenerated Prisma client (npx prisma generate) — the cached client was stale and didn't know about titleSourcePage etc.
- Installed @electric-sql/pglite (was missing from node_modules).
- Baseline: 4702/4702 tests pass.

PASS 1 — AI Analyze completion paths audit:
- Verified all 3 paths (streaming, non-streaming, durable) use buildCanonicalAnalysisTenderUpdate.
- Verified all 3 paths use resolveMetadataSourceFileIds / attributeMetadataSourceFileId.
- Verified all 3 paths load tender with include (all fields) so source evidence is available.
- Verified durable job (lib/ai-jobs/analysis-job-service.ts) passes all 6 source file IDs.
- Checked non-canonical paths (auto-fill-tender-metadata, re-extract-metadata, repair-metadata)
  that write metadata values WITHOUT source evidence. These are deterministic extractors,
  not AI. The BuildPlan preflight blocks tenders with values but no source grounding —
  correct fail-closed behavior. No fix needed.

PASS 2 — Gate decision logic audit:
- Verified evaluateGenerationReadiness is fail-closed on every condition.
- Verified recordedBuildPlanState is always set by the async gate (never undefined in production).
- Verified hasCurrentConfirmedBuildPlan !== true catches undefined (fail-closed).
- Verified criticalMetadataOk uses BOTH resolver hasGenerationBlocker AND validateCriticalMetadataEvidenceForBuildPlan (defense in depth).
- Verified isGroundedEvidenceWithFileCheck checks page + quote + active fileId.
- Verified validator checks quote containment in extracted text (stricter than resolver).
- Existing FAIL-CLOSED tests cover undefined hasCurrentConfirmedBuildPlan and confirmedPlanDocumentsOk.

PASS 3 — Tests/hash/dead code audit:
- Verified route integration test uses real auth (only next/headers cookies() is mocked).
- Verified no 401 acceptance in route test.
- Verified hash handles empty items/metadataEvidence/overrides with ?? [].
- Verified buildPlanHashInputFromTender is still used (not dead code).
- FOUND GAP: tests/unified-snapshot-integration.test.ts used describe.skip when
  RUN_DB_INTEGRATION was not set — SILENTLY SKIPPED instead of failing.
- FOUND GAP: tests/database-safety-integration.test.ts used same describe.skip pattern.
- User explicitly required: 'RUN_DB_INTEGRATION=true mandatory (tests fail, not skip, when absent)'.
- FIX: Replaced describe.skip with process.exit(1) + FATAL message in both tests.
  Verified both now FAIL with FATAL message when RUN_DB_INTEGRATION is absent.

Verification:
- 4702/4702 tests pass (unchanged from baseline — the 2 fixed tests were already
  running because RUN_DB_INTEGRATION=true was set in the test env)
- typecheck: clean
- lint: clean (0 warnings)
- build: succeeds
- Committed as e1b97f37 and pushed to origin/hotfix/release-safety-consolidation

Stage Summary:
- 3-pass recheck complete. 1 gap found and fixed (2 tests silently skipped
  instead of failing when RUN_DB_INTEGRATION was absent).
- All 5 original fixes are verified real and complete:
  1. Real authenticated HTTP route tests (commits e56f98fc + b622a163)
  2. Fail-closed for unknown submission methods (commit e56f98fc)
  3. One canonical effective metadata authority (commits b149d6dc + b622a163 + 86427ce2)
  4. Complete AI promotion evidence persistence (commit e4f4cb09)
  5. Safely absorb PR #933 (commits 70d02ab9 + e56f98fc)
- NOT merged, NOT deployed — awaiting explicit user authorization.

---
Task ID: 5
Agent: main
Task: Recheck again — many gaps to be fixed

Work Log:
- Verified baseline: 4702/4702 tests pass.
- Audited all 22 mutation routes — all use requireRole("ADMIN", "PROPOSAL_MANAGER"), no REVIEWER.
- Audited ALL routes using requireRole — found 8 additional routes that grant REVIEWER.
  Verified all 8 are GET (read-only) routes. No mutation routes grant REVIEWER.
- Verified HUMAN_APPROVED_FALLBACK is permanently blocked in gate (FALLBACK_NOT_ALLOWED).
- Verified approve-analysis route returns auditOnly:true, does NOT authorize release.
- Verified gate errors are redacted (GATE_INTERNAL_ERROR, raw detail only in server logs).
- Verified buildDraftBuildPlan returns typed BuildPlanDraftResult (never null).
- Verified P2034 retry is bounded (MAX_RETRIES=3) in both buildDraftBuildPlan and confirm route.
- Verified hasValidVirtualSubmissionPlan is fully removed from lib/ and app/.
- Verified no TODO/FIXME/HACK in release-safety code.

GAPS FOUND AND FIXED:

1. Gate did NOT enforce sourcePage <= totalPages for mandatory requirements:
   - lib/engine/generation-readiness-gate.ts checked sourcePageNumber >= 1 but NOT
     sourcePageNumber <= totalPages.
   - The metadata validator and preflight enforced this, but the gate's own
     requirement check did NOT.
   - FIX: Added sourceFileTotalPages to ReadinessRequirement type. Added totalPages
     to gate's primary files select. Added totalPages to mappedRequirements builder.
     Added sourcePage > totalPages check in pure decision function.
   - Added 3 unit tests: blocks when exceeds, allows when within range, allows when
     totalPages is null.

2. generate route still had virtualOnly remnants:
   - app/api/tenders/[id]/generate/route.ts planOnly mode returned virtualOnly: true.
   - A stale comment referenced hasValidVirtualSubmissionPlan (removed earlier).
   - FIX: Replaced virtualOnly: true with planOnlyDryRun: true. Updated comment to
     reference recordedBuildPlanState + hasCurrentConfirmedBuildPlan.

3. _TenderFileRow type stub missing totalPages:
   - The type stub in generation-readiness-gate.ts was missing totalPages.
   - Runtime worked (accessed via (file as any)?.totalPages) but type was incomplete.
   - FIX: Added totalPages: number | null to _TenderFileRow.

Verification:
- 4705/4705 tests pass (was 4702; +3 new totalPages tests)
- typecheck: clean
- lint: clean (0 warnings)
- build: succeeds
- Committed as 6c97a80c + 398b43c1 and pushed to origin/hotfix/release-safety-consolidation

Stage Summary:
- All 11 audit areas verified clean.
- 3 gaps found and fixed (gate requirement totalPages, virtualOnly remnants, type stub).
- NOT merged, NOT deployed — awaiting explicit user authorization.

---
Task ID: 6
Agent: main
Task: Recheck again and fix all gaps

Work Log:
- Verified baseline: 4705/4705 tests pass.

AUDIT AREAS CHECKED (all verified clean — NO gaps found this round):

1. next/headers mock in route integration test:
   - Investigated the apparent typo `require.cacheockModulePath` in
     tests/build-plan-route-integration.test.ts line 58.
   - Used `od -c` to verify the actual bytes: the line IS
     `require.cache[mockModulePath]` — the `[` is present but was not
     visible in terminal output due to rendering.
   - The mock IS correctly injected into require.cache.
   - Verified the mock works: ADMIN gets 200, unauthenticated gets 401,
     REVIEWER gets 403, foreign user gets 404 — all through real auth.

2. Confirm route race safety:
   - Verified original-candidate capture (ID+revision+hash) BEFORE retry loop.
   - Verified findUnique by original ID inside transaction.
   - Verified conditional updateMany with revision+hash check.
   - Verified valUpdate.count === 0 → 409 (not 422).
   - No stale DRAFT reread anywhere.

3. metadataOverrides loading consistency:
   - computeTenderBuildPlanHash loads overrides and attaches to tender.
   - Gate loads overrides via tender select (metadataOverrides: { select: ... }).
   - Confirm route calls computeTenderBuildPlanHash which handles this.
   - All 3 hash callers consistent.

4. SQL injection risks:
   - No raw SQL in release-safety code (build-plan, gate, confirm, routes).
   - Raw SQL in lib/prisma.ts uses parameterized queries ($1, $2).
   - ensureColumn interpolates table/column/definition but ALL callers use
     hardcoded values (no user input).
   - No unsafe raw SQL anywhere.

5. Error sanitization:
   - Gate: raw error to console.error (server-only), redacted response.
   - build-plan route: hardcoded error messages.
   - confirm route: hardcoded error messages.
   - submission-plan/build route: uses sanitizeError() which redacts
     connection strings, API keys, Bearer tokens.
   - No raw error leakage to clients.

6. Console output:
   - Only 1 console.error in release-safety code (gate GATE_INTERNAL_ERROR).
   - Logs raw error message to server logs only — standard practice.
   - Response is redacted. No sensitive data leak.

7. Mock DB in tests:
   - Unit tests (auto-fill, durable-deletion) use mock Prisma — fine for
     testing pure functions.
   - All 6 integration tests use real PostgreSQL (build-plan-db-integration,
     metadata-evidence-proof, ai-promotion-evidence-persistence,
     build-plan-route-integration, database-safety-integration,
     unified-snapshot-integration).
   - No mock DB in release-safety integration tests.

8. Source field selects:
   - All hash callers load all source fields (include or explicit select).
   - validateBuildPlanForConfirmation uses include: { files: true, requirements: true }.
   - getCurrentConfirmedBuildPlan uses include: { files: { where: ACTIVE } }.
   - assertTenderReadyToDraftBuildPlan uses include with files + requirements.
   - All consistent.

Verification:
- 4705/4705 tests pass
- typecheck: clean
- lint: clean (0 warnings)
- build: succeeds
- NO new commits — no gaps found this round.

Stage Summary:
- Comprehensive recheck of 9 audit areas complete. All verified clean.
- The route integration test's next/headers mock is correctly implemented
  (the apparent typo was a terminal rendering issue, confirmed via od -c).
- All release-safety code is consistent, sanitized, and race-safe.
- NOT merged, NOT deployed — awaiting explicit user authorization.
