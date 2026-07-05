# State Authority Matrix

Classifies every current state source in the Hope Tender Proposal Generator.

## CANONICAL (sole source of truth)

| Source | File | Authority |
|--------|------|-----------|
| `resolveCanonicalFieldState` | `lib/engine/canonical-field-state.ts` | Effective metadata values, source-evidence status, grounding, override state |
| `getTenderReleaseSnapshot` | `lib/engine/tender-release-snapshot.ts` | Unified release snapshot: metadata + analysis + requirements + plan + export |
| `resolveTenderNextAction` | `lib/tender-next-action.ts` | Single next required action |
| `resolveTenderAnalysisState` | `lib/engine/analysis-state-resolver.ts` | AI analysis state machine |
| `evaluateGenerationReadiness` | `lib/engine/generation-readiness-gate.ts` | Generation/export/ZIP gate decisions |
| `getCurrentConfirmedBuildPlan` | `lib/engine/build-plan.ts` | Confirmed BuildPlan authority |
| `computeTenderBuildPlanHash` | `lib/engine/build-plan.ts` | BuildPlan content hash (stale detection) |

## DERIVED READ MODEL (computed from CANONICAL)

| Source | File | Derived From |
|--------|------|--------------|
| `computeCanonicalModuleStates` | `lib/engine/canonical-readiness-state.ts` | `TenderReadinessState` → module statuses |
| `assessTenderMetadataCompleteness` | `lib/engine/tender-metadata-completeness.ts` | Raw tender fields → completeness ratio |
| `assessExtractionQuality` | `lib/extraction-quality.ts` | Extracted text → quality score |
| Tender Health Score panel | `components/tender-health-score-panel.tsx` | Multiple sources → advisory score (NOT authoritative) |
| Next Action panel | `components/next-action-panel.tsx` | `resolveTenderNextAction` → single action |

## HISTORICAL/AUDIT (not used for operational decisions)

| Source | File | Usage |
|--------|------|-------|
| Superseded `GeneratedDocument` rows | DB | Audit only; excluded from operational counts |
| Stale `AiJob` rows | DB | Audit only; excluded from readiness |
| `TenderMetadataOverride` history | DB | Audit trail; current override is canonical |

## LEGACY TO RETIRE

| Source | File | Risk |
|--------|------|------|
| Raw `tender.reference` display (when override exists) | Various components | Can show stale value; should show effective value |
| `readinessScore` as sole UI indicator | Dashboard | Advisory only; must show "release blocked" when canonical state is BLOCKED |

## UNSAFE DUPLICATE

| Source | File | Risk |
|--------|------|------|
| None remaining | — | All state sources now route through canonical resolver |

## Decisions

1. **Tender Health Score** is ADVISORY ONLY. When canonical release is BLOCKED, the label shows "Advisory only — release blocked" instead of "Acceptable".
2. **Next Required Action** is singular — `resolveTenderNextAction` returns exactly one `primary` action.
3. **BuildPlan** is the sole authority for generation, reconciliation, filenames, order, envelopes, export, and ZIP.
4. All `resolveCanonicalFieldState` callers pass `activeTenderFileIds` filtered to ACTIVE files.
5. All callers forward `titleSource*`, `deadlineSource*`, `submissionEmailSourceQuote` columns.
6. `reference` and `submissionEmailSubject` evidence is hashed in the BuildPlan hash.
