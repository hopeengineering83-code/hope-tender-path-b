# Icon / Status Contradiction Audit

**Date:** 2026-06-11  
**Repo:** hopeengineering83-code/hope-tender-path-b  
**Purpose:** Map every green/red/amber/check/warning/status icon in the tender dashboard and identify contradictions that allow a downstream panel to show green/ready while an upstream gate is failing.

---

## 1. Status Component Inventory

| File | Component / Variable | UI Label | Data Source | Green means | Amber means | Red means | Uses canonical state? |
|---|---|---|---|---|---|---|---|
| `components/status-badge.tsx` | `StatusBadge` | Tender lifecycle status chip | `tender.status` enum | APPROVED / EXPORTED | COMPLIANCE_REVIEW / FALLBACK_DRAFT | ANALYSIS_REQUIRES_REVIEW / CLOSED | ❌ Local enum map |
| `components/analysis-quality-panel.tsx` | `panelClass` / severity badge | Analysis quality panel header | API `/ai-analyze` result (`analysisSeverity`, `analysisSource`) | Score GOOD, not fallback | Score WARNING or any fallback | Score POOR / UNSAFE | ❌ Local condition |
| `components/extraction-quality-panel.tsx` | `severityClass` per file | Extraction quality per file | `extractionScore`, `extractionStatus`, page counts | score ≥80% + GOOD severity | any other score | FAILED / CORRUPTED | ❌ Local condition |
| `components/extraction-quality-dashboard.tsx` | N/A (delegates to panel) | — | — | — | — | — | ❌ |
| `components/matching-quality-panel.tsx` | `panelClass` per `matchState` | Matching quality header | API `/matching` result `matchState` enum | MATCHES_REVIEWED / MATCHING_NOT_REQUIRED | VAULT_AWAITS_ENGINE | MATCHES_WEAK / NO_VAULT | ❌ Local enum map |
| `components/metadata-completion-panel.tsx` | Section `className` + field badge | Metadata panel header + per-field badge | API `/metadata` result `missingCritical`, `placeholderCount`, `contaminated` | All critical fields confirmed | Some optional missing | Critical missing / contaminated | ❌ Local condition |
| `components/generation-readiness-panel.tsx` | `panelClass` / score gauge | Generation readiness header + score | API `/generation-readiness` result `score`, `isFullyReady`, `ready` | score ≥90 + isFullyReady | score ≥40 + partially ready | score <40 / not ready | ❌ Local thresholds |
| `components/generation-action-panel.tsx` | `panelClass` / button enabled | Generate Docs button, panel header | `fullProposalReady`, `supportReady` booleans | fullProposalReady=true | supportReady=true, proposal blocked | neither ready | ❌ Depends on API flags |
| `components/requirement-coverage-panel.tsx` | `SUPPORT_LEVEL_CONFIG` per row | Per-requirement coverage badge + overall bar | API `/requirements` coverage array | FULL/SUBSTANTIAL support | PARTIAL support | NONE support | ❌ Local enum map |
| `components/export-readiness-panel.tsx` | `ok` badge + severity cards | Export readiness summary badge | API `/export-readiness` `ok`, `documentBlockers`, `tenderBlockers` | ok=true, 0 blockers | advisory warnings only | 1+ document or tender blocker | ❌ Depends on API |
| `components/tender-controls-panel.tsx` | Severity badge / control status | Control ledger item badges | API `/controls` list + `deriveControlSuggestions` | control resolved | control open | control high-risk / open | ❌ Local enum map |
| `components/tender-health-score-panel.tsx` | `healthColor` + dimension `status` | Health score + 7 dimension icons | API `/health-score` result `score`, `dimensions[]` | score ≥80%, dimension PASS | score ≥50%, dimension WARN | score <50%, dimension FAIL | ❌ Local thresholds |
| `components/next-action-panel.tsx` | `stepColor` / step icon | Next Required Action panel | `resolveTenderNextAction()` from `lib/tender-next-action.ts` | EXPORT_READY primary | most in-progress states | FIX_EXTRACTION / FIX_EXPORT_BLOCKERS | ✅ Partially (uses shared resolver) |
| `app/dashboard/tenders/[id]/executive-snapshot.tsx` | Decision badge GO/REVIEW/NO_GO | Executive Snapshot bid recommendation | Local derivation from evidence %, gap counts, doc counts | GO (evidence ≥85%, no high gaps, docs ready) | REVIEW | NO_GO (critical unresolved blockers) | ❌ Local derivation |
| `lib/tender-readiness-state.ts` | `TenderReadinessState` (pure) | — (not yet wired to panels) | Input data bag | exportAllowed=true | various warning flags | various blockers | ✅ Canonical — but not used |
| `lib/tender-next-action.ts` | `resolveTenderNextAction()` | Primary action label + tone | Structured input — extraction, analysis, metadata, requirements, plan, docs | EXPORT_READY tone=green | most in-progress tone=amber | FIX_EXTRACTION / FIX_EXPORT_BLOCKERS tone=red | ✅ Canonical |
| `lib/engine/readiness-scoring.ts` | `computeReadinessScore()` | Health score (0–100) | Structured score input with 10+ dimensions | score ≥80 (no rendering here) | — | — | ✅ Canonical — consumed by health panel via API |

**Key observation:** `lib/tender-readiness-state.ts` and `lib/tender-next-action.ts` are the only canonical state sources. All 14 UI components use local ad-hoc color logic. The health-score panel is the only one that reads from the canonical scoring engine (indirectly via the `/health-score` API).

---

## 2. Contradiction Matrix

### Contradiction 1: Green Compliance while Requirements are failed/untrusted

**Can it happen?** YES.

- `components/requirement-coverage-panel.tsx` shows per-requirement coverage badges derived from the `/requirements` API which returns raw support levels from the matching engine.
- The panel shows FULL/SUBSTANTIAL coverage (green) even when `analysisSource === "REGEX_FALLBACK_AI_ERROR"` because it does not check `analysisTrusted`.
- `tender-health-score-panel.tsx` shows the Compliance dimension as PASS if the compliance API returns good scores, independently of whether `requirementsTrusted=false`.
- `lib/tender-readiness-state.ts::complianceCurrent` correctly returns `false` when `requirementsTrusted=false`, but no panel reads this field.

**Exact scenario:** 15 requirements extracted by regex fallback. Matching engine finds 14/15 FULL coverage. `requirement-coverage-panel` shows 93% green. `tender-health-score-panel` shows Compliance PASS. `tender-readiness-state` would return `complianceCurrent=false` but nobody asks it.

---

### Contradiction 2: Green Documents while Submission Plan is missing

**Can it happen?** YES.

- `components/generation-action-panel.tsx` derives `fullProposalReady` from an API that checks `requiredDocuments.total > 0 && requiredDocumentsSatisfied === total`. This does NOT check if `exactFileNaming` (the submission plan) has entries.
- `tender-health-score-panel.tsx` shows the Documents dimension as PASS if generated docs exist and have a certain validation status, without checking `submissionPlanBuilt`.
- `lib/tender-readiness-state.ts::documentsCurrent` requires `submissionPlanBuilt=true`, but nothing reads it.

**Exact scenario:** 3 documents generated, validated. Submission plan never built (`exactFileNaming=[]`). Documents dimension shows PASS (green check). Generation button enabled. `documentsCurrent` would be `false` but isn't checked.

---

### Contradiction 3: Green Generate Docs while generation is blocked

**Can it happen?** YES in edge cases.

- `components/generation-action-panel.tsx` enables the generate button when `fullProposalReady=true` (from API) and no stream is active.
- The API `/generation-readiness` derives `fullProposalReady` from its own logic. If that API has a looser check than `tender-readiness-state.ts::exportAllowed`, the button can be enabled when the canonical state would block it.
- Specifically: the generation readiness API may return `ready=true` for a tender with `analysisSource=HUMAN_APPROVED_REGEX_FALLBACK` (draft-review only) without flagging it as blocked for final export.

---

### Contradiction 4: 0 controls shown while suggested controls exist

**Can it happen?** YES, by design but visually confusing.

- `components/tender-controls-panel.tsx` shows a count of persisted controls in the summary grid. Suggested controls from `deriveControlSuggestions()` are shown in a separate amber section below.
- The summary grid can show "0 open controls" and "0 high risk" while the amber "Suggested controls" section shows 3+ HIGH-severity suggestions.
- No visual indicator in the summary grid says "N suggestions pending review."

---

### Contradiction 5: Requirement Coverage 100% while Export Readiness says 0/N

**Can it happen?** YES.

- `requirement-coverage-panel.tsx` uses support levels from the matching engine (FULL/SUBSTANTIAL/PARTIAL/NONE per requirement).
- `export-readiness-panel.tsx` shows mandatory evidence coverage from the export-readiness API which may use a different threshold for "mandatory" and a different normalization of support levels.
- Specifically: matching may count NOT_APPLICABLE requirements as covered; export readiness may not.
- The `app/api/tenders/[id]/export-readiness/route.ts` (after the user's `0e0f0b7` patch) uses a stricter mandatory evidence check that counts only FULL/SUBSTANTIAL as covered.

---

### Contradiction 6: Metadata 100% in one panel while missing shown elsewhere

**Can it happen?** YES in partial scenarios.

- `components/metadata-completion-panel.tsx` shows field-by-field status. A field marked `NOT_APPLICABLE` shows slate (not red), making the panel appear complete.
- `lib/tender-next-action.ts` treats missing `clientName` as a blocker regardless of NOT_APPLICABLE overrides.
- `tender-readiness-state.ts::metadataTrusted` checks `clientNameMissing` (empty string) but NOT_APPLICABLE override may make the field appear filled in one panel while absent in the readiness state check.

---

### Contradiction 7: Extraction "good" while page coverage is poor

**Can it happen?** YES.

- `components/extraction-quality-panel.tsx` shows file-level status (green if `extractionScore ≥ 80`).
- The file-level score can be green (text extracted, high density) while `pageCoverage` is 60% (many pages blank/failed).
- `lib/tender-next-action.ts` blocks on `pageCoveragePercent < 80` but the extraction panel doesn't surface the overall page coverage as a red indicator — it shows per-file quality.

---

### Contradiction 8: Stale documents shown as green/current

**Can it happen?** YES.

- `tender-health-score-panel.tsx` shows Documents dimension PASS when docs exist and are validated, without comparing the document's `analysisHash` (stored in `contentSummary`) to the current analysis hash.
- `generation-action-panel.tsx` does not show "stale" — it shows the most recent generation status.
- `lib/tender-readiness-state.ts::documentsCurrent` correctly detects staleness via hash comparison, but no panel reads `docsGeneratedFromCurrentAnalysis`.

---

### Contradiction 9: Regex fallback analysis shown as trusted/approved

**Can it happen?** YES in partial scenarios.

- `analysis-quality-panel.tsx` shows amber (not red) for `HUMAN_APPROVED_REGEX_FALLBACK` — which is correct — but shows the source as "Draft approved" without a clear "NOT final-export approved" warning in every panel.
- `generation-action-panel.tsx` may enable generation for draft-approved fallback because the generation readiness API returns `ready=true` for draft-approved analysis.
- `tender-health-score-panel.tsx` may show Analysis dimension as WARN (amber) for draft-approved fallback, which users may interpret as "safe to proceed."

---

### Contradiction 10: OCR_REQUIRED status but generation not blocked

**Can it happen?** YES.

- If `analysisExtractionStatus === "OCR_REQUIRED"` and the tender was analyzed by some other method, the health score panel shows the analysis dimension based on analysis quality — not on the extraction status.
- `generation-action-panel.tsx` does not check `analysisExtractionStatus` directly; it relies on `fullProposalReady` from the API. If the API doesn't hard-block on OCR_REQUIRED (which can happen if the extraction status is stale), generation can proceed.

---

## 3. Local vs Canonical Icon Logic

### (a) Components using inline ad-hoc color logic — NO canonical state

| File | Local logic pattern |
|---|---|
| `components/status-badge.tsx` | `STATUS_CONFIG` object literal with hardcoded colors per status string |
| `components/analysis-quality-panel.tsx` | `analysisSeverity === "GOOD" ? "border-green-200 bg-green-50" : …` |
| `components/extraction-quality-panel.tsx` | `score >= 80 && !isCorrupted ? "bg-green-100" : "bg-amber-100"` |
| `components/matching-quality-panel.tsx` | `matchState === "MATCHES_REVIEWED" ? "border-green-200 bg-green-50" : …` |
| `components/metadata-completion-panel.tsx` | `missingCritical.length === 0 && !contaminated ? "border-emerald-200" : "border-red-200"` |
| `components/generation-readiness-panel.tsx` | `score >= 90 ? "bg-emerald-500" : score >= 70 ? "bg-green-500" : …` |
| `components/generation-action-panel.tsx` | `fullProposalReady ? "border-emerald-200 bg-emerald-50" : supportReady ? "border-amber-200" : "border-red-200"` |
| `components/requirement-coverage-panel.tsx` | `SUPPORT_LEVEL_CONFIG[level].badgeClass` per row |
| `components/export-readiness-panel.tsx` | `data.ok ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"` |
| `components/tender-controls-panel.tsx` | `severity === "HIGH" ? "bg-red-100 text-red-700" : …` |
| `components/tender-health-score-panel.tsx` | `score >= 80 ? "text-emerald-700" : score >= 50 ? "text-amber-700" : "text-red-700"` |
| `app/dashboard/tenders/[id]/executive-snapshot.tsx` | `decision === "GO" ? "bg-green-100 text-green-700" : …` (local derivation) |

### (b) Components using shared helper functions

| File | Helper used |
|---|---|
| `components/next-action-panel.tsx` | `resolveTenderNextAction()` from `lib/tender-next-action.ts` |
| API route `/health-score` (→ `tender-health-score-panel.tsx`) | `computeReadinessScore()` from `lib/engine/readiness-scoring.ts` |
| API route `/export-readiness` | internal helpers only |

### (c) Components using canonical state from `lib/tender-readiness-state.ts`

**None.** `lib/tender-readiness-state.ts` exists and correctly computes `extractionTrusted`, `analysisTrusted`, `requirementsTrusted`, `metadataTrusted`, `submissionPlanBuilt`, `complianceCurrent`, `documentsCurrent`, `exportAllowed` — but no panel or API route reads these signals.

---

## 4. Upstream/Downstream Dependency Violations

### Compliance panel not checking extraction status

**File:** `components/requirement-coverage-panel.tsx` + `components/tender-health-score-panel.tsx`  
**Problem:** Both show compliance/coverage as green based on support levels from the matching engine. Neither checks `extractionTrusted`. If extraction was corrupted or used regex fallback, requirements may be wrong, but the compliance badge stays green.  
**Canonical fix:** `complianceCurrent` from `lib/tender-readiness-state.ts` would return `false` when `extractionTrusted=false`.

### Documents panel not checking if submission plan exists

**File:** `components/generation-action-panel.tsx`, `components/tender-health-score-panel.tsx` (Documents dimension)  
**Problem:** Neither checks `submissionPlanBuilt`. A tender with 3 generated docs and no file list in `exactFileNaming` shows Documents as green.  
**Canonical fix:** `documentsCurrent` requires `submissionPlanBuilt=true`.

### Export panel not checking if documents are stale

**File:** `components/export-readiness-panel.tsx`  
**Problem:** The export-readiness API checks document quality and blocker counts but does not compare document `analysisHash` to current analysis hash.  
**Canonical fix:** `exportAllowed` requires `documentsCurrent=true` which requires `docsGeneratedFromCurrentAnalysis=true`.

### Health score not reflecting all blockers

**File:** `components/tender-health-score-panel.tsx`  
**Problem:** The Compliance dimension (10 pts) shows PASS when the compliance API returns good scores, regardless of whether `requirementsTrusted=false`. The Documents dimension shows PASS when docs exist, regardless of staleness.  
**Canonical fix:** Health score should consult `complianceCurrent` and `documentsCurrent` before awarding dimension points.

### Generation button ignoring analysis trust level

**File:** `components/generation-action-panel.tsx`  
**Problem:** `fullProposalReady=true` can be true for draft-approved regex fallback analysis. The button is enabled, but `lib/tender-readiness-state.ts::analysisTrusted` would return `false` for `REGEX_FALLBACK_AI_ERROR` (unapproved) and would add a warning for `HUMAN_APPROVED_REGEX_FALLBACK`.  
**Canonical fix:** Generation gate should check `analysisTrusted` or explicitly allow draft-review-only with a clear amber warning, not a green "ready" state.

---

## 5. Proposed Canonical Status Model

The app should adopt exactly 8 canonical states for every module in the pipeline:

| State | Icon | Color | Tailwind tokens | Meaning |
|---|---|---|---|---|
| `READY` | ✓ | Green | `text-emerald-700 bg-emerald-50 border-emerald-200` | All upstream dependencies passed; safe to rely on this module's output |
| `WARNING` | ⚠ | Amber | `text-amber-700 bg-amber-50 border-amber-200` | Non-blocking issue — user should review but can continue |
| `BLOCKED` | ✗ | Red | `text-red-700 bg-red-50 border-red-200` | User must fix this before proceeding to downstream steps |
| `STALE` | ⟳ | Purple/Gray | `text-purple-700 bg-purple-50 border-purple-200` | Result was generated from older extraction/analysis/plan/document hash; must regenerate |
| `PARTIAL` | ◑ | Blue/Amber | `text-blue-700 bg-blue-50 border-blue-200` | Useful progress but not final or safe for export |
| `NOT_RUN` | ○ | Slate | `text-slate-500 bg-slate-50 border-slate-200` | Required process has not run yet |
| `RUNNING` | ⟳ | Blue | `text-blue-700 bg-blue-50 border-blue-200` + spinner | Process is actively running |
| `NOT_APPLICABLE` | — | Slate | `text-slate-400 bg-slate-50 border-slate-100` | Explicitly marked not applicable by user or tender rule |

**Strict meanings (must not be overloaded):**
- `READY` means **all upstream gates pass** and this module's output is safe to use. It must never be shown when an upstream module is `BLOCKED` or `STALE`.
- `WARNING` is **non-blocking only**. If a warning would prevent a downstream step, it must be `BLOCKED` instead.
- `STALE` is a distinct state (not `WARNING`). It means the output may have been accurate when generated but is now outdated due to upstream changes.
- `PARTIAL` means progress exists but is insufficient for final submission.

---

## 6. Recommended Fix Order

### PR A — Canonical status resolver (implement before UI changes)

**Title:** `fix(engine): add canonical module readiness resolver`

**Scope:**
- Create `lib/engine/canonical-readiness-state.ts` — a module-level resolver that maps `TenderReadinessState` (from `lib/tender-readiness-state.ts`) to per-module canonical states (one of the 8 above) for: Extraction, Analysis, Metadata, Requirements, SubmissionPlan, Compliance, Documents, Export.
- Wire `computeTenderReadinessState()` into the `/health-score` API route so the health score dimensions use canonical states.
- Wire into the `/generation-readiness` API so `fullProposalReady` is blocked by `analysisTrusted=false` and `submissionPlanBuilt=false`.
- Wire into the `/export-readiness` API so `ok=false` when `documentsCurrent=false`.
- Add `CRITICAL` alongside `MANDATORY` in mandatory-type requirement counting (already identified in PR #691).
- Fix missing `analysisHash` on docs: treat as `STALE` (unknown freshness), not as current/green.

**Do not change:** UI components, colors, icon choices. Only the API flags and resolver output change.

### PR B — Canonical badge component and panel wiring (after PR A)

**Title:** `fix(ui): centralize readiness icons and replace local panel logic`

**Scope:**
- Create `components/canonical-status-badge.tsx` — renders the 8 canonical states with the approved color/icon/label mapping.
- Replace inline `score >= 80 ? "text-emerald" : …` logic in:
  - `tender-health-score-panel.tsx` — read dimension states from canonical resolver
  - `generation-action-panel.tsx` — read `analysisTrusted`, `submissionPlanBuilt`, `documentsCurrent`
  - `requirement-coverage-panel.tsx` — add `requirementsTrusted` upstream check before showing green
  - `export-readiness-panel.tsx` — add `documentsCurrent` check
  - `executive-snapshot.tsx` — GO decision must require `exportAllowed=true`
- Restore repair action buttons removed from `generation-action-panel.tsx`:
  - "Repair all empty fields from source"
  - "Repair evaluationMethodology only"
  - Source-grounded repair messaging
- Ensure suggested controls show count in summary grid ("N suggested").

**Do not merge** until PR A is reviewed and tests pass.

### PR C — Real state-matrix contradiction tests (after PR B)

**Title:** `test(ui): add readiness icon contradiction regression matrix`

**Scope:**
- Replace fragile source-string tests with functional state-matrix tests.
- Test the canonical resolver with fixture tender states.
- Prove the 10 contradictions in Section 2 above cannot occur after PR B.
- Keep one source-string guard per panel to ensure no panel renders a green icon from local ad-hoc logic outside the canonical badge component.

---

## Appendix: Files with Highest Contradiction Risk

| File | Risk | Reason |
|---|---|---|
| `components/tender-health-score-panel.tsx` | HIGH | 7 dimension scores computed independently; Compliance and Documents can be PASS when upstream is blocked |
| `components/generation-action-panel.tsx` | HIGH | `fullProposalReady` from API may be true when `analysisTrusted=false` or `submissionPlanBuilt=false` |
| `components/requirement-coverage-panel.tsx` | HIGH | Shows 100% coverage from matching engine without checking `requirementsTrusted` |
| `app/dashboard/tenders/[id]/executive-snapshot.tsx` | HIGH | GO decision derivation is local; does not consult `exportAllowed` |
| `components/export-readiness-panel.tsx` | MEDIUM | Does not check `documentsCurrent` (stale docs can pass) |
| `components/analysis-quality-panel.tsx` | MEDIUM | Draft-approved regex fallback shown as amber (not red), may appear safe |
| `components/next-action-panel.tsx` | LOW | Already uses `resolveTenderNextAction()` — partially canonical |

---

*Audit produced: 2026-06-11. No code behavior was changed during this audit.*
