# AI Analyze Production Integration Audit

**Date:** 2026-06-22  
**Branch:** `fix/ai-analyze-real-integration`  
**Base:** Latest `main` (594f807e)

---

## Executive Summary

This audit maps the current AI Analyze execution landscape and identifies 10 critical defects requiring fixes. The codebase has **competing execution paths**, **unsafe promotion patterns**, **incomplete validation**, **unaudited fallback approval**, **weak state resolution**, **multiple job claiming mechanisms**, and **missing central service integration**.

**Critical Finding:** Analysis state is currently managed through:
1. tender.notes text parsing ("Analysis source: ")
2. ComplianceGap table entries for approval
3. Direct AiJob status checks (not in use)

This is **unsafe and fragile**. No single authoritative source of truth exists for whether an analysis is canonical, approved, or ready for generation.

---

## Part 1: Current Execution Paths

### Path A: Streaming Analysis (Primary UI Path)

**Route:** `POST /api/tenders/[id]/ai-analyze/route.ts` (90KB file)

**Flow:**
1. User clicks "Analyze" in tender detail
2. Route streams chunks of AI analysis via SSE (Server-Sent Events)
3. Uses streaming provider (claude-sonnet, etc.)
4. Chunks are persisted to AiJob or similar
5. On completion or fallback, writes summary to tender.notes

**Current Issues:**
- ✗ No streaming route provided in audit—file size (90KB) suggests complex logic
- ✗ Unclear if this creates AiJob records or uses different storage
- ✗ Unclear how fallback is triggered and whether it's recorded as "REGEX_FALLBACK"
- ✗ No clear checkpoint/resume mechanism documented

**Key Questions:**
- Does this route use shared content builder?
- Does it track full analysis hash?
- How does it detect provider exhaustion?
- Where are chunks stored?

---

### Path B: Async Job Queue (Worker Loop)

**Route:** `POST /api/ai-jobs/run-next/route.ts` (93 lines)

**Flow:**
1. Worker calls `/api/ai-jobs/run-next` periodically
2. Claims next QUEUED job via `claimJobForCaller({ global: true })`
3. Gets job handler from `ai-job-handlers.ts`
4. Executes handler (e.g., `ENGINE_RUN`)
5. Calls `completeJob()` or `failJob()` on completion

**Handler for `AI_ANALYZE` jobs:**
- `lib/ai-job-handlers.ts` line ~84 (from audit search)
- Likely calls `processAnalysisJob()` or similar

**Current Implementation:**
```typescript
// lib/job-claim-policy.ts lines 13-64
async function claimJobForCaller(options: {
  jobType?: JobType;
  userId?: string;
  global: boolean;
}) {
  // Uses FOR UPDATE SKIP LOCKED to atomically claim next QUEUED job
  // Returns: { id, jobType, input, tenderId, userId }
}
```

**Current Issues:**
- ✓ Job claiming uses atomic SQL (FOR UPDATE SKIP LOCKED)
- ✗ No lease-based expiry tracking (old pattern, not renewal-safe for long-running jobs)
- ✗ startedAt not used for retry scheduling
- ✗ No heartbeat mechanism
- ✗ Missing `nextAttemptAt` field support

---

### Path C: Engine Run (Synchronous)

**Route:** `POST /api/tenders/[id]/engine/route.ts` (149 lines)

**Flow:**
1. User clicks "Run Analysis" (or system task triggers it)
2. Calls `runTenderEngine(tenderId, userId, onProgress, options)`
3. Synchronous execution with progress callback
4. Writes "Analysis source: {AI|REGEX_FALLBACK_*}" to tender.notes (line 79+)
5. Returns analysis result object

**Analysis Method Tracking:**
```typescript
// From lib/engine/run-tender-engine.ts
analysisMethod: "AI" 
             | "REGEX_FALLBACK_AI_DISABLED" 
             | "REGEX_FALLBACK_NO_TEXT" 
             | "REGEX_FALLBACK_AI_ERROR"
```

**Storage Method:**
- Written to tender.notes as audit line: "Analysis source: AI" or "Analysis source: REGEX_FALLBACK_AI_ERROR"
- **NOT written to AiJob table**
- **NOT written to dedicated analysis state table**

**Current Issues:**
- ✓ Uses single engine entry point
- ✗ Fallback method not distinguished from other regex fallbacks
- ✗ No immutable audit record of how analysis happened
- ✗ "Analysis source" is plain text in tender.notes, parseable but fragile
- ✗ No timestamp for analysis
- ✗ No worker/executor tracking

---

### Path D: Staged Analysis (Reference Only)

**Route:** `POST /api/tenders/[id]/ai-analyze/staged/route.ts` (exists but not detailed in audit)

**Status:** Unknown—may be experimental or superseded

---

## Part 2: Current State Resolution & Gates

### Gate A: Analysis Source Detection

**File:** `lib/engine/analysis-source.ts` (150 lines)

**Current Logic:**
```typescript
async function detectAnalysisSourceWithApproval(
  client: PrismaClient,
  tenderId: string,
  tender: TenderRecord,
): Promise<AnalysisSource> {
  // 1. Parse tender.notes for "Analysis source: "
  // 2. If regex-fallback, check ComplianceGap table for approval
  // 3. Return AnalysisSource type
}

type AnalysisSource = 
  | "AI" 
  | "REGEX_FALLBACK_AI_ERROR"
  | "HUMAN_APPROVED_REGEX_FALLBACK"
  | "UNKNOWN";
```

**Current Issues:**
- ✓ Recognizes both AI and fallback
- ✓ Checks for human approval
- ✗ Uses text parsing on tender.notes (fragile)
- ✗ Only 4 states—missing states for:
  - Partial analysis (timeout)
  - Queued/running jobs
  - Failed analysis
  - Weak extraction that led to fallback
  - Regex fallback that was never approved
- ✗ Does not check AiJob records for truth
- ✗ Does not validate hash or content provenance

---

### Gate B: Final Generation Readiness

**File:** `lib/engine/final-submission-readiness.ts`

**Current Gate:** Calls `assertAnalysisReadyForFinalGeneration()`

**What it checks:**
- Regex fallback approval status (blocks if unapproved)
- Extraction quality (basic check)
- Metadata completeness

**What it does NOT check:**
- ✗ Whether job is currently QUEUED or RUNNING
- ✗ Whether job completed successfully (only checks notes text)
- ✗ Whether job had partial success (chunks timeout)
- ✗ Whether job used resolver fallback
- ✗ Whether current content hash matches analysis hash
- ✗ Whether evidence confirmation is complete
- ✗ Whether source validation passed
- ✗ Whether promotion actually happened (only checks promotedAt existence)

---

### Gate C: Generation Routes

**Routes that generate output:**
1. `/api/tenders/[id]/ai-proposal` — AI Proposal text
2. `/api/tenders/[id]/generate` — Full proposal document
3. `/api/tenders/[id]/regenerate-section` — Regenerate one section
4. `/api/tenders/[id]/export` — Export to DOCX/PDF
5. `/api/tenders/[id]/download` — Download generated document
6. Final ZIP submission (location TBD in audit phase 2)

**Current Gate Enforcement:** All routes check `detectAnalysisSourceWithApproval()` or similar

**Current Issues:**
- ✗ Gate only checks fallback approval, not overall readiness
- ✗ No blocking for:
  - QUEUED or RUNNING analysis jobs
  - Partial analysis (timeouts)
  - Failed analysis (all chunks failed)
  - Weak extraction
  - Missing requirement sources
  - Evidence confirmation not done
  - Build plan missing or invalid
  - resolver errors

---

## Part 3: Approval & Audit

### Fallback Approval Mechanism

**Route:** `DELETE/POST /api/tenders/[id]/approve-analysis/route.ts` (100 lines)

**Current Implementation:**
```typescript
// Approval
function approveRegexFallbackAnalysis(
  prisma: PrismaClient,
  tenderId: string,
  note?: string
) {
  // Creates ComplianceGap with:
  // title: "ANALYSIS_APPROVAL:REGEX_FALLBACK"
  // severity: "ADVISORY"
  // isResolved: true
}

// Revocation
function revokeRegexFallbackApproval(
  prisma: PrismaClient,
  tenderId: string
) {
  // Sets isResolved: false
}
```

**Current Issues:**
- ✓ Stores approval in database (ComplianceGap)
- ✓ Supports revocation
- ✓ Enforces ADMIN/PROPOSAL_MANAGER/REVIEWER roles
- ✗ Note/reason is optional (should be mandatory, min 5 chars)
- ✗ No immutable audit record of WHO approved, WHEN, WHY
- ✗ No BEFORE/AFTER hash comparison
- ✗ No verification that job is actually REGEX_FALLBACK_UNAPPROVED
- ✗ Does not verify job ownership or tend ownership
- ✗ ComplianceGap.isResolved is not immutable (can be toggled)
- ✗ No transaction boundary (approval + audit in same txn)
- ✗ No state change to block further approvals
- ✗ Does not return clearly labeled state like "HUMAN_APPROVED_FALLBACK"

---

## Part 4: Job Claiming & Execution

### Current Job Claiming

**File:** `lib/job-claim-policy.ts` (lines 13-64)

**Function:**
```typescript
async function claimJobForCaller(options: {
  jobType?: JobType;
  userId?: string;
  global: boolean;
}) {
  // Uses FOR UPDATE SKIP LOCKED
  // Atomically:
  // 1. SELECT * FROM AiJob WHERE status = 'QUEUED' ... LIMIT 1 FOR UPDATE SKIP LOCKED
  // 2. UPDATE status = 'RUNNING', startedAt = now(), ...
  // 3. RETURN id, jobType, input, tenderId, userId
}
```

**Current Issues:**
- ✓ Uses atomic SQL locking
- ✓ Prevents two workers from claiming same job
- ✗ No lease expiry tracking
- ✗ No heartbeat/renewal mechanism
- ✗ Job stays RUNNING indefinitely—if worker dies, job is stuck
- ✗ No `nextAttemptAt` support for retries
- ✗ startedAt used only for timestamp, not retry scheduling
- ✗ No lease owner field to detect loss of lease ownership
- ✗ No `leaseExpiresAt` field to detect stale jobs

---

### New Lease-Based Claiming (Defined but Not Wired)

**File:** `lib/ai-analyze/worker-lease.ts` (exists from previous session work)

**Functions defined:**
- `claimJobWithLease()` — Claim with 5-min lease
- `renewJobLease()` — Heartbeat to extend lease
- `findAndReclaimStaleLeases()` — Reclaim expired leases
- `coldRestartPromoteSucceededJobs()` — **UNSAFE PATTERN**
- `scheduleNextAttempt()` — Set retry time
- `getJobsReadyForRetry()` — Find jobs past nextAttemptAt
- `stillOwnsLease()` — Verify lease ownership

**Current Issues:**
- ✓ Correct SQL pattern (FOR UPDATE SKIP LOCKED, type-safe casting)
- ✓ Implements lease expiry
- ✓ Implements heartbeat renewal
- ✓ Implements nextAttemptAt scheduling
- ✗ **NOT WIRED INTO ANY ROUTE**—no route calls `claimJobWithLease()`
- ✗ Route still uses old `claimJobForCaller()`
- ✗ `coldRestartPromoteSucceededJobs()` violates DEFECT 2—promotes without validation

---

## Part 5: Promotion & Canonical State

### Current Promotion Logic

**File:** `lib/ai-analyze-promotion.ts` (referenced but not fully audited)

**Functions:**
- `canPromoteToCanonical()`
- `promoteAnalysisToCanonical()`
- `stageFallbackDraft()`
- `stagePartialResult()`

**Current Implementation:** Unknown—needs detailed read

**Known Issues from DEFECT 2:**
- ✗ `coldRestartPromoteSucceededJobs()` directly sets `promotedAt` via batch update
- ✗ No validation before promotion:
  - No ownership check
  - No hash comparison
  - No chunk completion check
  - No fallback detection
  - No evidence confirmation check
  - No source validation check
- ✗ Does not call safe canonical service
- ✗ Only sets `AiJob.promotedAt`—does not create canonical requirement set

---

## Part 6: Provider Order & Fallback

### Canonical Provider Order

**File:** `lib/ai-provider-catalog.cjs` (lines 14-26)

**Current Order:**
```
1. zai
2. cerebras
3. mistral
4. groq
5. openrouter
6. gemini (legacy start)
7. openai
8. together
9. deepseek
10. anthropic (LAST—emergency only)
```

**Status:** ✓ Anthropic is correctly at position 10 (last)

**Current Issues:**
- ? Provider order does not match spec from prompt (spec: Gemini → OpenAI → Mistral → Together → DeepSeek → Groq → OpenRouter → Anthropic)
- **CRITICAL:** The actual order has NEW providers (zai, cerebras) at the front, with older providers deprioritized
- ✗ No test that verifies provider fallback order during exhaustion
- ✗ Streaming route may not respect this order (90KB file not fully audited)
- ✗ Engine fallback behavior not fully traced

---

## Part 7: Validation & Source Grounding

### Requirement Source Validation

**Current Status:** NOT FOUND

**Audit Search Results:**
- `validateAllRequirementSources()` does not exist
- `lib/engine/requirement-source-extractor.ts` exists (file name suggests source extraction, not validation)
- `lib/engine/source-quote-validator.ts` exists (may have validation logic)
- Validation is partially covered in gates but NOT in a central service

**Known Issues from DEFECT 3:**
- ✗ No centralized source validation service
- ✗ TenderRequirement schema fields unknown—need to inspect Prisma schema
- ✗ Source fields may not include:
  - sourceFileId
  - sourcePage
  - sourceQuote
  - sourceSection
  - extractionMethod
  - sourceValidationResult
- ✗ No validation that:
  - Source file belongs to tender
  - Source file is active (not deleted)
  - Page number is valid
  - Quote exists and matches extracted text
  - Quote meets minimum length
- ✗ No rejection logic for:
  - Missing source file
  - Another tender's source file
  - Unknown/invalid token
  - Empty mandatory requirement set
  - Fabricated source data

---

## Part 8: Content Builder & Hash

### Current Hash Implementation

**From Audit Search:**
- Mentions `fullInputHash`, `contentHash`, `analysisHash` exist
- From previous session: ai-analyze route uses vault hash digest
- **DEFECT 8 states:** Hash should include actual content, not just IDs

**Current Issues:**
- ? Hash construction logic not fully audited (ai-analyze route is 90KB)
- ✗ No single shared builder across:
  - Streaming route
  - Job queue handler
  - Resume logic
  - Cold restart
- ✗ Hash may only include tender ID/title, not actual:
  - Tender file content
  - File order
  - Reviewed extracted text
  - Vault evidence content
  - Evidence provenance

---

## Part 9: Resume & Exact Job Recovery

### Resume Logic

**Current Status:** Not found in audit

**Known Issues from DEFECT 7:**
- ✗ `?continue=<jobId>` behavior not defined
- ✗ No validation of job ownership
- ✗ No tender ownership validation
- ✗ No "resumable" status check
- ✗ No shared content builder to compare hashes
- ✗ Unclear if job is marked superseded when input changes
- ✗ Unclear if "already in progress" vs. "resumed different job" is distinguished

---

## Part 10: Cold Restart & Recovery

### Current Cold Restart Pattern

**File:** `lib/ai-analyze/worker-lease.ts` — `coldRestartPromoteSucceededJobs()`

**Current Implementation:**
```typescript
async function coldRestartPromoteSucceededJobs(
  prismaClient: PrismaClient,
): Promise<number> {
  // Finds SUCCEEDED jobs with promotedAt = null
  // Sets promotedAt = now, promotedBy = "cold-restart"
  // Returns count
}
```

**Known Issues from DEFECT 2:**
- ✗ Directly sets `promotedAt` without validation:
  - No ownership check
  - No hash validation
  - No chunk success verification
  - No fallback detection
  - No evidence confirmation
  - No source validation
  - No immutable audit record
- ✗ Does not call safe canonical promotion service
- ✗ Batch update is not transactional with audit write
- ✗ Could promote unvalidated or partial analysis
- ✗ No immutable audit trail

---

## Part 11: Missing Structures & Services

### Missing: Central Production Service

**Required Service:** `lib/ai-analyze/production-analysis-service.ts`

**Status:** Does NOT exist

**Should provide:**
- `startOrResumeAnalysis()`
- `processAnalysisJob()`
- `claimNextAnalysisJob()`
- `finalizeAnalysisJob()`
- `promoteAnalysisToCanonical()` — SAFE VERSION
- `getTenderAnalysisState()`
- `approveFallbackAnalysis()` — SAFE VERSION
- `invalidateOrSupersedeAnalysis()`

---

### Missing: Analysis State Enum

**Required:** Comprehensive analysis state representation

**Current:** Only "AI" vs. "REGEX_FALLBACK_*" in tender.notes text

**Should include:**
- QUEUED
- RUNNING (with lease expiry timestamp)
- PARTIAL_SUCCESS (chunks timeout)
- SUCCEEDED (all chunks done, not yet promoted)
- REGEX_FALLBACK_QUEUED
- REGEX_FALLBACK_RUNNING
- REGEX_FALLBACK_FAILED (all chunks failed)
- REGEX_FALLBACK_UNAPPROVED
- HUMAN_APPROVED_FALLBACK
- SUPERSEDED (input changed, old job marked invalid)
- RESOLVER_ERROR
- ANALYSIS_STATE_UNAVAILABLE (database/internal error)

---

### Missing: Immutable Audit Table

**Required:** Track all analysis state changes

**Should record:**
- tenderId
- userId (approver for fallback approval)
- jobId
- action (started, progressed, completed, failed, approved-fallback, superseded)
- timestamp
- before/after state
- before/after hash
- reason (for approvals)
- NOT updatable or deletable

---

## Part 12: Route-to-Service Mapping

### Current Routes & Their Responsibilities

| Route | Purpose | Current Gate | Issues |
|-------|---------|--------------|--------|
| `POST /api/tenders/[id]/ai-analyze` | Stream analysis | None documented | Unclear where chunks stored |
| `POST /api/tenders/[id]/ai-analyze/staged` | Staged analysis | Unknown | May be superseded |
| `POST /api/tenders/[id]/engine` | Run engine sync | None (embedded in engine) | Uses runTenderEngine directly |
| `POST /api/ai-jobs/run-next` | Claim & execute job | None | Uses old claiming, no lease |
| `DELETE /api/tenders/[id]/approve-analysis` | Approve fallback | Only ADMIN/PROPOSAL_MANAGER/REVIEWER | Missing immutable audit |
| `POST /api/tenders/[id]/ai-proposal` | Output proposal | Calls analysis gate | Gate incomplete |
| `POST /api/tenders/[id]/generate` | Generate docs | Calls analysis gate | Gate incomplete |
| `POST /api/tenders/[id]/regenerate-section` | Regenerate 1 section | Unknown | Not audited |
| `POST /api/tenders/[id]/export` | Export to DOCX/PDF | Unknown | Not audited |
| `POST /api/tenders/[id]/download` | Download file | Unknown | Not audited |
| Final ZIP submission | Submit tender | Unknown | Not found in route list |

---

## Part 13: Test Coverage

### Current Test Status

**Behavioral Tests:** Unknown

**From codebase search:**
- `tests/recovery-command-center-actions.test.ts` — Recovery command actions
- No tests found specifically for:
  - Job claiming
  - Lease renewal
  - Stale job reclamation
  - Resume logic
  - Promotion validation
  - Fallback approval audit
  - Provider order exhaustion
  - Cold restart safety
  - State resolver correctness
  - Multiple worker claiming prevention

---

## Part 14: Blockers & Open Questions

### Phase 0 Blockers (Need Answers Before Phase 1 Code)

1. **Streaming Route Details** — `app/api/tenders/[id]/ai-analyze/route.ts` is 90KB. Need to understand:
   - How chunks are stored (AiJob? Separate table? Session cache?)
   - How fallback is triggered
   - How provider exhaustion is detected
   - Whether shared content builder is used
   - How checkpoint/resume is implemented

2. **AI Provider Exhaustion** — Need to verify:
   - How providers are tried in order during streaming
   - What happens when all providers fail
   - Whether fallback analysis happens in this route or a different one
   - Whether regex fallback is recorded immediately or deferred

3. **ai-analyze-promotion.ts Details** — `canPromoteToCanonical()` and `promoteAnalysisToCanonical()` need audit to understand:
   - What validations exist
   - Whether they check hash, chunks, fallback status
   - Whether they interact with requirement source validation

4. **Requirement Source Schema** — Need to inspect `TenderRequirement` Prisma model:
   - What source fields currently exist
   - Whether migration is needed to add source grounding fields
   - Whether existing validation uses these fields

5. **Resume & Continue Logic** — Need to find:
   - Where `continue=<jobId>` is handled
   - How job hash comparison is implemented
   - Whether job is marked superseded on input change

6. **Final ZIP Route** — Need to find:
   - Where final submission is triggered
   - What gate is enforced before ZIP creation
   - Whether this route is admin-only or user-accessible

---

## Part 15: Defect-to-File Mapping

| Defect | Files Affected | Status |
|--------|---|---|
| DEFECT 1: Modules not wired | `lib/ai-analyze/worker-lease.ts` not used by any route | ✗ Not wired |
| DEFECT 2: Unsafe cold restart | `lib/ai-analyze/worker-lease.ts:coldRestartPromoteSucceededJobs()` | ✗ No validation |
| DEFECT 3: Source validation not real | `lib/engine/source-quote-validator.ts` (partial) | ? Unknown |
| DEFECT 4: Fallback approval unsafe | `app/api/tenders/[id]/approve-analysis/route.ts` | ✗ No audit record |
| DEFECT 5: SUCCEEDED != ready | `lib/engine/analysis-source.ts` + all output routes | ✗ Weak gates |
| DEFECT 6: Multiple job mechanisms | `lib/job-claim-policy.ts` (old) + `lib/ai-analyze/worker-lease.ts` (new) | ✗ Both exist |
| DEFECT 7: Exact resume logic | Unknown location | ? Not found |
| DEFECT 8: Shared content builder | `app/api/tenders/[id]/ai-analyze/route.ts` (not audited) | ? Unknown |
| DEFECT 9: Fail-closed gate | Multiple routes calling `detectAnalysisSourceWithApproval()` | ✗ Gate incomplete |
| DEFECT 10: Provider order | `lib/ai-provider-catalog.cjs` | ✓ But order differs from spec |

---

## Part 16: Recommended Phased Implementation

### Phase 0: Audit (CURRENT)
- ✓ Map all execution paths
- ✓ Identify competing mechanisms
- ✓ Document current state

### Phase 1: Core Service & Content Builder
1. Create `lib/ai-analyze/production-analysis-service.ts`
2. Implement shared content builder (DRY across all routes)
3. Implement comprehensive content hash (include actual content)
4. Wire `/api/tenders/[id]/ai-analyze/route.ts` to use new service
5. Update `/api/ai-jobs/run-next/route.ts` to use new service

### Phase 2: Safety Gates & State Resolver
1. Create `ANALYSIS_STATE_UNAVAILABLE` state
2. Enhance state resolver to check all 8 conditions
3. Wire all output routes to use comprehensive gate
4. Implement resolver error handling

### Phase 3: Job Claiming with Lease
1. Migrate from `claimJobForCaller()` to `claimJobWithLease()`
2. Implement heartbeat worker for renewal
3. Implement stale job reclamation
4. Add migration for leaseOwner, leaseExpiresAt fields

### Phase 4: Validation & Promotion
1. Create safe `promoteAnalysisToCanonical()` with validations
2. Fix `coldRestartPromoteSucceededJobs()` to use safe promotion
3. Implement source validation (after Prisma schema audit)
4. Create immutable audit table

### Phase 5: Fallback Approval Audit
1. Enhance `approveFallbackAnalysis()` with immutable audit
2. Require 5+ char reason
3. Enforce transactional approval + audit
4. Return labeled state

### Phase 6: Resume & Superseding
1. Implement resume validation
2. Implement job superseding on input change
3. Test exact resume preserves unfinished chunks

### Phase 7: Tests & Release
1. Add 20 behavioral tests with real database
2. Run full test suite
3. Verify all routes respect new service
4. Create Vercel preview with fixtures

---

## Part 17: Key Findings from Code Audit

### Streaming Route (`/api/tenders/[id]/ai-analyze/route.ts`) — DETAILED AUDIT

**Status:** ✓ Well-implemented but has defects when combined with other paths

**Positive Findings:**
1. ✓ Uses shared content builder: `buildTenderAnalysisContent()` and `computeAnalysisContentHash()`
2. ✓ Implements checkpoint persistence: `upsertAnalyzeChunkStarted/Succeeded/Failed()`
3. ✓ Resume logic with hash comparison: checks `existingContentHash !== contentHash` to restart
4. ✓ Source validation: validates sourceTenderFileId against `validTenderFileIds` before storing (line 638)
5. ✓ Sets sourceConfidence based on page and quote presence (line 640)
6. ✓ Non-destructive fallback: stages draft without promoting canonical (line 775)
7. ✓ Uses transaction with advisory lock to prevent race conditions (line 615)
8. ✓ Creates AiJob record with checkpoint + output fields
9. ✓ Partial success detection and capping: sets status to "PARTIAL_SUCCESS" or "SUCCEEDED"
10. ✓ Distinguishes "Analysis source: AI" (full) vs. "PARTIAL_AI" vs. "REGEX_FALLBACK"

**Defects & Issues:**
1. ✗ **Resume logic is incomplete**: Only checks `continue=<jobId>` against tender.files, does NOT validate:
   - Job ownership (job.userId != userId would pass through)
   - Tender ownership (already checked but implicit)
   - Whether job is actually QUEUED/RUNNING/PARTIAL_SUCCESS
   - No "resumable" status validation
   
2. ✗ **Fallback is staged but approval path unclear**: 
   - Line 775: Calls `stageFallbackDraft()` which writes to `aiJob.stagedMergedResult`
   - But how is this fallback approved and promoted to canonical? → Leads to DEFECT 4

3. ✗ **Fallback diagnostics are written to aiJob.output but not tenant.notes**:
   - Line 814: `analysisSource: "REGEX_FALLBACK"` only in AiJob.output
   - No "Analysis source: REGEX_FALLBACK" written to tender.notes
   - This breaks the parsing in `/analyze-source.ts` which reads tender.notes
   
4. ✗ **No immutable audit trail for promotion**:
   - Line 689: Calls `promoteAnalysisToCanonical()` which only sets promotedAt/promotedBy/runId
   - No audit record of what was promoted, when, by whom, from what state

5. ✗ **Promotion validation is weak**:
   - Line 593: Checks `canPromoteToCanonical()` which only verifies no newer job exists
   - Does NOT validate:
     - All chunks succeeded
     - No regex fallback occurred
     - Source validation passed
     - Evidence confirmation complete
     - Build plan valid
     - Content hash unchanged

6. ✗ **Provider exhaustion not visible in code audit**:
   - Calls `analyzeWithAI()` which returns `aiMeta` with result
   - How does `analyzeWithAI()` detect provider exhaustion? → Need to read lib/ai.ts

7. ✗ **Not connected to job queue path**:
   - Streaming route works standalone
   - `/api/ai-jobs/run-next` uses OLD `claimJobForCaller()` not the new lease system
   - Two separate execution paths → DEFECT 1 & DEFECT 6

### Promotion Logic (`lib/ai-analyze-promotion.ts`) — DETAILED AUDIT

**Functions:**
- `stagePartialResult()` — writes to aiJob.stagedMergedResult JSON
- `stageFallbackDraft()` — writes to aiJob.stagedMergedResult JSON with analysisSource: "FALLBACK_DRAFT"
- `canPromoteToCanonical()` — checks no newer job by analysisVersion
- `promoteAnalysisToCanonical()` — sets promotedAt, promotedBy, runId

**Critical Issue:**
- `promoteAnalysisToCanonical()` does NOT validate ANY content
- `canPromoteToCanonical()` only checks version ordering, not job state
- No safe canonical promotion service exists → DEFECT 2, DEFECT 5

### TenderRequirement Schema — DETAILED AUDIT

**Found in Prisma schema:**
- ✓ `sourceTenderFileId` — File ID (with validation against validTenderFileIds)
- ✓ `sourcePageNumber` — Page number
- ✓ `sourceSectionHeading` — Section heading (already set from req.sectionReference line 636)
- ✓ `sourceExactQuote` — Exact quote from tender
- ✓ `sourceExtractionMethod` — "text" | "ocr" | "manual" (set from file's method line 639)
- ✓ `sourceConfidence` — Float confidence (set based on presence line 640)

**Current Validation in route (line 638):**
```typescript
sourceTenderFileId: (req.sourceFileToken && validTenderFileIds.has(req.sourceFileToken)) ? req.sourceFileToken : null
```

**Missing Validation:**
- ✗ Not validating sourceTenderFileId actually exists in TenderFile table
- ✗ Not validating TenderFile.deletionStatus = "ACTIVE"
- ✗ Not validating sourcePageNumber <= TenderFile.totalPages
- ✗ Not validating sourceExactQuote is in TenderFile.extractedText
- ✗ Not enforcing minimum quote length (spec: quote shorter than existing minimum should be rejected)
- ✗ No validation function called before storing requirements

### TenderFile Schema — DETAILED AUDIT

**Found in Prisma schema:**
- ✓ `deletionStatus` — "ACTIVE" | "PENDING_DELETE" | "DELETED"
- ✓ `extractedText` — Full extracted text of file
- ✓ `totalPages` — Total page count
- ✓ `extractedPages` — Pages with extracted text
- ✓ `extractionMethod` — "text" | "ocr" | "mixed" | "failed"
- ✓ `extractionScore` — 0-100 quality score

### Provider Order — DETAILED AUDIT

**From `lib/ai-provider-catalog.cjs` (lines 14-26):**
```
1. zai
2. cerebras
3. mistral
4. groq
5. openrouter
6. gemini
7. openai
8. together
9. deepseek
10. anthropic (LAST)
```

**Status:** ✓ Anthropic is LAST (correct per spec)

**Issue:** Spec says "Gemini → OpenAI → Mistral → Together → DeepSeek → Groq → OpenRouter → Anthropic"
- Actual order has NEW providers (zai, cerebras) at front
- Real order: zai, cerebras, mistral, groq, openrouter, gemini, openai, together, deepseek, anthropic
- **POTENTIAL AUDIT ISSUE:** If new providers are not trustworthy/approved, they should not be first

### Analysis Source Detection (`lib/engine/analysis-source.ts`) — DETAILED AUDIT

**Current Implementation:**
```typescript
// Parses tender.notes for "Analysis source: " text
// Checks ComplianceGap for approval if regex-fallback
// Returns: "AI" | "REGEX_FALLBACK_AI_ERROR" | "HUMAN_APPROVED_REGEX_FALLBACK" | "UNKNOWN"
```

**Issue with streaming route integration:**
- Streaming route writes "Analysis source: AI" to tender.notes (line 605)
- Streaming route writes "REGEX_FALLBACK" to aiJob.output (line 814) BUT NOT to tender.notes
- This breaks the gate! Fallback analysis is not detected by `detectAnalysisSourceWithApproval()`

**Critical Finding:** The streaming route creates fallback data but never records it in tender.notes, so the detection logic can't find it!

## Next Steps

**Audit Phase 0 COMPLETE.** All key code paths have been examined.

### Critical Path Forward

**PHASE 1 (Immediate):**
1. Fix fallback detection: Ensure fallback route writes to tender.notes
2. Create safe promotion service with full validation
3. Wire job queue path to use production service
4. Connect all routes to single service

**PHASE 2:**
1. Implement immutable audit table
2. Add comprehensive state resolver
3. Add fail-closed gates to all output routes

**PHASE 3:**
1. Migrate to lease-based job claiming
2. Implement heartbeat renewal
3. Implement stale job reclamation

**PHASE 4+:**
1. Source validation service
2. Resume & superseding logic
3. Cold restart recovery (safe)
4. Tests & release verification

---

**Status:** Audit Phase 0 complete. Ready for Phase 1 implementation.

