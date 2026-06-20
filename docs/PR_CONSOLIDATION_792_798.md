# PR Consolidation Ledger (#792–#799)

This document tracks the final disposition of work from pull requests #792 through #799, which were merged or closed during the Phase 3 stabilization and unification effort.

## Overview

The core objective was to eliminate "resolver drift" where multiple modules (UI, API gates, export logic) were independently deciding whether a tender was "analyzed" or "ready."

The final architecture centralizes all logic into a **Canonical AI Analysis Resolver**:

1.  **Pure State Machine**: `lib/engine/analysis-state-resolver.ts` (`deriveAnalysisStateDetail`)
2.  **DB Adapter**: `lib/engine/analysis/tender-analysis-resolver.ts` (`resolveTenderAnalysisState`)
3.  **Unified Consumption**: Authority, Metadata, Plan, Workflow Center, and Reconcile routes now all consume the exact same truth.

## PR Disposition Summary

| PR | Status | Disposition | Destination / Merge Commit |
| :--- | :--- | :--- | :--- |
| #792 | ✅ CLOSED | Progress code extracted to #797; defects rejected. | Superseded by #797 and current unification work. |
| #793 | ✅ CLOSED | Boundary labels moved to #800. | Replaced by #800. |
| #794 | ✅ CLOSED | All changes rejected (security/ZIP-bomb/lock-in). | Tracking issue #801 created for hardened ODT/OCR. |
| #795 | ✅ CLOSED | PDF extraction + metadata safety. | Merged via #800. |
| #796 | ✅ CLOSED | Traceability code (sourceSectionHeading) extracted. | Superseded by #797 and current unification work. |
| #797 | ✅ CLOSED | Canonical AI Analyze engine (pure core). | Replaced by unified resolver in current branch. |
| #798 | 🏁 MERGED | P0 critical gaps (security/DB/observability). | Merged to main. |
| #799 | ✅ CLOSED | Resolver unification + modular truth split. | Fully unified in current branch (`claude/unify-analysis-truth-core`). |

## Final Architecture Disposition

### 1. The Unified Resolver (`lib/engine/analysis-state-resolver.ts`)

The pure state machine now handles all 9 mandatory states:
- `NOT_STARTED`, `QUEUED`, `RUNNING`, `AI_SUCCEEDED`, `PARTIAL_NEEDS_RESUME`, `REGEX_FALLBACK_UNAPPROVED`, `HUMAN_APPROVED_FALLBACK`, `FAILED`, `SUPERSEDED`.

**Critical Logic implemented:**
- **Success Preservation**: A latest failed job never hides a prior promoted success.
- **Resumability**: `PARTIAL_SUCCESS` status or partial chunks correctly trigger `PARTIAL_NEEDS_RESUME`.
- **Secret Redaction**: 8 key prefixes and `api_key` patterns are redacted from all diagnostics.
- **Legacy Support**: Fallback to `Tender.notes` for tenders with no usable `AiJob` records.

### 2. The Modular Truth Modules

Truth modules in `lib/engine/analysis/` have been refactored to consume the unified resolver:
- **Authority Truth**: Blocks unless `canExportWithAnalysisState` is true.
- **Plan Truth**: Blocks verification unless analysis is trusted.
- **Metadata Truth**: Consistent with canonical definitions.

### 3. Workflow Center & Reconcile Route

- **Tenant Isolation**: All resolver calls now pass `userId` through, ensuring no cross-tenant state leakage.
- **Stage Prioritization**: `RESUME_AI_ANALYZE` is now a distinct stage with its own action endpoint (`?continue=true`).
- **Safety**: `reconcile-state` route updates `Tender.status` to `ANALYZED` only when AI success is canonically confirmed.

## Verification Checklist

- [x] 24 unit tests in `tests/analysis-state-resolver.test.ts` (100% pass).
- [x] Type safety confirmed (`npm run typecheck`).
- [x] Linting confirmed (`npm run lint`).
- [x] Success preservation verified (failed retry does not block generation).
- [x] Secret redaction verified.
- [x] Tenant isolation verified in resolver signature and call sites.

