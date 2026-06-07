# Post-617 Full Code Review Plan

## 1. Dead Code Search
- **Unused Routes**: Search for routes that have been superseded by new logic (e.g., old export paths).
- **Stale Helpers**: Check `lib/tender-workflow.ts` for unused status/stage constants.
- **Obsolete Tests**: Identify tests that target removed or refactored features (e.g., `tests/systemic-contradictions-after-517.test.ts`).

## 2. Gate Consolidation
- **Duplicate Logic**: `app/api/tenders/[id]/export/route.ts` and `app/api/tenders/[id]/download/route.ts` both have extensive gate logic. Consider consolidating into a shared helper in `lib/engine/export-readiness.ts`.
- **Extraction Gates**: Ensure `isExtractionAcceptableForExport` and `isExtractionAcceptableForGeneration` are used consistently across all entry points.

## 3. Safe JSON Parsing
- **Risk**: Bare `JSON.parse` calls exist in multiple files (e.g., `app/dashboard/matching/matching-dashboard.tsx`, `lib/engine/final-zip-scope.ts`).
- **Fix**: Migrate all bare `JSON.parse` to `safeParseJsonArray` or `safeParseJsonObject` from `lib/safe-json.ts`.

## 4. Heavy Query Risks
- **fileContent Leakage**: Verified list views do not select `fileContent`.
- **N+1 Queries**: Audit `app/api/tenders/route.ts` for potential N+1 issues when fetching requirements/gaps for multiple tenders.

## 5. Fallback Logic Risks
- **Provider Order**: Verify `CANONICAL_PROVIDER_CHAIN` in `lib/ai.ts` stays updated and Anthropic remains last.
- **Error Handling**: Audit `lib/ai.ts` for silent failures in provider chain.

## 6. Audit Logs
- **Completeness**: Ensure all mutation routes (`POST`, `PATCH`, `DELETE`) have corresponding `logAction` calls.

## 7. Chat/Workbench Leakage
- **Verification**: Ensure `buildFinalZipEntries` in `lib/engine/final-zip-scope.ts` continues to exclude non-planned documents.

## 8. Neon Retention
- **Bloat**: Continue monitoring `fileContent` usage. Ensure `scripts/null-legacy-file-content.ts` is run periodically if legacy content exists.
