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
