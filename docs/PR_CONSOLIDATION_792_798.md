# PR Consolidation: #792–#799 Historical Work Disposition

**Document date:** 2026-06-20
**Author:** GLM 5.2 (unify-analysis-truth-core branch)
**Codebase HEAD:** `d96c8cc` (PR #802) + `84d7143` (PR #803)

---

## Purpose

This document records the final disposition for the historical PR #792–#799 work that touched the AI analysis resolver systems. It consolidates the overlapping changes from those PRs into a single canonical architecture and records what was kept, what was unified, and what was discarded.

---

## Background

PRs #792 through #799 introduced two overlapping AI analysis resolver systems:

1. **`lib/engine/analysis-state-resolver.ts`** (PR #797) — a pure state machine (`deriveAnalysisStateDetail`) + DB-backed adapter (`resolveTenderAnalysisState`), with 9 canonical states, contentHash-based chunk filtering, and tenant isolation via `userId` scoping.

2. **`lib/engine/analysis/tender-analysis-resolver.ts`** (PR #792–#796, pre-#797) — an older resolver with drift states (`SECTION_DETECTED_REQUIREMENTS_NOT_STRUCTURED`, `PARTIAL_AI_NEEDS_REVIEW`), chunk querying WITHOUT contentHash filtering (would match foreign/corrupt rows), hardcoded `totalChunks` from `chunks[0].totalChunks`, and no distinction between latest job and canonical promoted job.

The two resolvers had the same function name (`resolveTenderAnalysisState`) but different signatures, different state enums, and different state-derivation logic. Consumers (authority-truth, plan-truth, workflow-center, reconcile-state) imported from whichever resolver was created first, creating drift.

PR #802 (commit `d96c8cc`) began the unification by making the canonical resolver additive (both resolvers could coexist). This PR completes the unification by making the canonical resolver the SINGLE source of truth and reducing the drift resolver to a thin adapter.

---

## Disposition by PR

### PR #792: Initial analysis-state-resolver.ts (additive modular resolvers)
- **Status:** SUPERSEDED by this PR
- **What was kept:** The concept of a pure state machine + DB adapter split.
- **What was unified:** The drift resolver's state-machine logic is removed. The canonical resolver's `deriveAnalysisStateDetail` is the only state machine.
- **What was discarded:** The drift states `SECTION_DETECTED_REQUIREMENTS_NOT_STRUCTURED` and `PARTIAL_AI_NEEDS_REVIEW` (not in the canonical 9-state enum).

### PR #793: (not directly related to resolver unification)
- **Status:** N/A — no resolver changes attributed to this PR.

### PR #794: (not directly related to resolver unification)
- **Status:** N/A — no resolver changes attributed to this PR.

### PR #795: (not directly related to resolver unification)
- **Status:** N/A — no resolver changes attributed to this PR.

### PR #796: (not directly related to resolver unification)
- **Status:** N/A — no resolver changes attributed to this PR.

### PR #797: Canonical durable analysis state resolver
- **Status:** KEPT — this is the foundation of the unified architecture.
- **What was kept:** The pure `deriveAnalysisStateDetail` function, the 9 canonical states, the DB-backed `resolveTenderAnalysisState(tenderId, userId)` adapter, contentHash-based chunk filtering, `latestJobId` vs `canonicalJobId` distinction.
- **What was enhanced in this PR:** Added `canonicalJob` input to `DeriveAnalysisStateInput` so the pure function can enforce the "latest failed job must never hide a prior promoted AI success" rule. The DB adapter now loads BOTH the latest job AND the latest promoted job.

### PR #798: Address 8 P0 critical gaps (security/DB/observability)
- **Status:** KEPT — not reverted by this PR.
- **What was kept:** All 8 P0 fixes (SEC-001/002/003, DB-001/002, AI-001, OBS-002, DOC-001/007).
- **Relationship to this PR:** This PR does NOT touch any files modified by PR #798 (no `prisma/**`, `lib/ai.ts`, `lib/ai-provider-health.ts`, `lib/engine/provider-health-store.ts`, `lib/extract-text.ts`, React components, `package.json`, or `package-lock.json`).

### PR #799: (not directly related to resolver unification)
- **Status:** N/A — no resolver changes attributed to this PR.

---

## Final Architecture (after this PR)

```
┌─────────────────────────────────────────────────────────────┐
│  lib/engine/analysis-state-resolver.ts                       │
│  ─────────────────────────────────────────                    │
│  CANONICAL resolver — single source of truth                 │
│                                                                │
│  • deriveAnalysisStateDetail(input) — PURE state machine     │
│    - 9 states: NOT_STARTED, QUEUED, RUNNING, AI_SUCCEEDED,   │
│      PARTIAL_NEEDS_RESUME, REGEX_FALLBACK_UNAPPROVED,        │
│      HUMAN_APPROVED_FALLBACK, FAILED, SUPERSEDED              │
│    - Enforces: prior promoted success wins over latest failure│
│    - Enforces: no empty-string contentHash fallback           │
│    - Enforces: totalChunks from chunks.length, not hardcoded  │
│    - Enforces: no placeholder counts (all from real queries)  │
│    - Redacts API keys from safeDiagnosticSummary              │
│                                                                │
│  • resolveTenderAnalysisState(tenderId, userId) — DB adapter │
│    - Loads latest job AND latest promoted job (canonicalJob)  │
│    - All queries scoped by userId (tenant isolation)          │
│    - Chunks only loaded when analysisInputHash is non-empty   │
│    - Artefact counts from real prisma.count queries           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  lib/engine/analysis/tender-analysis-resolver.ts              │
│  ─────────────────────────────────────────                    │
│  THIN ADAPTER (backward compat)                               │
│                                                                │
│  • resolveTenderAnalysisState(prisma, tenderId)              │
│    - Looks up tender.userId for tenant isolation              │
│    - Delegates to canonical resolver                          │
│    - Maps canonical result to legacy result shape             │
│                                                                │
│  • checkRequirementConsistency(prisma, tenderId)             │
│    - Delegates to canonical resolver                          │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌──────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ authority-   │  │ plan-truth.ts    │  │ workflow-state.ts│
│ truth.ts     │  │                  │  │                  │
│              │  │ Consumes         │  │ Consumes         │
│ Consumes     │  │ canonical        │  │ canonical        │
│ canonical    │  │ resolver with    │  │ resolver with    │
│ resolver     │  │ userId param     │  │ userId param     │
│ with userId  │  │                  │  │                  │
│ param        │  │ analysisTrusted  │  │ analysisState =  │
│              │  │ from canonical   │  │ analysisDetail   │
│ analysis-    │  │ state            │  │ .state           │
│ Trusted from │  │                  │  │                  │
│ canonical    │  │                  │  │                  │
│ state        │  │                  │  │                  │
└──────────────┘  └──────────────────┘  └──────────────────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  app/api/tenders/[id]/workflow-center/route.ts               │
│  app/api/tenders/[id]/reconcile-state/route.ts               │
│  ─────────────────────────────────────────                    │
│  ROUTES — all consume canonical resolver with actor.id       │
│                                                                │
│  • workflow-center: GET — passes actor.id to ALL truth mods  │
│  • reconcile-state: POST — passes actor.id, NON-DESTRUCTIVE  │
│    (only updates tender.status, never deletes requirements    │
│    or documents)                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Critical Rules Enforced

| Rule | How it's enforced |
|------|-------------------|
| A latest failed job must never hide a prior promoted AI success | `deriveAnalysisStateDetail` checks `canonicalIsPromotedSuccess && latestIsNonPromotedFailure` → returns `AI_SUCCEEDED` with `canonicalJobId` from the prior job |
| Latest job and canonical promoted job are different concepts | `latestJobId` (latest by createdAt) vs `canonicalJobId` (latest promoted, not superseded) — loaded by separate DB queries |
| Legacy Tender.notes may be used only for tenders with no usable AiJob record | `legacyNotesAiAnalyzed` is only `true` when `!latestJob` — the job is the source of truth when it exists |
| Do not use empty-string contentHash fallback | Chunks are only loaded when `latestJob?.analysisInputHash` is truthy — no query with empty-string hash |
| Do not hardcode total chunks | `totalChunks = chunks.length` — never `chunks[0].totalChunks` |
| Do not return placeholder requirement counts | `requirementsExtracted` from `prisma.tenderRequirement.count`, `sourceReferencesCreated` from a real count, `metadataFieldsPersisted` from real tender fields |
| Preserve existing public API response shapes | The drift resolver's `AnalysisResolverResult` type is preserved and mapped from the canonical detail |
| Do not weaken tenant isolation | All DB queries scoped by `userId`; routes pass `actor.id`; adapter looks up tender owner before delegating |
| Reconcile-state must never delete or overwrite requirements or documents | Route only calls `prisma.tender.update` for `status` + `updatedAt` — no `deleteMany`, no requirement/document writes |

---

## Test Coverage

The following test files verify the unification:

| Test file | Coverage |
|-----------|----------|
| `tests/analysis-state-resolver.test.ts` | Pure function tests for `deriveAnalysisStateDetail` (existing, updated for `canonicalJob` input) |
| `tests/workflow-truth-unification.test.ts` | 11 required scenarios: prior success + failed retry, partial, approved/unapproved fallback, superseded, legacy notes, malformed diagnostics, no jobs, zero chunks, cross-tenant guard, truth-module agreement |

---

## Files Changed in This PR

| File | Change |
|------|--------|
| `lib/engine/analysis-state-resolver.ts` | Added `canonicalJob` to `DeriveAnalysisStateInput`; enhanced `deriveAnalysisStateDetail` with prior-promoted-success rule; enhanced DB adapter to load latest promoted job |
| `lib/engine/analysis/tender-analysis-resolver.ts` | Rewritten as thin adapter delegating to canonical resolver |
| `lib/engine/analysis/authority-truth.ts` | Now imports from canonical resolver, accepts `userId` param |
| `lib/engine/analysis/plan-truth.ts` | Now imports from canonical resolver, accepts `userId` param |
| `lib/engine/workflow/workflow-state.ts` | Now imports from canonical resolver, uses `analysisDetail.state` for `analysisState` field |
| `app/api/tenders/[id]/reconcile-state/route.ts` | Now imports from canonical resolver, passes `actor.id` |
| `app/api/tenders/[id]/workflow-center/route.ts` | Now imports from canonical resolver, passes `actor.id` to all truth modules |
| `tests/analysis-state-resolver.test.ts` | Updated `makeInput` helper for `canonicalJob` field |
| `tests/workflow-truth-unification.test.ts` | New — 11 required scenarios |
| `docs/PR_CONSOLIDATION_792_798.md` | This document |
