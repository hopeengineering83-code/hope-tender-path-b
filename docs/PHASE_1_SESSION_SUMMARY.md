# Phase 1: Session Progress Summary

**Session Date:** 2026-06-21 (continuing from Phase 0)
**Status:** Phase 1a attempted, then REVERTED — blocker identified
**Commits:** orchestrator scaffolding retained; route integration reverted

---

## Outcome: Phase 1a Integration Reverted (with reason)

Phase 1a wired the Analysis Orchestrator into the non-streaming analysis
path. During Phase 1b prep, a **correctness regression** was found in that
integration and it was reverted before merge. The orchestrator file remains
as scaffolding for a future, corrected integration.

### Why it was reverted — state/hash divergence

The orchestrator delegates job creation to `createAnalysisJob()` in
`lib/ai-jobs/analysis-job-service.ts`. That service:

1. Builds its **own** tender text directly from raw `file.extractedText`
   (no `extractRelevantSections`, no company-document context, no
   `MAX_TOTAL_AI_CHARS` cap, different file marker format).
2. Computes a **full 64-char sha256** of that normalized text.
3. Creates `AiAnalyzeChunk` rows keyed by **that** hash, with a chunk count
   from `aiChunkTenderContent(rawText)`.

The HTTP route, by contrast:

1. Builds a **sophisticated** `tenderContent` (section extraction + company
   context + char cap + `formatTenderFileAnalysisMarker`).
2. Computes a **truncated 16-char** sha256 of it.
3. Writes its durable checkpoint `AiAnalyzeChunk` rows (via
   `upsertAnalyzeChunk*`) keyed by **that** 16-char hash, and runs resume
   discovery (`getCompletedChunkResults`, `findLatestResumableAiAnalyzeJob`)
   against those rows.

**The consequence:** the orchestrator's job/chunk rows and the route's
checkpoint rows live under **different content hashes** and can have
**different chunk counts**. Resume discovery and the orchestrator's chunk
tracking would operate on disjoint data — a real regression versus the
original non-streaming path, which created exactly one `AiJob` and used one
consistent content hash end to end.

### Decision

The original non-streaming logic is battle-tested (TOCTOU advisory locks,
content-hash resume, non-destructive staging/promotion) and all 3930 tests
pass on it. Wiring in the orchestrator before the state/hash schemes are
unified would trade correctness for premature consolidation. Reverted to the
original path; all tests green.

---

## Prerequisite for a Correct Orchestrator Integration (Phase 4 dependency)

A safe integration requires unifying the **state writer** first (roadmap
Phase 4). Concretely:

- `createAnalysisJob()` must accept **pre-built content + content hash** from
  the caller (the route) instead of rebuilding from raw text, so the job
  service and the route checkpoints share one hash and one chunk count.
- The checkpoint hash (16-char) and the job `analysisInputHash` (64-char)
  must be reconciled to a single scheme.
- Only then can the route delegate execution to `executeAnalysis()` without
  forking the resume/checkpoint state.

Until that unification lands, the orchestrator (`lib/engine/analysis-orchestrator.ts`)
stays as **unused scaffolding** — it is not imported by the route.

---

## What Remains Valid From This Session

- ✅ `lib/engine/analysis-orchestrator.ts` — scaffolding for future use
- ✅ `docs/PHASE_1_ROUTE_REFACTORING.md` — refactoring guide (note: assumes
  the Phase 4 state unification as a prerequisite)
- ✅ Phase 0 audit and roadmap unchanged
- ✅ All 3930 tests passing on the reverted, original analysis path

---

## Corrected Roadmap Ordering

The original plan put route consolidation (Phase 1) before the unified state
writer (Phase 4). This session demonstrates the dependency runs the other
way for the analysis path:

1. **Phase 4 first (for analysis):** unify job-service content/hash with the
   route checkpoint scheme.
2. **Then Phase 1:** delegate the route's non-streaming and streaming paths
   to the orchestrator, now that state is single-sourced.

Other Phase 1–3 work that does not depend on the analysis state writer can
still proceed independently.
