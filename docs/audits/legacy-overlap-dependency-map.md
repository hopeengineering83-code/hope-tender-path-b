# Legacy, Overlap, and Dependency Map

**Branch:** `audit/legacy-overlap-dependency-map`  
**Captured:** 2026-06-12  
**Base SHA:** `0d4d4f644ad759af3d4247e32589f63143394e15` (post PR #700 merge)  
**Purpose:** Identify every location in the codebase where the same responsibility is implemented more than once, so that a single fix to one implementation does not silently weaken another. This document drives the PR 2-5 migration sequence.

---

## Executive Summary

The codebase has grown through multiple independent PRs without a unifying consolidation pass. The result is:

1. **13 readiness-computation modules** covering overlapping responsibilities — no single canonical path from DB read to UI display.
2. **Build-time source mutation** (`scripts/patch-resumable-ai-analyze.mjs`) that patches 3 TypeScript source files at Vercel build time, meaning the production code does not match what `npm run dev` and `tsc --noEmit` see.
3. **Local inline color/status decisions** in `tender-detail.tsx` and multiple panel components that predate and contradict the canonical `lib/engine/canonical-readiness-state.ts` + `components/canonical-status-badge.tsx` system added in PR #696.
4. **Deprecated `lib/engine/generate.ts`** explicitly marked `@deprecated` with no importers — safe to delete.
5. **`LegacyTenderActionHider`** — a DOM-mutation component that hides duplicate action buttons as a workaround for overlapping panels rendering the same button.
6. **PR #699** introduces `lib/ui-tokens.ts` (good canonical pattern) but one of its own component changes immediately contradicts it by keeping local inline color logic.

---

## 1. Readiness Dependency Map

### 1.1 All Readiness Modules

| File | Exported Functions | Status |
|------|--------------------|--------|
| `lib/tender-readiness-state.ts` | `computeTenderReadinessState()` | KEEP — input to canonical state |
| `lib/engine/canonical-readiness-state.ts` | `computeCanonicalModuleStates()`, `CANONICAL_STATUS_CONFIG` | KEEP — canonical (PR #696) |
| `lib/tender-generation-readiness.ts` | `getTenderGenerationReadiness()` | KEEP — async DB-backed generation gate |
| `lib/canonical-tender-readiness.ts` | `getCanonicalTenderReadiness()` | KEEP — wraps generation readiness + matching + docs |
| `lib/engine/export-readiness.ts` | `checkExportReadiness()`, `checkFullExportReadiness()`, `exportReadinessError()`, `documentHygieneIssues()`, `extractDocxVisibleText()` | KEEP |
| `lib/engine/final-submission-readiness.ts` | `getFinalSubmissionReadiness()` | KEEP — deepest export gate |
| `lib/engine/readiness-scoring.ts` | `computeReadinessScore()` | KEEP — numeric score aggregator |
| `lib/engine/proposal-evidence-readiness.ts` | (evidence readiness) | KEEP |
| `lib/engine/export-byte-readiness.ts` | `checkExportFileByteReadiness()` | KEEP |
| `lib/engine/deep-reasoning-readiness.ts` | (deep reasoning gate) | KEEP |
| `lib/ai-environment-readiness.ts` | (AI provider readiness) | KEEP |
| `lib/company-ingestion-readiness.ts` | `getCompanyIngestionReadiness()` | KEEP |
| `lib/system-readiness.ts` | (system health) | KEEP |

### 1.2 Readiness Call Chain (UI → DB)

**Generation readiness path (primary panel):**
```
app/dashboard/tenders/[id]/page.tsx (SSR)
  → getTenderGenerationReadiness(prisma, userId, tenderId)        [lib/tender-generation-readiness.ts]
    → assessTenderAnalysisQuality(...)                            [lib/analysis-quality.ts]
    → assessMatchingQuality(...)                                  [lib/matching-quality.ts]
    → assessTenderMetadataCompleteness(...)                       [lib/engine/tender-metadata-completeness.ts]
    → detectBrandingPolicy(...)                                   [lib/engine/export-format-policy.ts]
    → detectAnalysisSourceWithApproval(...)                       [lib/engine/analysis-source.ts]
    → DB reads: tender, requirements, expertMatches, projectMatches, complianceGaps, generatedDocuments
  → ALSO calls: app/api/tenders/[id]/generation-readiness/route.ts (separate client-side refetch)
```

**Problem:** The SSR page (`page.tsx`) calls `getTenderGenerationReadiness` at render time AND the client-side `GenerationReadinessPanel` component independently fetches from `/api/tenders/[id]/generation-readiness/route.ts` which also calls `getTenderGenerationReadiness`. This means the generation readiness computation runs TWICE per page load with potentially different timing and DB state.

**Export/download path:**
```
app/api/tenders/[id]/download/route.ts
  → checkExportReadiness(prisma, tenderId, userId)               [lib/engine/export-readiness.ts]
  → getTenderGenerationReadiness(prisma, userId, tenderId)       [lib/tender-generation-readiness.ts]
  → getFinalSubmissionReadiness(prisma, tenderId, userId)        [lib/engine/final-submission-readiness.ts]
```

**Export-readiness panel path:**
```
app/api/tenders/[id]/export-readiness/route.ts
  → getFinalSubmissionReadiness(prisma, tenderId, userId)        [lib/engine/final-submission-readiness.ts]
    → computeReadinessScore(input)                               [lib/engine/readiness-scoring.ts]
    → checkExportReadiness(prisma, tenderId, userId)             [lib/engine/export-readiness.ts]
```

**Canonical readiness path (used by /readiness panel):**
```
app/api/tenders/[id]/readiness/route.ts
  → getCanonicalTenderReadiness(prisma, userId, tenderId)        [lib/canonical-tender-readiness.ts]
    → getTenderGenerationReadiness(...)                          [lib/tender-generation-readiness.ts]
    → assessMatchingQuality(...)                                 [lib/matching-quality.ts]
    → getCompanyIngestionReadiness(...)                          [lib/company-ingestion-readiness.ts]
    → buildSubmissionPlan(...)                                   [lib/engine/submission-plan.ts]
```

**Readiness-score route (dashboard widget):**
```
app/api/tenders/[id]/readiness-score/route.ts
  → getFinalSubmissionReadiness(...)                             [lib/engine/final-submission-readiness.ts]
  → computeReadinessScore(...)                                   [lib/engine/readiness-scoring.ts]
```

### 1.3 Duplicate "readyForGeneration" Computations

| Location | How It Computes | Risk If Changed |
|----------|-----------------|-----------------|
| `lib/tender-generation-readiness.ts` → `fullProposalReady` | Full DB-backed score including compliance, matching, metadata | Canonical; all other points should delegate to this |
| `app/dashboard/tenders/[id]/page.tsx` line ~100 | Calls `getTenderGenerationReadiness` directly in SSR | Duplicates the API route result; causes double compute |
| `app/dashboard/tenders/[id]/tender-detail.tsx` → `canGenerateDocs` line 1475 | Local inline logic: `!analysisIsFallbackUnapproved && ...` | SHADOW — does NOT call the canonical function; can diverge |
| `app/api/tenders/[id]/generate/route.ts` | Re-checks extraction, compliance gaps, metadata, plan | Gate-level re-verification at point of action — KEEP |
| `lib/matching-quality.ts` → `structuralReadyForGeneration()` in matching-quality route | Structural check only (state machine) | Supplementary, not a full gate |

**Regression risk:** `tender-detail.tsx:canGenerateDocs` controls the Generate Docs button. If the canonical `getTenderGenerationReadiness` changes its blocking logic, `canGenerateDocs` will not reflect the change — the button may appear enabled when the server gate would block it.

---

## 2. Icon / Status Decision Map

### 2.1 Canonical System (PR #696 — UNUSED in most of the UI)

**Canonical components:**
- `lib/engine/canonical-readiness-state.ts` — `CANONICAL_STATUS_CONFIG` (8 statuses → Tailwind classes)
- `components/canonical-status-badge.tsx` — `CanonicalStatusBadge`, `CanonicalStatusIcon`

**Current production consumers of `CanonicalStatusBadge`/`CanonicalStatusIcon`:**
- **Zero production pages** — only referenced in `tests/canonical-readiness-contradictions.test.ts`

**Current production consumers of `CanonicalReadinessScoreWidget`:**
- `app/dashboard/tenders/[id]/tender-detail.tsx` line 2012 — one widget

### 2.2 Shadow Color Logic in Production UI

The following files contain local `severity/status → color` logic that bypasses the canonical system:

| File | Pattern | Severity Mapping |
|------|---------|-----------------|
| `tender-detail.tsx` line 175 | `mimeType → bg/text class` map | Local, no canonical |
| `tender-detail.tsx` line 208 | `trustLevel → badge` (REVIEWED/AI_DRAFT) | Local, no canonical |
| `tender-detail.tsx` line 383 | `GAP_SEVERITY_STYLE` map (CRITICAL/HIGH/MEDIUM/LOW) | Local |
| `tender-detail.tsx` line 1423 | `criticalGaps` re-computed inline | Duplicates generate route gate |
| `tender-detail.tsx` line 1519 | `hasCriticalGapBlock` inline filter | Duplicates generate route gate |
| `components/requirement-coverage-panel.tsx` line 469 | `pct >= 70 / 40` inline colors | Should use `confidenceToSeverity` (PR #699 inconsistency) |
| `app/share/[token]/page.tsx` | Local `getStatusColor` / `getSeverityIcon` helpers | Shadow of canonical |
| `app/dashboard/tenders/[id]/command-center/page.tsx` | Local severity → color | Shadow of canonical |
| `app/dashboard/tenders/[id]/report/page.tsx` | Local severity → color | Shadow of canonical |
| `app/dashboard/company/review/page.tsx` | Local severity → color | Shadow of canonical |
| `app/dashboard/system/page.tsx` | Local severity → color | Shadow of canonical |
| `app/dashboard/analytics/page.tsx` | Local severity → color | Shadow of canonical |

### 2.3 Migration Status of UI Token System

PR #699 introduced `lib/ui-tokens.ts` — an excellent canonical token system. Adoption is partial:

| Component | Uses `lib/ui-tokens.ts` | Still Has Local Colors |
|-----------|--------------------------|------------------------|
| `extraction-quality-dashboard.tsx` | Yes (PR #699) | Minor inline red/amber for page counts |
| `analysis-quality-panel.tsx` | Partial (PR #699) | `severityClass` map still inline (lines 97-102 of PR diff) |
| `export-readiness-panel.tsx` | No | `SEVERITY_BADGE` map defined locally in file |
| `requirement-coverage-panel.tsx` | No (PR #699 adds new local logic) | **New local inline colors added in PR #699** |
| `metadata-completion-panel.tsx` | No | All local Tailwind strings |
| `tender-detail.tsx` | No | Extensive local maps |

---

## 3. AI Analyze Data-Flow Map

### 3.1 Pre-Build vs Post-Build Divergence (CRITICAL)

`scripts/patch-resumable-ai-analyze.mjs` patches 3 source files **at Vercel build time only**:

| File | What Gets Patched | Dev/Typecheck State |
|------|-------------------|---------------------|
| `lib/ai.ts` | Adds `AnalysisChunkCacheEntry` type; adds `previousChunkResults` param to `analyzeWithAI`; adds `chunkResults` to return value | Unpatched — `analyzeWithAI` does not accept `previousChunkResults` |
| `app/api/tenders/[id]/ai-analyze/route.ts` | Upgrades resume bootstrap to load previous chunk results from job output; adds auto-resume discovery on content-hash match | Unpatched — old resume logic |
| `app/dashboard/tenders/[id]/tender-detail.tsx` | Makes streaming client pass `?continue=jobId` on subsequent analyze calls | Unpatched — never sends `continue` param |

**Regression risk:** TypeScript typechecks the UNPATCHED source. If `lib/ai.ts` is modified in a way that conflicts with the patch targets (e.g. reformatting the `AnalysisWithMeta` type or renaming `analyzeWithAI`'s parameter block), the build-time patch will **throw** with a `[patch-resumable-ai-analyze] Could not find patch target` error, silently blocking Vercel deploys without a clear local signal.

### 3.2 AI Analyze Data Flow

```
POST /api/tenders/[id]/ai-analyze
  ├── Auth check (getSession + REVIEWER role)
  ├── [PRODUCTION ONLY] Resume bootstrap: load previousChunkResults from existing job
  ├── Content extraction: prisma.tender.findFirst → files → extractedText
  ├── analyzeWithAI(tenderContent, { deadlineAt, startFromChunk, previousChunkResults })
  │     ├── Provider chain: Gemini → Anthropic → OpenAI → Groq → OpenRouter → DeepSeek
  │     ├── Chunking (if content > threshold)
  │     ├── Per-chunk AI call with fallback
  │     └── Returns AnalysisWithMeta { result, chunkResults, isPartial, ... }
  ├── Regex fallback (if all providers fail): detectAnalysisSource = REGEX_FALLBACK_AI_ERROR
  ├── DB writes: tender.update (analysisSummary, requirements, etc.) + aiJob.update
  └── [PRODUCTION ONLY] chunkResults saved to job.output for resume
```

### 3.3 AI Analyze Consumers of Extracted Data

| What Reads Analysis Data | Where | Risk |
|--------------------------|-------|------|
| `lib/tender-generation-readiness.ts` | Via `assessTenderAnalysisQuality` | Changes to analysis fields → readiness score changes |
| `app/api/tenders/[id]/analysis-quality/route.ts` | Direct DB read + `assessTenderAnalysisQuality` | Duplicate of generation readiness sub-score |
| `app/api/tenders/[id]/generate/route.ts` | `assertAnalysisReadyForFinalGeneration` + quality checks | Generation gate |
| `app/dashboard/tenders/[id]/page.tsx` | SSR → `getTenderGenerationReadiness` | SSR page render |
| `components/analysis-quality-panel.tsx` | `/api/tenders/[id]/analysis-quality` | Client-side panel |
| `lib/engine/analysis-source.ts` | `detectAnalysisSourceWithApproval` | Used by 6+ routes |

### 3.4 Fallback Path

```
All AI providers exhausted
  → analyzeWithAI returns partial/empty result
  → ai-analyze route falls back to regex extraction
  → analysisSource = "REGEX_FALLBACK_AI_ERROR" stored in tender.notes
  → tender.analysisExtractionStatus = "REGEX_FALLBACK_FROM_WEAK_EXTRACTION"
  → detectAnalysisSourceWithApproval returns "REGEX_FALLBACK_AI_ERROR"
  → generation-readiness: isUnapprovedFallback = true → blocks fullProposalReady
  → generate route: assertAnalysisReadyForFinalGeneration throws → 422
```

**Shadow path risk:** `tender-detail.tsx:canGenerateDocs` line 1475 checks `!analysisIsFallbackUnapproved` — but `analysisIsFallbackUnapproved` is derived from local state set by the streaming SSE response from the AI analyze call. If the user navigates away and back, this local state is reset and may not reflect the actual `analysisSource` stored in DB. The canonical check in the generate route will still block, but the button in the UI may incorrectly appear enabled.

---

## 4. Recovery-Action Dependency Map

### 4.1 Recovery Command Center Architecture

| File | Role |
|------|------|
| `lib/recovery-command-actions.ts` | Defines `RECOVERY_COMMAND_ACTIONS` record (all action specs) |
| `components/tender-recovery-command-center.tsx` | UI — dispatches actions based on spec kind |
| `app/dashboard/tenders/[id]/command-center/page.tsx` | Full command center page (REVIEWER role) |

### 4.2 Action Spec Types and Routes

| Action | Kind | Route | Auth |
|--------|------|-------|------|
| `REPAIR_METADATA` | `api` (POST) | `/api/tenders/[id]/repair-metadata` | REVIEWER |
| `REPAIR_SOURCE_GROUNDING` | `api` (POST) | `/api/tenders/[id]/repair-source-grounding` | REVIEWER |
| `BUILD_SUBMISSION_PLAN` | `api` (POST) | `/api/tenders/[id]/submission-plan/build` | REVIEWER |
| `LINK_VAULT_EVIDENCE` | `api` (POST) — PR #699 | `/api/tenders/[id]/link-vault-evidence-auto` | REVIEWER |
| `GENERATE_REQUIRED_DOCUMENTS` | `api` (POST) | `/api/tenders/[id]/generate-missing-plan-files` | REVIEWER |
| `APPROVE_FALLBACK_WITH_NOTE` | `api` (POST) | `/api/tenders/[id]/approve-analysis` | REVIEWER |
| `RECONCILE_OUTSIDE_PLAN_DOCS` | `api` (POST) | `/api/tenders/[id]/supersede-outside-plan` | REVIEWER |
| `RE_EXTRACT_METADATA` | `api` (POST) | `/api/tenders/[id]/re-extract-metadata` | REVIEWER |
| `RESOLVE_COMPLIANCE_GAP` | `navigate` | `/dashboard/tenders/{tenderId}#compliance-gaps` | — |

**REVIEWER role protection:** All execute-path routes are guarded by `requireRole(userId, "REVIEWER")` — confirmed by PR #698 which patched any that were missing. Tests in `tests/recovery-command-center-actions.test.ts` verify this for all execute-path routes.

### 4.3 Pre-PR #699 vs Post-PR #699 LINK_VAULT_EVIDENCE

| State | Custom Handler in Component | API Route |
|-------|-----------------------------|-----------|
| Before PR #699 | 40-line custom handler in `tender-recovery-command-center.tsx` | `/api/tenders/[id]/link-vault-evidence` (GET+POST) |
| After PR #699 | Standard `api` dispatch | `/api/tenders/[id]/link-vault-evidence-auto` (POST only) |

**Risk:** The old `link-vault-evidence` GET+POST route still exists at `app/api/tenders/[id]/link-vault-evidence/route.ts`. It is no longer called by the Recovery Command Center but may still be called by other consumers. Verify before deleting.

---

## 5. Generation and Export Gate Map

### 5.1 Generation Gate Checks (in order of enforcement)

| Check | Location | Blocks |
|-------|----------|--------|
| Auth: `getSession` + `requireRole(REVIEWER)` | `generate/route.ts` | All |
| Rate limit: `rateLimit(AI_RATE_LIMIT)` | `generate/route.ts` | Full proposal |
| `prismaReady` | `generate/route.ts` (inside try) | All |
| Extraction gate: `isExtractionAcceptableForGeneration` | `generate/route.ts` | Full proposal |
| Client metadata: `assessTenderMetadataCompleteness` | `generate/route.ts` | Full proposal |
| Analysis source: `assertAnalysisReadyForFinalGeneration` | `generate/route.ts` | Full proposal |
| Analysis quality: `assessTenderAnalysisQuality` severity check | `generate/route.ts` | Full proposal |
| Compliance gaps: CRITICAL + `isResolved: false` | `generate/route.ts` | HARD_BLOCKERS only |
| `computeStoredMetadataPatch` + `listInvalidStoredFields` | `generate/route.ts` | If invalid fields exist |
| Submission plan: `hasValidSubmissionPlan` (implicit via plan entries) | `generate/route.ts` | If no plan |

### 5.2 Export Gate Checks

| Check | Location | Gate |
|-------|----------|------|
| `checkExportReadiness` | `lib/engine/export-readiness.ts` → `download/route.ts` | Per-document hygiene |
| `checkFullExportReadiness` | `lib/engine/export-readiness.ts` → `download/route.ts`, `auto-finalize/route.ts` | Full package |
| `getFinalSubmissionReadiness` | `lib/engine/final-submission-readiness.ts` → `export-readiness/route.ts`, `download/route.ts`, `command-center/page.tsx` | Final submission score |
| Export format policy | `lib/engine/export-format-policy.ts` → `tender-generation-readiness.ts` | Branding/signature/PDF |
| Export byte readiness | `lib/engine/export-byte-readiness.ts` → `export-readiness.ts` | File size/content |

### 5.3 Gate Weakening Risk Table

| What Could Be Weakened | How |
|------------------------|-----|
| `tender-detail.tsx:canGenerateDocs` diverging from canonical | Local state never re-syncs with DB after page load |
| `criticalGaps`/`hasCriticalGapBlock` re-computed inline in UI | May use stale data passed from SSR; server gate still enforces |
| `isUnapprovedFallback` derived from streaming SSE state | Reset on navigation; server gate enforces at generate time |

---

## 6. Build-Time Mutation Map

### 6.1 `scripts/patch-resumable-ai-analyze.mjs`

This script runs as the first step of `npm run build` and `vercel-build`. It patches:

| Target File | Patch Type | What It Adds |
|-------------|------------|--------------|
| `lib/ai.ts` | Type + function signature | `AnalysisChunkCacheEntry` type; `previousChunkResults` param on `analyzeWithAI`; `chunkResults` in return |
| `app/api/tenders/[id]/ai-analyze/route.ts` | Function body | Full resume bootstrap (reads previous job), auto-resume discovery, `previousChunkResults` passed to `analyzeWithAI`, `chunkResults` saved to job output |
| `app/dashboard/tenders/[id]/tender-detail.tsx` | Client fetch call | `?continue=jobId` appended to streaming analyze URL |

**Idempotency:** The script checks for sentinel strings before patching. If the sentinel is already present, the patch is skipped. This means the patched state is stable across multiple builds.

**Local development gap:** `npm run dev` always runs the unpatched source. Chunk resume functionality is PRODUCTION-ONLY. Local testing of resume behavior requires running the patch script manually: `node scripts/patch-resumable-ai-analyze.mjs`.

**Risk:** Any PR that reformats the exact multi-line string blocks that the script searches for will silently break the patch, causing a `Could not find patch target` error at Vercel build time.

---

## 7. Dead-Code Candidate Map

| File | Reason | Confidence | Safe to Delete When |
|------|--------|------------|---------------------|
| `lib/engine/generate.ts` | Explicitly `@deprecated`; zero importers; `generate-elite.ts` is the active engine | HIGH | Immediately; tests confirm no imports |
| `components/canonical-status-badge.tsx` exports `CanonicalStatusBadge`, `CanonicalStatusIcon` | Zero production consumers (tests only) | MEDIUM | After migrating 1+ panel to use it (proves it works) |
| `app/api/tenders/[id]/link-vault-evidence/route.ts` (GET+POST) | Replaced by `link-vault-evidence-auto/route.ts` after PR #699 | MEDIUM | After verifying no other callers |

### 7.1 Confirmed Dead: `lib/engine/generate.ts`

```
lib/engine/generate.ts:
  File comment: "@deprecated LEGACY — NOT called by any route. Active engine is generate-elite.ts."
  Importers: ZERO (grep -rn "from.*engine/generate\b" returns only generate/route.ts importing generate-elite)
```

---

## 8. Shadow-Code Map

Shadow code is production-reachable code that duplicates or conflicts with a newer canonical implementation.

| Shadow | Location | Canonical | Risk |
|--------|----------|-----------|------|
| `canGenerateDocs` local flag | `tender-detail.tsx` line 1475 | `getTenderGenerationReadiness().fullProposalReady` | UI may show Generate enabled when server would block |
| `criticalGaps` inline count | `tender-detail.tsx` line 1423 | `generate/route.ts` compliance check | UI count may be stale; server always re-checks |
| `hasCriticalGapBlock` inline filter | `tender-detail.tsx` line 1519 | `generate/route.ts` `criticalGapIsHardBlock()` | Different regex → different block classification |
| `getTenderGenerationReadiness()` in SSR `page.tsx` | `page.tsx` line ~100 | `generation-readiness/route.ts` | Double compute; stale SSR data vs fresh client data |
| `SEVERITY_BADGE` map in `export-readiness-panel.tsx` | Component-local | `lib/ui-tokens.ts` `severityBadgeClasses()` | Inconsistent colors if canonical is updated |
| `severityClass` map in `analysis-quality-panel.tsx` | Component-local (PR #699 partially migrated) | `lib/ui-tokens.ts` | Remaining inline colors contradict token system |
| Inline confidence colors in `requirement-coverage-panel.tsx` | PR #699 added NEW local colors | `lib/ui-tokens.ts` `confidenceToSeverity` | PR #699 should have used the token helper it added |
| Local severity maps in share, analytics, company review pages | 4+ dashboard pages | `components/canonical-status-badge.tsx` | Each page independently decides color mapping |
| Old `LINK_VAULT_EVIDENCE` custom handler | `tender-recovery-command-center.tsx` (removed in PR #699) | `lib/recovery-command-actions.ts` spec | RESOLVED by PR #699 — no longer a shadow |

---

## 9. Duplicate API Calculation Map

### 9.1 Routes That Return the Same Metric

| Metric | Route A | Route B | Notes |
|--------|---------|---------|-------|
| `readyForGeneration` | `GET /generation-readiness` | `GET /readiness` (via `getCanonicalTenderReadiness`) | Both call `getTenderGenerationReadiness`; same result if called at same time |
| `fullProposalReady` | `GET /generation-readiness` | `GET /readiness` | Same |
| Analysis quality score | `GET /analysis-quality` | Embedded in `GET /generation-readiness` → `fullProposalBlockers` | May differ: `/analysis-quality` uses latest matching state; SSR uses snapshot |
| `assessMatchingQuality` result | `GET /matching-quality` | `GET /analysis-quality` (calls `assessMatchingQuality` internally) | Both compute it independently with potentially different timing |
| Extraction quality | `GET /extraction-quality` | Embedded in `GET /generation-readiness` via `isExtractionAcceptableForGeneration` | `/extraction-quality` is richer; generation readiness uses gating version only |
| Compliance gap count | `GET /readiness-score` | `tender-detail.tsx` line 1423 inline | UI count may lag behind readiness-score |

### 9.2 Routes That Re-verify Gate Conditions Previously Checked

| Route | Re-verifies | Why |
|-------|-------------|-----|
| `generate/route.ts` | Extraction, metadata, analysis source, compliance | Server-side gate at point of action — correct |
| `download/route.ts` | Export readiness + generation readiness + final submission readiness | All three — heavyweight but correct for final export |
| `auto-finalize/route.ts` | Extraction quality + export readiness | Correct — auto-finalize should not proceed on poor extraction |

These re-checks are INTENTIONAL and must be preserved. They are the enforcement layer; the panel routes are the display layer.

---

## 10. Test Coverage Gap Map

### 10.1 Engine Modules With No Direct Test File

| Module | Test Coverage |
|--------|---------------|
| `lib/engine/generate-elite.ts` | No direct unit test — tested implicitly via generate-docs-gate.test.ts |
| `lib/engine/submission-plan.ts` | `tests/build-plan-hardening.test.ts` — partial |
| `lib/engine/export-readiness.ts` | `tests/export-readiness.test.ts` — exists |
| `lib/engine/export-format-policy.ts` | `tests/export-format-policy.test.ts` — exists |
| `lib/engine/final-submission-readiness.ts` | `tests/final-submission-readiness.test.ts` — exists |
| `lib/engine/canonical-readiness-state.ts` | `tests/canonical-readiness-contradictions.test.ts` — exists |
| `lib/engine/metadata-validators.ts` | Partial via `tests/auto-fill-tender-metadata.test.ts` |
| `lib/engine/compliance.ts` | No direct test found |
| `lib/engine/best-available-selection.ts` | `tests/ai-rematch-selection-authority.test.ts` |
| `lib/tender-readiness-state.ts` | `tests/tender-readiness-state.test.ts` — exists |
| `lib/tender-generation-readiness.ts` | No direct unit test |
| `lib/canonical-tender-readiness.ts` | No direct unit test |

### 10.2 Routes With No Corresponding Test

| Route | Test Status |
|-------|-------------|
| `app/api/tenders/[id]/link-vault-evidence-auto/route.ts` | No test (new in PR #699, not yet tested) |
| `app/api/tenders/[id]/readiness/route.ts` | Source-structure test only (panel-runtime-stability.test.ts) |
| `app/api/tenders/[id]/generation-readiness/route.ts` | Source-structure test only |
| `app/api/tenders/[id]/matching-quality/route.ts` | Source-structure test only |
| `app/api/tenders/[id]/analysis-quality/route.ts` | Source-structure test only |
| `app/api/tenders/[id]/extraction-quality/route.ts` | Source-structure test only |

### 10.3 Source-String-Only Tests (Not Executing Real Behavior)

The following tests read source file content (`.ts` file text) rather than invoking the actual functions:

| Test File | Pattern | Risk |
|-----------|---------|------|
| `tests/panel-runtime-stability.test.ts` (partial) | `readFileSync` + `src.includes(...)` | Passes even if implementation is wrong but has correct strings |
| `tests/recovery-command-center-actions.test.ts` (partial) | `readFileSync` + `src.includes(...)` for route existence checks | Route may exist but have wrong auth or logic |
| `tests/canonical-readiness-contradictions.test.ts` | `readFileSync` + `src.includes(...)` for symbol exports | Exports may exist but return wrong values |

### 10.4 Tests That Were Weakened by PR #699

| Test | Before PR #699 | After PR #699 | Impact |
|------|----------------|---------------|--------|
| `tests/recovery-command-center-actions.test.ts` LINK_VAULT_EVIDENCE handler check | Verified component calls `/api/tenders/${tenderId}/link-vault-evidence` | Now only verifies it does NOT navigate to `/dashboard/vault` | API endpoint no longer verified in test; weaker coverage |

---

## File Classification Table

| File | Classification | Notes |
|------|----------------|-------|
| `lib/engine/generate.ts` | DELETE | Explicitly deprecated; zero importers |
| `lib/ui-tokens.ts` | KEEP | Canonical token system; partially adopted |
| `lib/engine/canonical-readiness-state.ts` | KEEP | Canonical 8-state system; needs wider adoption |
| `components/canonical-status-badge.tsx` | KEEP | Canonical badge; needs production consumers |
| `components/legacy-tender-action-hider.tsx` | DEPRECATE | DOM mutation workaround; symptom of duplicate button rendering |
| `lib/tender-generation-readiness.ts` | KEEP | Core generation gate |
| `lib/canonical-tender-readiness.ts` | KEEP | Wraps generation readiness for /readiness route |
| `lib/engine/export-readiness.ts` | KEEP | Export gate |
| `lib/engine/final-submission-readiness.ts` | KEEP | Deep export gate |
| `lib/engine/readiness-scoring.ts` | KEEP | Numeric score aggregator |
| `lib/engine/generate-elite.ts` | KEEP | Active generation engine |
| `lib/tender-readiness-state.ts` | KEEP | Input type + pure computation |
| `scripts/patch-resumable-ai-analyze.mjs` | REFACTOR | Build-time mutation is a maintenance hazard; target files should be updated directly |
| `app/dashboard/tenders/[id]/tender-detail.tsx` canGenerateDocs | REFACTOR | Local shadow of canonical gate |
| `app/dashboard/tenders/[id]/tender-detail.tsx` criticalGaps/hasCriticalGapBlock | REFACTOR | Local shadow of generate route gate |
| `components/requirement-coverage-panel.tsx` inline colors (PR #699) | REWORK | Uses local colors when `confidenceToSeverity` + `severityBadgeClasses` exist |
| `app/api/tenders/[id]/link-vault-evidence/route.ts` | UNKNOWN | Check consumers before classifying |
| `app/api/tenders/[id]/link-vault-evidence-auto/route.ts` | KEEP | New canonical auto-link endpoint |

---

## Migration Order (Small PR Boundaries)

### PR 2 — Delete confirmed dead code + eliminate build-time source mutation

**Scope:**
1. Delete `lib/engine/generate.ts` (explicitly deprecated, zero importers)
2. Apply the `patch-resumable-ai-analyze.mjs` patches directly to source files so they live in version control
3. Delete `scripts/patch-resumable-ai-analyze.mjs` once patches are applied
4. Add tests for the now-visible chunk-resume logic

**Why first:** Lowest risk. Removes the divergence between local and production source. Unblocks accurate typechecking of the full AI analyze flow.

**Characterization tests required before migration:**
- `tests/ai-analyze-resume.test.ts` must cover: resume from partial job, content hash mismatch resets, auto-resume on matching hash

### PR 3 — Adopt `lib/ui-tokens.ts` across all panels + eliminate shadow color maps

**Scope:**
1. Migrate `tender-detail.tsx` GAP_SEVERITY_STYLE, trustLevel badges, and `mimeType` color map to use `severityBadgeClasses` / `statusToSeverity` / `confidenceToSeverity`
2. Migrate `requirement-coverage-panel.tsx` inline confidence colors to `confidenceToSeverity` + `severityBadgeClasses`
3. Migrate `analysis-quality-panel.tsx` remaining inline `severityClass` map
4. Migrate `export-readiness-panel.tsx` `SEVERITY_BADGE` map
5. Wire `CanonicalStatusBadge` + `CanonicalStatusIcon` into at least one real panel (proves they work in production)

**Why second:** Pure UI refactor. No logic changes. Cannot weaken gates.

**Characterization tests required:**
- Snapshot tests or source-structure tests verifying each component uses `severityBadgeClasses` for its primary status indicator

### PR 4 — Fix shadow readiness logic in `tender-detail.tsx`

**Scope:**
1. Remove `canGenerateDocs` local flag; replace with data from the generation-readiness API response already fetched by `GenerationReadinessPanel`
2. Remove inline `criticalGaps` and `hasCriticalGapBlock` computations; derive from readiness API response
3. Remove SSR `getTenderGenerationReadiness` call in `page.tsx` (reduce to single client-side fetch)

**Why third:** Requires understanding of how SSR props flow to client components. Must not break the button wiring.

**Characterization tests required:**
- Tests verifying that a tender with `analysisSource = REGEX_FALLBACK_AI_ERROR` correctly shows the Generate button as disabled
- Tests verifying that a tender with CRITICAL unresolved gaps shows the Generate button as disabled

### PR 5 — Verify and clean up `link-vault-evidence` old route

**Scope:**
1. Trace all consumers of `app/api/tenders/[id]/link-vault-evidence/route.ts`
2. If no consumers: delete and update tests
3. Restore test coverage for the `LINK_VAULT_EVIDENCE` action that was weakened in PR #699

---

## Code That Must NOT Be Deleted Yet

| File | Reason |
|------|--------|
| `lib/tender-generation-readiness.ts` | Active generation gate; referenced in 5+ routes |
| `lib/engine/export-readiness.ts` | Active export gate; referenced in download, auto-finalize, export routes |
| `lib/engine/final-submission-readiness.ts` | Active final submission scoring; referenced in command-center, pipeline-diagnostic, download routes |
| `lib/engine/readiness-scoring.ts` | Used by `final-submission-readiness.ts` |
| `app/api/tenders/[id]/link-vault-evidence/route.ts` | Old vault link route — verify consumer list before deleting |
| `components/legacy-tender-action-hider.tsx` | Still active in `page.tsx`; underlying duplicate button issue must be fixed first |
| `lib/engine/canonical-readiness-state.ts` | Canonical system that needs wider adoption — kept for migration |
| `components/canonical-status-badge.tsx` | Same |

---

## Safe Immediate Deletion Candidates

| File | Condition |
|------|-----------|
| `lib/engine/generate.ts` | Immediately safe. Zero importers. Self-annotated as deprecated. |

---

## Hidden Regression Risks

1. **Build-time patch failure:** Any refactor that reformats the multi-line string blocks in `lib/ai.ts` or `app/api/tenders/[id]/ai-analyze/route.ts` will cause a production deploy failure with no local signal.

2. **`canGenerateDocs` divergence:** The Generate Docs button in `tender-detail.tsx` uses locally computed state. If the canonical `getTenderGenerationReadiness` adds a new blocking condition (e.g. a new compliance check), the button will appear enabled until the server rejects the generate request.

3. **`hasCriticalGapBlock` vs `criticalGapIsHardBlock`:** `tender-detail.tsx` uses a regex embedded inline (line 1427) to classify hard-block critical gaps. `generate/route.ts` uses `criticalGapIsHardBlock()` with a different regex. These can disagree on which critical gaps are hard blocks — showing the wrong UI state to the user.

4. **SSR + client double-compute timing:** `page.tsx` fetches generation readiness at SSR time; `GenerationReadinessPanel` fetches it again at client render time. Between the two, a user could run AI Analyze — resulting in the SSR readiness data being stale while the client panel shows updated data.

5. **`CanonicalStatusBadge` has zero production consumers:** The canonical badge system was introduced in PR #696 and has tests, but is not used by any production page component. If the `CANONICAL_STATUS_CONFIG` object is changed to fix a color bug, no production UI will reflect the fix.

6. **PR #699 `requirement-coverage-panel.tsx`** adds inline confidence colors that conflict with `lib/ui-tokens.ts` `confidenceToSeverity`. The thresholds (70/40 pct) match, but they are duplicated magic numbers rather than delegating to the constants `SOURCE_CONFIDENCE_HIGH`/`SOURCE_CONFIDENCE_ACCEPTABLE` that PR #699 also exports from `extraction-quality-gate.ts`.

7. **`lib/tender-generation-readiness.ts` legacy `ready` flag:** The `TenderGenerationReadiness.ready` field is documented as "kept for backward compatibility." Any panel that reads `ready` (instead of `fullProposalReady` or `supportPackageReady`) will make wrong decisions for tenders that are support-package-ready but not full-proposal-ready.

---

## PR #699 Classification

PR #699 title: "Fix app quality gaps: UI tokens, extraction dashboard, vault auto-link"  
Branch: `fix/app-quality-gaps` (draft, NOT merged, base: `be797b34` which is now 1 commit behind main)

| Change | Classification | Notes |
|--------|----------------|-------|
| `lib/ui-tokens.ts` (new) | **KEEP** | Excellent canonical token system; well-tested |
| `lib/engine/extraction-quality-gate.ts` — export threshold constants | **KEEP** | Reduces magic numbers; no logic change |
| `components/extraction-quality-dashboard.tsx` — 5-col grid + token migration | **KEEP** | Correct use of token system; blank/failed split is a real improvement |
| `components/analysis-quality-panel.tsx` — partial token migration | **KEEP** (with note) | Migrates 3 color points correctly; `severityClass` map remains inline — should be finished |
| `components/requirement-coverage-panel.tsx` — confidence badge | **REWORK** | Adds new local inline color logic when `confidenceToSeverity` + `severityBadgeClasses` already exist in `lib/ui-tokens.ts`; also hardcodes 70/40 instead of using `SOURCE_CONFIDENCE_HIGH`/`SOURCE_CONFIDENCE_ACCEPTABLE` |
| `components/export-readiness-panel.tsx` — severity legend | **KEEP** | Additive UI improvement; no logic change |
| `components/metadata-completion-panel.tsx` — contamination + conflict banners | **KEEP** | Valuable detection logic; pure UI addition |
| `lib/recovery-command-actions.ts` — LINK_VAULT_EVIDENCE → `api` kind | **KEEP** | Correct; removes custom handler path |
| `components/tender-recovery-command-center.tsx` — remove custom LINK_VAULT_EVIDENCE handler | **KEEP** | Correct consolidation |
| `app/api/tenders/[id]/link-vault-evidence-auto/route.ts` (new) | **KEEP** | New consolidated endpoint; needs REVIEWER auth verification |
| `tests/ui-tokens.test.ts` (new) | **KEEP** | Good coverage of canonical token functions |
| `tests/confidence-thresholds.test.ts` (new) | **KEEP** | Good coverage of threshold constants |
| `tests/recovery-command-center-actions.test.ts` — weakened LINK_VAULT_EVIDENCE check | **REWORK** | Test no longer verifies the API is called; should verify the spec points at `link-vault-evidence-auto` |

**PR #699 REBASE NOTE:** PR #699 base is `be797b34`, which is now behind `main` at `0d4d4f6`. Before merging PR #699, it must be rebased onto `main` to pick up PR #700's changes.

**PR #699 BLOCKER:** `link-vault-evidence-auto/route.ts` needs REVIEWER role auth verification before this PR can be merged. Recovery Command Center execute-path routes must have `requireRole(userId, "REVIEWER")` — this was the subject of PR #698.

---

## Appendix: Key Metric Counts

| Metric | Count |
|--------|-------|
| Readiness lib modules | 13 |
| API routes under `/api/tenders/[id]/` | 53 |
| Components | 70 |
| lib/engine/ modules | 168+ |
| lib/ root modules | 48 |
| Files patched at build time | 3 |
| Confirmed dead code files | 1 (`lib/engine/generate.ts`) |
| Shadow color logic locations | 8+ |
| Source-string-only tests | ~30% of panel-runtime-stability.test.ts |
