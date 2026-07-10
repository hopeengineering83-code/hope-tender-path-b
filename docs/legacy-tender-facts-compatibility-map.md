# Legacy Tender Facts Compatibility Map

This map prevents risky mass-renames while the product language moves from legacy internal metadata names to Tender Details / Tender Facts language.

| Legacy path or identifier | Product replacement name | User-facing today? | Safe to rename now? | DB migration needed? | Recommended follow-up PR |
|---|---|---:|---:|---:|---|
| `app/api/tenders/[id]/repair-metadata/route.ts` | `repair-tender-facts` | API-only, but client actions may surface labels | No | No | Add preferred alias route after PR #1012/#1013 merge; keep legacy wrapper for compatibility. |
| `app/api/tenders/[id]/re-extract-metadata/route.ts` | `re-extract-tender-details` | API-only, but action copy can leak | No | No | Add preferred alias route and update callers after UI PRs merge. |
| `app/api/tenders/[id]/metadata-override/route.ts` | `tender-fact-override` | API-only | No | No | Add preferred alias route; old route remains deprecated wrapper. |
| `lib/engine/source-grounded-metadata-repair.ts` | source-grounded tender facts repair | Internal | No | No | Rename module in a backend-only PR with import updates and regression tests. |
| `lib/engine/auto-fill-tender-metadata.ts` | auto-fill tender details | Internal | No | No | Rename only after route/component language is settled. |
| `lib/engine/tender-metadata-completeness.ts` and tests | tender facts completeness | Internal | No | Possible if model names change | Defer DB/model rename; public payloads should translate labels/codes first. |
| `components/metadata-completion-panel.tsx` | Tender Details panel | Yes | No, touched by PR #1012 | No | Let PR #1012 land; follow with import/path rename if desired. |
| `components/metadata-truth-panel.tsx` | Source-Grounded Tender Facts panel | Yes | No, touched by PR #1012 | No | Let PR #1012 land; follow with file rename only. |
| `TenderMetadataOverride` / `metadataOverrides` | Tender fact override | No, schema/internal | No | Yes | Do not rename in this PR; requires migration and compatibility layer. |

## Compatibility policy

- Public API labels and UI text must use Tender Details / Tender Facts / Submission Facts / Final Package Facts language.
- Legacy route names may remain stable for callers, but responses must not return user-facing metadata wording.
- Any future alias route should be implemented as a thin wrapper around the existing handler to avoid diverging behavior.
- File renames should happen only after PR #1012 and PR #1013 merge to avoid conflicts with their UI/API cleanup.
