# Phase 1: Route Refactoring - Detailed Implementation Guide

**Objective:** Integrate AnalysisOrchestrator into the main analyze route, making the job service the single authority for job state.

**Current Status:** Analysis orchestrator created (308 lines), types verified, tests queued.

---

## Architecture Overview

### Current State (Before Refactoring)
```
app/api/tenders/[id]/ai-analyze/route.ts (1759 lines)
├─ HTTP handling (parsing, auth)
├─ Job creation (direct DB writes)
├─ Streaming logic (SSE)
├─ Non-streaming logic (JSON)
├─ Analysis execution (duplicated)
└─ Result handling & promotion
```

### Target State (After Refactoring)
```
app/api/tenders/[id]/ai-analyze/route.ts (600-700 lines, ~60% reduction)
├─ HTTP handling (parsing, auth)
├─ Request routing (streaming vs JSON)
├─ Status responses & error handling
└─ Calls to:
    ├─ AnalysisOrchestrator.executeAnalysis()
    ├─ AnalysisJobService methods
    └─ Result promotion (canPromoteToCanonical, etc.)
```

---

## Refactoring Strategy

### Phase 1a: Minimal Integration (This Session)
**Goal:** Get one code path using the orchestrator while maintaining all other paths exactly as-is.

**Approach:**
1. Keep 100% of current route logic intact
2. Add new import for AnalysisOrchestrator
3. Refactor ONE path (e.g., non-streaming) to use executeAnalysis()
4. Verify tests pass with hybrid approach
5. Document learned patterns for other paths

**Changes:**
- Minimal (single function replaced)
- Zero behavior change (identical API responses)
- Zero test breakage expected
- Safe to commit and deploy

### Phase 1b: Streaming Path Integration (Future Session)
**Goal:** Migrate streaming (SSE) path to use orchestrator.

**Approach:**
1. Extract onProgress callbacks
2. Wire up streaming responses from orchestrator progress events
3. Replace streaming analysis logic
4. Verify identical behavior

### Phase 1c: Full Consolidation (Future Session)
**Goal:** Remove all duplicate logic from route.

**Approach:**
1. Factor out common setup/teardown
2. Consolidate error handling
3. Simplify route to pure HTTP handler
4. Document final architecture

---

## Implementation Details: Phase 1a

### Files to Modify
- `app/api/tenders/[id]/ai-analyze/route.ts`

### Step 1: Import Orchestrator
Add near the top of the file:
```typescript
import { executeAnalysis, type AnalysisOrchestrationResult } from "../../../../lib/engine/analysis-orchestrator";
```

### Step 2: Identify Target Function
The non-streaming analysis (lines ~1086-1480) is the candidate for Phase 1a:
```typescript
// POST handler → handleNonStreamingAnalyze block (lines ~1086+)
// Handles: ?stream=false or default JSON response path
```

### Step 3: Extract into New Helper
Create helper function that adapts route callbacks to orchestrator:

```typescript
async function executeNonStreamingAnalysis(
  tenderId: string,
  userId: string,
  force: boolean,
  deadlineMs: number,
): Promise<AnalysisOrchestrationResult> {
  return executeAnalysis(tenderId, userId, {
    force,
    deadlineMs,
    onProgress: async (event) => {
      // Log progress (non-streaming, so no SSE output)
      if (event.phase === "complete") {
        console.log(`[ai-analyze] Analysis complete: ${event.message}`);
      }
    },
    onChunkStart: async ({ chunkIndex, totalChunks }) => {
      // Progress checkpoint (optional)
    },
    onChunkComplete: async ({ chunkIndex, totalChunks, result, provider }) => {
      // Update checkpoint (optional)
    },
    onChunkFailure: async ({ chunkIndex, totalChunks, errorMessage, provider }) => {
      // Log failure (optional)
    },
  });
}
```

### Step 4: Replace Non-Streaming Logic
In the non-streaming code path:

**Before:**
```typescript
const analysisMeta = await analyzeWithAI(tenderContent, {
  deadlineAt,
  startFromChunk,
  previousChunkResults,
  onChunkStart: onChunkStartNonStream,
  onChunkComplete: onChunkCompleteNonStream,
  onChunkFailure: onChunkFailureNonStream,
});
```

**After:**
```typescript
const result = await executeNonStreamingAnalysis(id, userId, force, SAFE_DEADLINE_MS);
const analysisMeta = {
  result: { /* extract from result */ },
  isPartial: result.isPartial,
  totalChunks: result.totalChunks,
  completedChunks: result.completedChunks,
  failedChunks: result.failedChunks,
  skippedChunks: 0,
  chunkProviders: [], // Extract from job
  chunkResults: [],
};
```

### Step 5: Adapt Response Building
The response object should be built from:
- Orchestrator result
- Job state (fetched from DB)
- Promotion state (existing logic)

### Step 6: Test & Verify
```bash
npm test 2>&1 | grep -E "PASS|FAIL|tests"
npm run typecheck
npm run build
```

---

## Integration Testing Checklist

After Phase 1a:

- [ ] All 3930+ tests passing
- [ ] TypeCheck clean
- [ ] Build green
- [ ] Non-streaming JSON responses identical
- [ ] Job creation still works
- [ ] Chunk resumption works
- [ ] Error handling identical
- [ ] No behavior regressions

---

## Risk Mitigation

### Potential Issues & Mitigations

**Issue:** Orchestrator doesn't handle all edge cases the route does
- **Mitigation:** Phase 1a is minimal; fallback to original logic in non-streaming path

**Issue:** Tests break due to new orchestrator
- **Mitigation:** Orchestrator is pass-through; no behavioral changes expected

**Issue:** Job state inconsistency
- **Mitigation:** Both orchestrator and route use same DB; state stays consistent

**Issue:** Provider health not updated
- **Mitigation:** markProviderAnalysisOK() still called in route; no change

---

## Success Criteria

**Phase 1a Complete When:**
1. Non-streaming path uses executeAnalysis()
2. All tests pass (3930+)
3. Behavior identical to before
4. Code is cleaner (less duplication)
5. Next path refactoring plan documented

**Estimated Effort:** 2-3 hours including testing

---

## Code Review Checklist

For PR review of Phase 1a:

- [ ] Orchestrator properly types all callbacks
- [ ] Error handling doesn't change behavior
- [ ] Job creation/state management identical
- [ ] Response structure unchanged
- [ ] All tests passing
- [ ] No new dependencies added
- [ ] Code is more testable

---

## Future Phases (Post-Phase 1)

### Phase 1b: Streaming Integration
- Refactor SSE path to use orchestrator
- Wire up onProgress → SSE events
- Estimated: 2-3 hours

### Phase 1c: Consolidation
- Factor out setup/teardown
- Unify error handling
- ~50% route size reduction
- Estimated: 3-4 hours

### Total Phase 1 Effort
- Phase 1a: 2-3 hours (this session)
- Phase 1b: 2-3 hours (future)
- Phase 1c: 3-4 hours (future)
- **Total: 7-10 hours over multiple sessions**

---

## Notes for Future Sessions

1. **Streaming Path Complexity:** The SSE path is more complex because it needs real-time progress updates. The orchestrator's onProgress callback maps well to SSE events.

2. **Job Service Integration:** By the end of Phase 1, all analysis goes through:
   - createAnalysisJob() ✓
   - executeAnalysis() (orchestrator) ✓
   - finalizeJob() or stagePartialResult() ✓

3. **No Fallback Yet:** Phase 1 doesn't include regex fallback. That's Phase 7. The orchestrator can be extended then.

4. **Testing Strategy:** Keep test suite running continuously. Phase 1a's minimal change should keep 100% green.

---

## Appendix: Code Locations Reference

**Route file:**
- Path: `app/api/tenders/[id]/ai-analyze/route.ts`
- Lines: 1759 total
- Streaming handler: ~326-1084
- Non-streaming handler: ~1086-1480
- Response building: ~1480-1759

**Orchestrator:**
- Path: `lib/engine/analysis-orchestrator.ts`
- Lines: 308 total
- Main function: executeAnalysis()
- Types: AnalysisOrchestrationOptions, AnalysisOrchestrationResult

**Job Service:**
- Path: `lib/ai-jobs/analysis-job-service.ts`
- Lines: 397 total
- Functions: createAnalysisJob(), runNextChunk(), finalizeJob()

---

## Session Readiness

Phase 1a refactoring is ready to begin once:
- [ ] Tests pass with orchestrator (background task)
- [ ] Team reviews integration plan
- [ ] Agreement on Phase 1a scope
- [ ] Ready to commit refactored code
