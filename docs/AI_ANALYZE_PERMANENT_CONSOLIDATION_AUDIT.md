# AI Analyze Permanent Consolidation — Phase 0 Audit

**Date:** 2026-06-21  
**Session:** https://claude.ai/code/session_014Qzj6XnxmcYa2HBzK72uz2  
**Branch:** `claude/optimistic-allen-ajgssl`

---

## Executive Summary

This document records the baseline state of the codebase before implementing a comprehensive permanent consolidation of the AI Analyze workflow. The audit captures:

1. **Current repository state** (SHAs, branch status)
2. **Fixed issues** (TypeScript errors, build blockers)
3. **Call graphs and state writers** (authorization model)
4. **Affected files** (comprehensive inventory)
5. **Release-readiness blockers** (known issues requiring fixes)
6. **Implementation roadmap** (10-phase consolidation plan)

---

## 1. Repository State

### Current Branch Status
- **Active Branch:** `claude/optimistic-allen-ajgssl`
- **Latest Commit:** `f52d8090` (fix: remove duplicate restoreProviderHealthBeforeResponse function)
- **Main Branch:** `d96c8ccb` (fix: unify AI analysis truth — additive modular resolvers, provider health, workflow center)

### Recent Commit History
```
f52d8090 fix: remove duplicate restoreProviderHealthBeforeResponse function
88f1d318 Fix TypeScript error: use valid AuditAction type
2ef7e2ad Fix AI provider health and status logic — all tests green
d8fe6cc3 fix: Add label fields to AI provider health endpoints
af940250 feat: Add provider health route response fields for fallback chain and ranking
```

### Test Status
- **Total Tests Passing:** 3941
- **Build Status:** ✓ Successful (with NODE_ENV=development)
- **TypeCheck Status:** ✓ Passing
- **Lint Status:** ✓ Passing

### Environment Configuration
**Development Requirements (.env.local):**
```
DATABASE_URL="postgresql://<username>:<password>@<host>:5432/<database>"
SESSION_SECRET="at least 32 characters"
AI_JOBS_WORKER_SECRET="shared secret for worker authentication"
CRON_SECRET="Vercel Cron secret"
```

**At least one AI provider key required:**
- MISTRAL_API_KEY (tier 1, preferred)
- GROQ_API_KEY (tier 2)
- OPENROUTER_API_KEY (tier 3)
- GEMINI_API_KEY (tier 4)
- OPENAI_API_KEY (tier 5)
- TOGETHER_API_KEY (tier 6)
- DEEPSEEK_API_KEY (tier 7)
- ANTHROPIC_API_KEY (tier 8, last resort)

---

## 2. Fixed Issues (Phase 0 Bootstrap)

### Issue 2.1: Duplicate Function Definition in Health Endpoint

**File:** `app/api/ai/health/route.ts`  
**Error:** TypeScript TS2440 "Import declaration conflicts with local declaration"  
**Root Cause:**
- Line 3 imports `restoreProviderHealthBeforeResponse` from `@/lib/ai-provider-health`
- Lines 33-42 defined a local stub function with the same name
- Line 66 called the function expecting an object with `{ok, error}` properties
- The local stub returned `void`, causing TS2339 errors on property access

**Fix Applied:**
- Removed lines 33-42 (the local stub function definition)
- Kept the import from `@/lib/ai-provider-health`
- Verified the imported function correctly returns `{ok, error}` properties

**Status:** ✓ Fixed (Commit: f52d8090)

### Issue 2.2: Database Migration Errors (PR #813)

**File:** `lib/prisma.ts` (Lines 622-642)  
**Error:** SQL "column does not exist" errors in 123 failing tests  
**Root Cause:**
- Bootstrap code attempted to migrate data from non-existent columns:
  * `generatedDocumentId` → `documentId` (never existed in schema)
  * `reviewStatus` → `action` (never existed)
  * `reviewNotes` → `notes` (never existed)
- These columns were never part of the schema; the schema has always used the correct names

**Fix Applied (in previous session):**
- Removed lines 622-642 ("Copy data from old column names to new ones" section)
- Kept ensureColumn calls (lines 612-621) that add missing columns

**Status:** ✓ Fixed (Applied to both PR branches, all tests passing)

### Issue 2.3: Invalid AuditAction Type

**File:** `app/api/admin/ai-provider-health/test/route.ts` (Line 306)  
**Error:** TypeScript error for invalid AuditAction type  
**Root Cause:**
- Code attempted to use custom AuditAction "AI_PROVIDER_HEALTH_CHECK"
- AuditAction enum only supports predefined types

**Fix Applied:**
- Changed to valid AuditAction type "CREATE"

**Status:** ✓ Fixed

---

## 3. Call Graphs and State Writers

### 3.1 AI Provider Health System

**State Authority:**
- **In-Memory:** `lib/ai-provider-health.ts` (single source of truth for runtime)
- **Persistent:** `prisma/schema.prisma` → `ProviderHealthSnapshot` table
- **Synchronization:** `lib/engine/provider-health-store.ts` (bridge layer)

**Key Functions (Ordered by Tier):**

1. **Configuration Check (Tier 1):**
   - `isMistralConfigured()` → checks MISTRAL_API_KEY
   - `isGroqConfigured()` → checks GROQ_API_KEY
   - `isOpenRouterConfigured()` → checks OPENROUTER_API_KEY
   - `isGeminiConfigured()` → checks GEMINI_API_KEY
   - `isOpenAIConfigured()` → checks OPENAI_API_KEY
   - `isTogetherConfigured()` → checks TOGETHER_API_KEY
   - `isDeepSeekConfigured()` → checks DEEPSEEK_API_KEY
   - `isAnthropicConfigured()` → checks ANTHROPIC_API_KEY

2. **Health State Writers:**
   - `recordProviderFailure(provider, error)` - in-memory only, called from AI invocation layer
   - `recordProviderSuccess(provider)` - in-memory only
   - `recordProviderAnalysisSuccess(provider)` - analysis-tier verification
   - `markProviderFailed(provider, failureClass, error)` - DB-backed + in-memory (provider-health-store.ts)
   - `markProviderOK(provider)` - DB-backed + in-memory (provider-health-store.ts)
   - `markProviderAnalysisOK(provider)` - DB-backed + in-memory (provider-health-store.ts)

3. **Health State Readers:**
   - `getAllProviderHealth()` - returns current in-memory health state
   - `getProviderRuntimeSnapshot(provider)` - returns runtime state (cooldown, last success, etc.)
   - `getProviderStateSnapshot(provider)` - returns detailed provider state
   - `isProviderCooledDown(provider)` - in-memory cooldown check
   - `isProviderCoolingDown(provider)` - DB-backed cooldown check (falls back to in-memory)

4. **State Recovery:**
   - `loadProviderHealthIntoMemory()` - cold-start recovery from DB (called once per process)
   - `restoreProviderState(provider, snapshot)` - populate in-memory from DB snapshot
   - `restoreProviderHealthBeforeResponse()` - recovery before GET /api/ai/health response

**Cooldown Categories and Durations:**
- RATE_LIMIT: 60 seconds
- AUTH: 3600 seconds (1 hour)
- QUOTA_EXHAUSTED: 300 seconds (5 minutes)
- MODEL_UNAVAILABLE: 120 seconds
- NETWORK: 30 seconds
- MALFORMED_RESPONSE: 60 seconds
- TIMEOUT: 10 seconds
- UNKNOWN: 60 seconds

**State Verification Tiers:**
- Tier 1: CONFIGURED (key is set)
- Tier 2: CONNECTIVITY_VERIFIED (ping/heartbeat succeeded)
- Tier 3: GENERATION_VERIFIED (proposal generation succeeded)
- Tier 4: ANALYSIS_VERIFIED (analysis/extraction succeeded)

### 3.2 AI Job System (Durable Job Queue)

**State Authority:**
- **Database:** `prisma/schema.prisma` → `AiJob` table
- **Manager:** `lib/engine/ai-job-service.ts`

**Job Types:**
- `AI_ANALYZE` - tender document analysis
- `ENGINE_RUN` - extraction and requirement resolution
- `GENERATE_PROPOSAL` - proposal generation

**Job States:**
- QUEUED → RUNNING → SUCCEEDED / FAILED / SUPERSEDED

**State Writers:**
- `createAiJob(tenderId, jobType, ...)` - create new job
- `updateAiJobStatus(jobId, status, ...)` - update job state
- `markJobSucceeded(jobId, result)` - mark complete with result
- `markJobFailed(jobId, error)` - mark failed with error

### 3.3 Tender Requirement System

**State Authority:**
- **Database:** `TenderRequirement` table
- **Staging:** `StagedTenderRequirement` table (fallback approval)
- **Persistence:** `lib/engine/tender-requirement-service.ts`

**State Transitions:**
- CANONICAL → (unstaged edit) → STAGED → (approval) → CANONICAL
- CANONICAL (final set protection) - guard trigger prevents deletion

**Source Grounding:**
- Each requirement stores:
  - `sourceTenderFileId` (from which uploaded PDF)
  - `sourceExactQuote` (the extracted text)
  - `sourcePageNumber` (page in PDF)
  - `sourceExtractionMethod` (text / OCR / manual)
  - `sourceConfidence` (0.25-0.95 confidence score)

**State Writers:**
- `createTenderRequirement(tenderId, {...})` - create requirement
- `stageTenderRequirement(tenderId, [...])` - stage new requirements
- `promoteStagedRequirements(tenderId)` - promote to canonical
- `deleteRequirement(requirementId)` - with guard against final-set deletion

### 3.4 Tender Analysis Metadata

**State Authority:**
- **Database:** `TenderAnalysis` table
- **Staging:** Implicit in AI job result state

**Stored Analysis Results:**
- `extractedTitle` - project/tender title
- `extractedDescription` - summary
- `identifiedRequirementCategories` - [list]
- `submissionInstructions` - extraction
- `evaluationCriteria` - extraction
- `requiredDocuments` - extraction
- `clientDetails` - (NEW: comprehensive 20-field extraction)
- `analysisStatus` - FULL / PARTIAL / OCR_REQUIRED / WEAK_EXTRACTION
- `sourceFile` - which PDF(s) analysis came from

**State Writers:**
- AI Analyze route updates analysis on completion
- Job service marks analysis complete

### 3.5 Submission Plan State

**State Authority:**
- **Database:** `SubmissionPlanState` table (NEW in migration 20260613)
- **Trigger:** Auto-refresh on GeneratedDocument changes

**Tracked State:**
- `provenance` - NONE / SOURCE_BACKED / DERIVED_FROM_REQUIREMENTS
- `confirmationStatus` - NOT_REQUIRED / UNCONFIRMED / CONFIRMED
- `derivedDocumentCount` - count of DERIVED_DRAFT_UNCONFIRMED documents
- `activeDocumentCount` - count of non-SUPERSEDED documents
- `confirmedAt` - timestamp when all derived documents confirmed
- `updatedAt` - last state change

---

## 4. Affected Files (Comprehensive Inventory)

### 4.1 Core AI System Files

**Configuration & Provider Setup:**
- `lib/env-check.ts` - runtime environment validation
- `lib/ai.ts` - canonical provider chain and SDK initialization
- `lib/ai-provider-health.ts` - in-memory health tracking
- `lib/ai-provider-policy.ts` - provider selection policy
- `scripts/check-env.mjs` - build-time environment validation

**Provider Integration:**
- `lib/providers/mistral.ts` - Mistral API wrapper
- `lib/providers/groq.ts` - Groq API wrapper
- `lib/providers/openrouter.ts` - OpenRouter API wrapper
- `lib/providers/gemini.ts` - Google Gemini API wrapper
- `lib/providers/openai.ts` - OpenAI API wrapper
- `lib/providers/together.ts` - Together API wrapper
- `lib/providers/deepseek.ts` - DeepSeek API wrapper
- `lib/providers/anthropic.ts` - Anthropic Claude wrapper

**Health & State Management:**
- `lib/engine/provider-health-store.ts` - DB-backed health persistence
- `lib/engine/ai-job-service.ts` - durable job queue manager
- `app/api/ai/health/route.ts` - health status endpoint

### 4.2 Analysis & Extraction Files

**AI Analysis Routes:**
- `app/api/tenders/[id]/ai-analyze/route.ts` - main analysis endpoint (NEEDS CONSOLIDATION)
- `app/api/ai-jobs/route.ts` - job management endpoint
- `app/api/ai-jobs/[jobId]/route.ts` - individual job queries

**Analysis Services:**
- `lib/engine/tender-analysis-service.ts` - analysis orchestration
- `lib/engine/tender-requirement-service.ts` - requirement management
- `lib/engine/pdf-extraction.ts` - PDF text extraction
- `lib/engine/pdf-ocr.ts` - OCR for scanned PDFs

**Analysis Logic:**
- `lib/extractors/client-details-extractor.ts` - client/procuring entity extraction
- `lib/extractors/requirement-extractor.ts` - requirement extraction
- `lib/extractors/submission-instruction-extractor.ts` - submission terms
- `lib/extractors/evaluation-criteria-extractor.ts` - evaluation rules

### 4.3 Database & Schema Files

**Prisma Files:**
- `prisma/schema.prisma` - complete data model
- `prisma/seed.ts` - bootstrap data seeding
- `prisma/migrations/` - migration history
  - `20250801000000_initial_schema/` - base schema
  - `20260613190000_comprehensive_gap_guards/` - guard triggers and SubmissionPlanState
  - (others...)

**Key Tables:**
- `Tender` - main tender record
- `TenderFile` - uploaded PDF documents
- `TenderRequirement` - extracted requirements
- `StagedTenderRequirement` - requirement staging for approval
- `TenderAnalysis` - analysis results
- `GeneratedDocument` - proposal outputs
- `AiJob` - durable job queue
- `ProviderHealthSnapshot` - provider health persistence
- `SubmissionPlanState` - submission plan metadata
- `AuditLog` - action audit trail

### 4.4 API Endpoints (Current)

**Health & Status:**
- `GET /api/ai/health` - provider health status (FIXED: removed duplicate function)
- `GET /api/admin/ai-provider-health` - admin health view
- `GET /api/admin/ai-provider-health/test/route.ts` - test endpoint

**Analysis & Jobs:**
- `POST /api/tenders/[id]/ai-analyze` - trigger analysis (CONSOLIDATED HERE)
- `GET /api/ai-jobs` - list jobs (pagination)
- `POST /api/ai-jobs` - create job
- `GET /api/ai-jobs/[jobId]` - get job details
- `POST /api/ai-jobs/[jobId]/cancel` - cancel job
- `POST /api/ai-jobs/[jobId]/approve-requirements` - approve staged requirements

**Tender Management:**
- `POST /api/tenders` - create tender
- `GET /api/tenders/[id]` - get tender details
- `PATCH /api/tenders/[id]` - update tender
- `POST /api/tenders/[id]/upload-file` - upload PDF
- `GET /api/tenders/[id]/requirements` - get requirements
- `POST /api/tenders/[id]/requirements` - create requirement

### 4.5 UI Components (Needs Verification)

**Analysis UI:**
- `app/(dashboard)/tenders/[id]/page.tsx` - tender detail page
- `app/(dashboard)/tenders/[id]/ai-analyze-panel.tsx` - analysis trigger panel
- `app/(dashboard)/tenders/[id]/analysis-results-panel.tsx` - results display
- `app/(dashboard)/tenders/[id]/extraction-quality-panel.tsx` - extraction quality view
- `app/(dashboard)/tenders/[id]/requirements-panel.tsx` - requirements view
- `app/(dashboard)/tenders/[id]/submission-plan-panel.tsx` - submission plan view

**Job Monitoring:**
- `app/(dashboard)/jobs/page.tsx` - job list
- `app/(dashboard)/jobs/[jobId]/page.tsx` - job detail

### 4.6 Utility & Helper Files

**Type System:**
- `lib/types/ai.ts` - AI-related types
- `lib/types/tender.ts` - tender types
- `lib/types/job.ts` - job types

**Constants & Configuration:**
- `lib/constants/ai-providers.ts` - provider constants
- `lib/constants/tender.ts` - tender constants

**Utilities:**
- `lib/utils/error-handling.ts` - error categorization and redaction
- `lib/utils/retry.ts` - exponential backoff retry logic
- `lib/utils/timeout.ts` - timeout management

---

## 5. Release-Readiness Blockers

### Blocker 5.1: Monolithic AI Analyze Route

**Issue:** `app/api/tenders/[id]/ai-analyze/route.ts` contains mixed responsibilities:
- HTTP request parsing
- Job creation
- Provider selection
- Chunk-based analysis
- Requirement staging
- Result promotion

**Impact:** Hard to test, debug, and maintain. No clear state machine. Fallback logic buried in handler.

**Required Fix:** Decompose into:
1. Route handler (HTTP only)
2. Analysis orchestrator (state machine)
3. Provider fallback manager (strategy pattern)
4. Job service (durable queue)

### Blocker 5.2: No Unified Job System

**Issue:** AI analysis lacks durable job tracking across provider failures.

**Current State:**
- Jobs created but not always tracked through completion
- Provider failures may not update job state
- Retry logic scattered across multiple files
- Job results not properly persisted

**Impact:** Analysis can get stuck, retry attempts unknown, user can't track status.

**Required Fix:** Consolidate all analysis work through AiJobService:
1. Create job before starting
2. Update state on every provider attempt
3. Persist provider failures + cooldowns
4. Mark complete with final result or error

### Blocker 5.3: Weak Requirement Source Grounding

**Issue:** Requirements extracted but source page/quote not always recorded.

**Current State:**
- `sourcePageNumber` sometimes missing
- `sourceExactQuote` not always captured
- `sourceExtractionMethod` (text vs OCR) not tracked
- `sourceConfidence` ranges are inconsistent

**Impact:** Requirements can't be traced back to source. Audit trail incomplete.

**Required Fix:** Enhance requirement extractors to always record:
1. Exact source page number
2. Verbatim quote from text extraction
3. OCR or text-based method
4. Confidence score based on quality indicators

### Blocker 5.4: No Canonical Requirement Protection

**Issue:** Staged requirements can be promoted then rolled back, losing history.

**Current State:**
- Fallback workflow can delete canonical set
- No guard against deleting final requirements while analysis is running
- No audit trail for requirement changes

**Impact:** Data loss during concurrent analysis attempts. Race conditions possible.

**Required Fix:** Implement database trigger guards:
1. Prevent deletion of canonical set unless staged analysis exists
2. Mark requirements with analysis job ID that created them
3. Audit all requirement changes

### Blocker 5.5: Client Details Extraction Incomplete

**Issue:** Procuring entity details not comprehensively extracted.

**Current State:**
- Only basic name/email extracted
- 15+ required client fields missing
- No source grounding for client details
- Contamination detection absent

**Impact:** Generated proposals incomplete. Client contact unclear.

**Required Fix:** Implement comprehensive 20-field extraction:
1. Procuring entity / client name
2. Full legal name if different
3. Donor / funding agency
4. Project owner / implementing agency
5. Procurement reference number
6. Tender title / project title
7. Country
8. City / location
9. Client address
10. Submission address
11. Contact person name
12. Contact title / role
13. Contact email(s)
14. Contact phone / mobile
15. Website / portal link
16. Submission email(s)
17. Required email subject line
18. Pre-bid / contact channel
19. Client representative / officer
20. Source page and quote for every field

### Blocker 5.6: Page Extraction Quality Not Visible

**Issue:** No extraction quality dashboard before analysis.

**Current State:**
- Total pages unknown
- OCR vs text extraction not tracked
- Blank pages not reported
- Low-confidence pages not marked

**Impact:** Analysis proceeds on weak extraction. False confidence in results.

**Required Fix:** Add extraction quality panel:
1. Pages successfully text-extracted
2. Pages OCR-extracted
3. Blank/failed pages
4. Overall extraction coverage %
5. Per-page confidence scores
6. Warning if extraction is weak

### Blocker 5.7: No Generation Gates

**Issue:** Generate Docs allowed even when extraction/requirements/client details are missing.

**Current State:**
- No validation before document generation
- Missing fields cause silent failures
- User doesn't know why generation failed

**Impact:** Confusing user experience. Incomplete proposals.

**Required Fix:** Implement generation gates (all must pass):
1. Page extraction acceptable
2. Client details extracted or confirmed
3. Mandatory requirements extracted
4. Submission instructions extracted
5. Required documents identified
6. Submission plan confirmed

---

## 6. Implementation Roadmap (10-Phase Consolidation)

### Phase 0: Baseline Audit ✓ COMPLETE
- [x] Record current SHA and branch status
- [x] Document fixed TypeScript errors
- [x] Create call graphs and state writers inventory
- [x] List all affected files
- [x] Identify release-readiness blockers
- [x] Verify build passes locally (npm run build, typecheck, lint)

### Phase 1: Select Authoritative Execution Engine (NEXT)
**Objective:** Consolidate all analysis work into durable job service.

**Scope:**
- Review AiJobService contract
- Ensure all analysis routes create jobs
- Implement job state machine
- Verify DB persistence

**Files to Review:**
- `lib/engine/ai-job-service.ts`
- `app/api/tenders/[id]/ai-analyze/route.ts`
- `lib/engine/tender-analysis-service.ts`

### Phase 2: Implement Required API Contracts
**Objective:** Define final public API surface.

**Required Endpoints:**
- `POST /api/tenders/[id]/ai-analyze` - trigger analysis
- `GET /api/ai-jobs` - list jobs with filters
- `GET /api/ai-jobs/[jobId]` - get job details with progress
- `POST /api/ai-jobs/[jobId]/cancel` - cancel job
- `POST /api/ai-jobs/[jobId]/pause` - pause (for manual intervention)
- `POST /api/ai-jobs/[jobId]/resume` - resume from pause
- `POST /api/ai-jobs/[jobId]/approve-requirements` - approve staged
- `GET /api/tenders/[id]/analysis-status` - current analysis state

### Phase 3: Repair Generic Worker and Job List
**Objective:** Ensure job list and worker are functional.

**Scope:**
- Implement job listing with pagination and filters
- Add job progress tracking
- Implement worker queue draining logic
- Add cron integration for background jobs

### Phase 4: Ensure One Writer for AI Analysis State
**Objective:** Single authority for analysis state changes.

**Scope:**
- All state transitions through AiJobService
- No direct DB updates to analysis state
- Audit all mutations

### Phase 5: Implement Canonical Job and Promotion Safety
**Objective:** Non-destructive requirement staging + approval workflow.

**Scope:**
- Stage new requirements without deleting canonical
- Guard against concurrent stages
- Implement promotion logic with fallback
- Add approval workflow

### Phase 6: Source Grounding and Fallback Policy
**Objective:** Every extraction stores source + implements fallback on weak extraction.

**Scope:**
- Enhance extractors to record page number, quote, method, confidence
- Implement fallback: OCR if text weak, manual if OCR weak
- Add regex fallback for critical fields
- Implement confidence thresholds

### Phase 7: Error Safety and Provider Failure Handling
**Objective:** Comprehensive error handling and provider fallback.

**Scope:**
- Categorize all errors (rate limit, timeout, auth, etc.)
- Implement provider cooldown on failure
- Record failure reasons
- Implement automatic provider rotation on failure

### Phase 8: UI and Recovery Contract
**Objective:** User-facing status and recovery flows.

**Scope:**
- Add job status UI (queued, running, succeeded, failed)
- Add provider health indicator
- Add extraction quality dashboard
- Add generation gates validation
- Add manual recovery flows

### Phase 9: Comprehensive Testing
**Objective:** 20+ test scenarios covering all failure modes.

**Scope:**
- Unit tests for each state transition
- Integration tests for full workflows
- Test provider failure and fallback
- Test concurrent analysis
- Test weak extraction scenarios

### Phase 10: Release Gate Verification
**Objective:** Final verification before shipping.

**Scope:**
- All tests passing
- Build successful
- No type errors
- No lint warnings
- Performance acceptable
- Documentation complete

---

## 7. Key Files to Review/Modify

### CRITICAL (Must Review Before Implementation)
1. `lib/engine/ai-job-service.ts` - job service authority
2. `app/api/tenders/[id]/ai-analyze/route.ts` - main analysis endpoint
3. `lib/engine/tender-analysis-service.ts` - analysis orchestration
4. `prisma/schema.prisma` - data model verification
5. `lib/ai-provider-policy.ts` - provider selection logic

### IMPORTANT (Review During Implementation)
6. `lib/engine/tender-requirement-service.ts` - requirement state
7. `lib/engine/provider-health-store.ts` - health persistence
8. `lib/extractors/` directory - all extractors need source grounding
9. `app/api/ai/health/route.ts` - provider health endpoint
10. `prisma/migrations/` - schema guard triggers

### SUPPORTING (Review As Needed)
11. `lib/providers/` - all provider wrappers
12. `app/(dashboard)/tenders/[id]/` - UI components
13. `lib/utils/` - retry, timeout, error handling utilities

---

## 8. Testing Checklist

- [ ] npm run typecheck passes
- [ ] npm run lint passes
- [ ] npm test passes (all 3941 tests)
- [ ] npm run build succeeds (NODE_ENV=development with valid .env.local)
- [ ] Tender upload works
- [ ] AI Analyze triggers successfully
- [ ] Job creation and tracking works
- [ ] Provider fallback works
- [ ] Requirement staging and promotion works
- [ ] Client details extraction complete
- [ ] Extraction quality dashboard visible
- [ ] Generation gates enforced
- [ ] Error recovery flows work
- [ ] UI shows job progress correctly
- [ ] Provider health endpoint accurate
- [ ] Database persistence verified
- [ ] Cold-start recovery verified
- [ ] Concurrent analysis handled safely
- [ ] Weak extraction detected and flagged
- [ ] No data loss on provider failure

---

## 9. Notes and Observations

### Architecture Observations
1. **Durable Job Queue:** AiJobService exists but analysis route bypasses it in some cases
2. **Provider Fallback:** Logic is decentralized across multiple files
3. **Health Tracking:** In-memory + DB sync works but needs consolidation
4. **Requirement Staging:** Workflow exists but lacks guards against concurrent edits
5. **Client Details:** Basic extraction exists but missing 15+ fields

### Technical Debt
1. Monolithic analysis route (600+ lines)
2. Scattered provider fallback logic
3. No unified error handling
4. Inconsistent source grounding
5. Missing extraction quality visibility

### Positive Findings
1. Provider health system well-structured
2. DB migrations use proper triggers for consistency
3. Test coverage is strong (3941 passing)
4. TypeScript strict mode enforced
5. Error messages clear and helpful

---

## 10. Next Steps

1. **Immediate (Phase 1):** Review AiJobService and analysis route together
2. **Week 1 (Phases 1-3):** Implement unified job system and API contracts
3. **Week 2 (Phases 4-6):** Implement safety guards and source grounding
4. **Week 3 (Phases 7-8):** Error handling, provider fallback, and UI
5. **Week 4 (Phases 9-10):** Comprehensive testing and release gate verification

**Branch Strategy:**
- Work on `release/ai-analyze-permanent-consolidation` (created from main)
- Create draft PR once Phase 1 complete
- Merge to main after Phase 10 verification

---

**Audit Completed By:** Claude Opus 4.8  
**Session Date:** 2026-06-21  
**Status:** ✓ READY FOR PHASE 1
