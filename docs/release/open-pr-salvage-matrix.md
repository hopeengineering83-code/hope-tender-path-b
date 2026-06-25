# Open PR Salvage Matrix

Generated on: Thu Jun 25 21:22:43 UTC 2026

## Open PR Inventory
- 874: codex/investigate-issues-in-prs-867,-868,-and-871 (Harden release checks)
- 873: chatgpt/release-guardian-safety-center (Release Guardian safety center)
- 871: fix/release-defects-batch-1-8862473634902028157 (Fix confirmed release defects)
- 870: claude/final-crash-fix (AI Analyze crash fix)
- 869: claude/production-crash-fix (AI Analyze crash)
- 868: fix/harmonize-tender-workflow-ui-13303677724970075219 (Harmonize workflow UI)
- 867: codex/conduct-app-audit-and-scoring (Add full app audit and score)
- 865: claude/ui-fixes-final (UI fixes final)

## Atomic Findings & Classification

| Source PR | File Path | Finding | Classification | Reason/Evidence |
|-----------|-----------|---------|----------------|-----------------|
| 874 | `lib/ai-provider-registry.ts` | Forbidden Z.ai model policy (glm-4.7-flash) | UNIQUE_AND_REQUIRED | Hardens AI provider safety. |
| 874 | `scripts/check-env.mjs` | Production storage readiness check | UNIQUE_AND_REQUIRED | Prevents production deploys without storage. |
| 874 | `lib/env-check.ts` | Environment validation for Z.ai models | UNIQUE_AND_REQUIRED | Ensures runtime safety. |
| 873 | `lib/release-guardian.ts` | Release Guardian logic | UNIQUE_AND_REQUIRED | New safety feature. |
| 873 | `app/dashboard/admin/safety-center/page.tsx` | Safety Center UI | UNIQUE_AND_REQUIRED | Visibility into guardian status. |
| 871 | `lib/ai-jobs/analysis-job-service.ts` | Re-introduction of non-schema fields | UNSAFE_OR_BROKEN | Violates Rule 10; fields (`analysisSource`, `envelopeMode`, etc) not in `schema.prisma`. |
| 871 | `lib/ai-jobs/analysis-job-service.ts` | Removal of persistence error handling | UNSAFE_OR_BROKEN | Violates Rule 10; loses visibility into transaction failures. |
| 871 | `scripts/generate-api-route-security-matrix.mjs` | Security matrix generator | UNIQUE_AND_REQUIRED | Valuable for audit/security. |
| 871 | `docs/audits/2026-06-25-full-app-audit-score.md` | Audit document | UNIQUE_AND_REQUIRED | Documentation of state. |
| 871 | `tests/storage-preflight.test.ts` | Storage preflight tests | UNIQUE_AND_REQUIRED | Verification for storage readiness. |
| 869 | Multiple | Massive file deletions | UNSAFE_OR_BROKEN | Deletes core logic (`lib/ai.ts`). |
| 868 | `components/corrupted-metadata-banner.tsx` | Corruption UI banner | UNIQUE_AND_REQUIRED | UI feedback for extraction issues. |
| 868 | `components/next-action-panel.tsx` | Improved workflow health summary | UNIQUE_AND_REQUIRED | Enhances UI status reporting. |
| 868 | `lib/recovery-command-actions.ts` | Large rewrite of recovery actions | CONFLICTING | Overrides many working actions in main; risk of regression. |
| 865 | `components/tender-recovery-command-center.tsx` | UI Fixes (live page rendering) | UNIQUE_AND_REQUIRED | Ensures panel renders in Stage 6. |
| 865 | Multiple | Anchor fixes | UNIQUE_AND_REQUIRED | Fixes 13 broken anchors. |

## Unsafe/Conflicting Findings Summary
- **PR 871**: Attempts to write `analysisSource`, `envelopeMode`, `clientType`, and `submissionFormat` directly to the `Tender` model. These fields do not exist in `schema.prisma`. Writing them would cause PrismaClientValidationErrors.
- **PR 871**: Removes the `try-catch` block around the transaction in `finalizeJob`, losing the `AI_ANALYSIS_PERSISTENCE_FAILED` error logging.
- **PR 869**: Deleted `lib/ai.ts`.
- **PR 868**: Recovery actions rewrite is too broad and deletes/renames existing stable actions.

## Unique Findings to Integrate
1. Z.ai forbidden model policy (`lib/ai-provider-catalog.cjs`, `lib/ai-provider-registry.ts`, `lib/env-check.ts`, `scripts/check-env.mjs` from PR 874).
2. Production storage readiness check (`scripts/check-env.mjs` from PR 874).
3. API route security matrix generator (`scripts/generate-api-route-security-matrix.mjs` from PR 871).
4. Storage preflight tests (`tests/storage-preflight.test.ts` from PR 871).
5. Corrupted metadata banner (`components/corrupted-metadata-banner.tsx` from PR 868).
6. NextActionPanel UI improvements (`components/next-action-panel.tsx` from PR 868).
7. UI anchor fixes and AIAnalyzePanel rendering fixes (`components/tender-recovery-command-center.tsx` from PR 865).
8. Release Guardian safety center (`lib/release-guardian.ts`, `app/dashboard/admin/safety-center/page.tsx` from PR 873).
