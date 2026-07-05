# Phase 1: Select Authoritative Execution Engine

**Objective:** Consolidate all analysis work into durable job service.

**Current State Assessment:**
- ✓ AiJob table exists in schema
- ✓ AnalysisJobService exists at `lib/ai-jobs/analysis-job-service.ts`
- ✗ Main analyze route (`app/api/tenders/[id]/ai-analyze/route.ts`) **does not use** the service
- ✗ Route creates AiJob records directly (lines 509-570, 1209+)
- ✗ Route manages its own transaction logic instead of delegating to service
- ✗ Route handles chunk processing directly instead of using service

**Route Architecture Analysis:**

The `app/api/tenders/[id]/ai-analyze/route.ts` (1759 lines) contains:

1. **HTTP Request Handling** (main POST handler)
   - Authentication/authorization
   - Query param parsing (?force, ?continue, ?stream)
   - Request validation

2. **Two Execution Paths:**
   - `handleStreamingAnalyze()` - SSE streaming (lines 326-1084)
   - `handleNonStreamingAnalyze()` - JSON response (lines 1086+)

3. **Analysis Logic:**
   - File text extraction from tender
   - Content hashing
   - Job creation/lookup
   - Chunk-based analysis with provider fallback
   - Progress tracking and checkpointing
   - Result merging and requirement staging

4. **Provider Management:**
   - Provider health checking
   - Fallback chain execution
   - Cooldown management
   - Error categorization

5. **Requirement Promotion:**
   - Staging analyzed requirements
   - Canonicalizing confirmed requirements
   - Guard against deleting final set

6. **Notification & Audit:**
   - User notifications on completion
   - Audit logging
   - Dashboard cache invalidation

**Phase 1 Action Items:**

### 1.1 Refactor Analysis Route to Use Job Service

**Files to Modify:**
- `app/api/tenders/[id]/ai-analyze/route.ts` (main refactoring)
- `lib/ai-jobs/analysis-job-service.ts` (may need extension)

**Changes:**
1. Replace direct `prisma.aiJob.create()` calls with `createAnalysisJob()`
2. Replace direct `prisma.aiJob.update()` calls with job service methods
3. Delegate chunk management to job service
4. Keep HTTP handling in route, delegate analysis orchestration to service

**New Contract:**

```typescript
// lib/ai-jobs/analysis-job-service.ts

export async function createAnalysisJob(input: AnalysisJobCreateInput) {
  // Creates job and initializes chunks
  // Returns { jobId, totalChunks, status, nextAction }
}

export async function runNextChunk(jobId: string, userId: string) {
  // Executes next QUEUED chunk
  // Returns chunk data or completion status
}

export async function updateChunkStatus(
  chunkId: string,
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED',
  result?: AIAnalysisResult,
  error?: string,
) {
  // Updates individual chunk status
}

export async function finalizeJob(
  jobId: string,
  status: 'SUCCEEDED' | 'PARTIAL_SUCCESS' | 'FAILED',
  output: JobCompletionOutput,
) {
  // Marks job as complete, persists final output
}

export async function resumeFromJob(
  jobId: string,
  userId: string,
): Promise<ResumeContext> {
  // Resumes analysis from previous chunks
}
```

### 1.2 Eliminate Direct Job Management from Route

**Remove:**
- Direct `prisma.aiJob.create()` calls
- Direct `prisma.aiJob.update()` calls  
- Direct `prisma.aiAnalyzeChunk.*` calls
- Job transaction logic
- Manual job state machine logic

**Delegate:**
- All job creation → `createAnalysisJob()`
- All chunk updates → job service
- All job state transitions → job service

### 1.3 Simplify Route to HTTP + Orchestration Only

**New Route Structure:**

```
POST /api/tenders/[id]/ai-analyze
├─ Parse request (auth, params)
├─ Create/resume job via service
├─ If streaming: use handleStreamingAnalyze()
├─ If JSON: use handleNonStreamingAnalyze()
├─ Both call shared analyzeWithJobService(jobId)
└─ Return response with jobId for tracking
```

### 1.4 Create Shared Analysis Orchestrator

**New File:** `lib/engine/analysis-orchestrator.ts`

Moves analysis logic from route into reusable service:

```typescript
export async function executeAnalysis(
  jobId: string,
  tenderId: string,
  userId: string,
  options?: {
    force?: boolean;
    deadlineMs?: number;
    onProgress?: (chunk: ChunkProgress) => void;
  },
): Promise<AnalysisResult> {
  // Core analysis logic extracted from route
  // Handles provider fallback, chunking, merging
  // Updates job state via service
}
```

### 1.5 Verify Job Service Covers All Cases

**Test Coverage Required:**
- [ ] Job creation with multiple files
- [ ] Resume from partial completion
- [ ] Provider failure and fallback
- [ ] Chunk processing with failures
- [ ] Concurrent requests for same tender
- [ ] Cold-start recovery from DB
- [ ] Edge cases: timeout, empty content, massive files

**Potential Gaps to Address:**
- Job locking during concurrent execution
- Chunk state consistency
- Atomic transitions (all-or-nothing completion)
- Error recovery without duplicate chunks
- Result merging from interrupted jobs

### 1.6 Testing Strategy

**Unit Tests:**
- `lib/ai-jobs/analysis-job-service.ts` edge cases
- Job state machine transitions
- Chunk status updates

**Integration Tests:**
- Full analysis flow end-to-end
- Resume from partial
- Concurrent requests
- Provider failures

**Route Tests:**
- Both streaming and JSON paths
- Proper error responses
- Job ID returned correctly

### 1.7 Rollout Plan

**Step 1:** Create analysis-orchestrator.ts (extract logic without changing route)  
**Step 2:** Extend analysis-job-service.ts with missing methods  
**Step 3:** Update route to use job service  
**Step 4:** Run tests to verify behavior identical  
**Step 5:** Monitor real usage for regressions  

**Estimated Effort:** 4-6 hours of implementation + testing

---

## Success Criteria

- [ ] Route no longer creates AiJob records directly
- [ ] All job state changes go through job service
- [ ] AnalysisJobService is single source of truth for job state
- [ ] All 3941 tests still pass
- [ ] Build succeeds with no new errors
- [ ] Analysis behavior identical to before refactoring
- [ ] Code is more testable and maintainable

---

## Risk Assessment

**Risk Level:** MEDIUM

**Mitigations:**
1. Extract logic first without changing behavior
2. Run tests continuously during refactoring
3. Keep route and service changes separate/reviewable
4. Have rollback plan if regressions appear

**Rollback Path:**
If critical issues appear, revert to previous commit and reassess.

---

## Dependencies for Phase 1

- Completed: Phase 0 (baseline audit) ✓
- Required: Understanding of AiJob schema ✓
- Required: Understanding of chunk processing ✓

**Next Phase:** Phase 2 (Implement API Contracts)
