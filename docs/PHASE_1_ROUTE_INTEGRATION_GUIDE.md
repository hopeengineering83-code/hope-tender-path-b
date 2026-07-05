# Phase 1: Route Integration Guide

## Status: Foundation Complete, Integration Ready

The orchestrator foundation is complete and merged to main with all improvements:
- ✅ Stage 1 shared builders for content determinism
- ✅ Proper checkpoint resumption logic
- ✅ Error handling and logging
- ✅ Content hash storage
- ✅ All 3,959 tests passing

## Integration Approach

Rather than a complete rewrite, we're creating a clean separation of concerns:

**Orchestrator (durable service):** Handles
- Job creation and resumption
- Content building (shared builders)
- Content hashing
- Checkpoint management
- Core analysis execution via analyzeWithAI
- Job result tracking

**Route (HTTP layer):** Handles
- Pre-flight validation (extraction quality checks)
- Post-processing (promotion, requirement creation, response formatting)
- Error recovery and fallback logic
- User notifications

## Implementation Steps

### Phase 1a: Route Integration (Lines 1037-1184)

**Current flow (non-streaming path):**
```
1. Build content + compute hash (lines 1042-1045)
2. Checkpoint management (lines 1046-1070)
3. Job creation (lines 1072-1111)
4. Callback setup (lines 1122-1166)
5. Call analyzeWithAI (lines 1167-1172)
6. Result handling (lines 1186+)
```

**New flow (with orchestrator):**
```
1. Call executeAnalysis → handles steps 1-5 above
2. Receive AnalysisOrchestrationResult
3. Process result for promotion (step 6)
4. Create requirements in transaction
5. Update extraction status
6. Send response
```

### Phase 1b: Create Route Wrapper Function

Location: app/api/tenders/[id]/ai-analyze/route.ts (near line 1036)

```typescript
/**
 * Execute analysis using orchestrator with route-level post-processing.
 * Handles job tracking, promotion, requirement creation, and error recovery.
 */
async function executeAnalysisViaOrchestrator(
  tenderId: string,
  userId: string,
  options: {
    force?: boolean;
    company?: typeof company;
    tenderContent?: string; // Pre-computed for efficiency
  }
): Promise<{
  meta: AnalysisWithMeta | null;
  jobId: string;
  analysisSource: "AI" | "PARTIAL_AI" | "REGEX_FALLBACK";
}> {
  // Call orchestrator
  const result = await executeAnalysis(tenderId, userId, {
    force: options.force,
    deadlineMs: SAFE_DEADLINE_MS,
    onProgress: (event) => {
      // Could emit progress to caller if needed
      console.debug("[route] orchestrator progress:", event.phase);
    },
    onChunkStart: async (info) => {
      await upsertAnalyzeChunkStarted({
        tenderId,
        userId,
        contentHash: computeHash, // Track hash
        chunkIndex: info.chunkIndex,
        totalChunks: info.totalChunks,
      });
    },
    onChunkComplete: async (info) => {
      await upsertAnalyzeChunkSucceeded({
        tenderId,
        userId,
        contentHash: computeHash,
        chunkIndex: info.chunkIndex,
        totalChunks: info.totalChunks,
        result: info.result,
        provider: info.provider,
      });
    },
    onChunkFailure: async (info) => {
      await upsertAnalyzeChunkFailed({
        tenderId,
        userId,
        contentHash: computeHash,
        chunkIndex: info.chunkIndex,
        totalChunks: info.totalChunks,
        errorMessage: info.errorMessage,
        provider: info.provider,
      });
    },
  });

  // Fetch full AI result from completed job
  const job = await prisma.aiJob.findUnique({
    where: { id: result.jobId },
    select: { stagedMergedResult: true },
  });

  // Parse staged result to get full AIAnalysisResult
  const stagedResult = job?.stagedMergedResult 
    ? JSON.parse(job.stagedMergedResult) 
    : null;

  return {
    meta: {
      result: stagedResult?.result,
      isPartial: result.isPartial,
      totalChunks: result.totalChunks,
      completedChunks: result.completedChunks,
      failedChunks: result.failedChunks,
      skippedChunks: 0,
      chunkProviders: [], // Retrieved from job
      chunkResults: stagedResult?.chunkResults ?? [],
    },
    jobId: result.jobId,
    analysisSource: result.analysisSource as any,
  };
}
```

### Phase 1c: Update Non-Streaming Path (Lines 1037+)

Replace the large try/catch block with:

```typescript
if (isAIEnabled()) {
  try {
    // Restore provider health
    await Promise.race([
      restoreHealthFromDb(),
      new Promise<void>((r) => setTimeout(r, 2_000)),
    ]).catch(() => {});

    // Use orchestrator for analysis
    const orchestratorResult = await executeAnalysisViaOrchestrator(
      id,
      userId,
      {
        force,
        company,
        // tenderContent could be pre-computed for efficiency
      }
    );

    const aiMeta = orchestratorResult.meta;
    const aiResult = aiMeta?.result;

    // Rest of promotion and requirement creation logic stays the same
    // (lines 1187-1356 unchanged)
    
  } catch (aiErr) {
    // Error handling unchanged
    // Falls back to runRegexFallback()
  }
} else {
  // No AI provider path unchanged
}
```

## Key Design Decisions

### 1. Checkpoint Tracking
- Route still calls `upsertAnalyzeChunkStarted/Succeeded/Failed` via orchestrator callbacks
- Ensures checkpoint data is immediately available for resume
- Maintains consistency between orchestrator job and route's checkpoint records

### 2. Staged Result Handling
- Orchestrator stores result in `aiJob.stagedMergedResult`
- Route fetches this for promotion
- Allows async processing while maintaining non-destructive semantics

### 3. Error Recovery
- If orchestrator succeeds but promotion fails: result stays staged
- If orchestrator fails: falls back to regex analysis
- If both fail: error response with retry guidance

### 4. Backward Compatibility
- Streaming path (handleStreamingAnalyze) remains unchanged
- HTTP response format unchanged
- Job tracking unchanged (same AiJob records)

## Testing Checklist

- [ ] All 3,959 tests still pass
- [ ] Non-streaming path uses orchestrator for all new analyses
- [ ] Checkpoint resumption works correctly
- [ ] Partial analysis staging works
- [ ] Canonical promotion with version guard works
- [ ] Fallback path still functions when AI fails
- [ ] Error messages properly sanitized
- [ ] Provider health tracking continues
- [ ] Audit logging captures orchestrator usage
- [ ] Extraction status updates correctly based on analysis result

## Performance Implications

- **Positive**: One shared code path for content building (less drift)
- **Positive**: Orchestrator can be optimized independently
- **Neutral**: No change to end-to-end latency (same analyzeWithAI call)
- **Future**: Enables durable background processing for long-running analyses

## Post-Integration Tasks

1. **Monitor Production**
   - Verify orchestrator job creation/tracking
   - Confirm checkpoint resumption works end-to-end
   - Check provider health tracking

2. **Durable Service Setup**
   - Wire up background job processor
   - Configure retry policies
   - Set up monitoring/alerts

3. **Performance Optimization**
   - Profile orchestrator vs inline execution
   - Optimize checkpoint polling if needed
   - Consider chunking strategy tuning

## Files Modified in Phase 1

- `app/api/tenders/[id]/ai-analyze/route.ts` (non-streaming path refactored)
- No changes to streaming path
- No changes to orchestrator
- No changes to core AI logic

## Emergency Rollback

If issues arise in production:

```bash
# Revert to inline analyzeWithAI (restore from git)
git revert <phase-1-integration-commit>

# Route will fall back to non-orchestrator path
# All checkpoint data is preserved
```

The fallback is safe because:
- Checkpoint data is stored independently
- No database migrations required
- Original flow is still available

---

**Status**: Ready for implementation  
**Complexity**: Medium (clear, step-by-step refactor)  
**Risk**: Low (fallback available, tests guide correctness)  
**Est. Time**: 2-3 hours (integration + testing + fixes)
