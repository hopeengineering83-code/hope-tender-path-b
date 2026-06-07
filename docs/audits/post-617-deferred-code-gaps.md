# Post-617 Deferred Code Gaps

Files outside the authority-review feature edit set that have identifiable gaps.
Bullet points only — no priority assigned here.

## `lib/engine/document-quality-validator.ts`
- `FINANCIAL_IN_TECHNICAL_RE` uses `total\s+price` but `total price` is a common phrase that appears in narrative text (e.g. "total price of the contract"). Consider requiring a numeric follow-on (e.g. `/total\s+price\s*[:\$]?\s*[\d,]/i`) to reduce false positives.
- The validator accepts `fileContent` but tests for base64 only on the first 100 chars — a partially-base64 document could slip through the base64 guard.

## `app/api/tenders/[id]/generate/route.ts`
- `ensurePlannedGeneratedDocumentRecords` creates `GeneratedDocument` rows with `generationStatus: "PLANNED"` — these rows are excluded from authority review since it only checks `GENERATED` docs. If a PLANNED doc is never upgraded to GENERATED, the authority gate never fires on it.
- The metadata completeness check (`assessTenderMetadataCompleteness`) is called but its return value is not surfaced in the JSON error body, so the client cannot render field-level guidance.

## `lib/engine/final-submission-readiness.ts`
- `METADATA_CONTAMINATED` blocker is only added when `tender.metadataContaminated === true`; there is no secondary check that `clientName` is non-empty. A tender with `metadataContaminated: false` but an empty `clientName` would pass this gate silently.
- The `strictTwoEnvelope` flag is derived from submission instructions by pattern matching, but there is no fallback heuristic when instructions are missing — the flag defaults to false, potentially allowing a mixed single-ZIP download for a two-envelope tender.

## `lib/engine/export-readiness.ts`
- `checkExportReadiness` does not validate `exactOrder` uniqueness — two documents with the same `exactOrder` value are not flagged, which can produce unpredictable ZIP ordering.

## `components/final-package-manifest-panel.tsx`
- The panel renders server-side and does not show the authority review status alongside each manifest row. After authority review is wired in, consider co-locating authority blockers per row so the reviewer sees extraction, generation, and authority status in one table.

## `app/api/tenders/[id]/download/route.ts`
- The authority review gate (`AUTHORITY_REVIEW_BLOCKED`) runs for `type=zip` only (via `zipPackage()`). Single-document downloads (`docId` query param, `singleDocument()`) do not run through authority review. Consider adding per-document authority review to the single-document download path.
- The `NEEDS_REVIEW` authority status is not blocking — downloads proceed with warnings unresolved. Consider surfacing a non-blocking advisory header (`X-Authority-Review-Status`) in the ZIP response so consumers can log it.

## `prisma/schema.prisma`
- `GeneratedDocument` has no `authorityReviewStatus` field. Authority review results are computed fresh on every request. If review results need to be persisted (e.g. for audit trail), a stored field would be required.
- `Tender` has no `submissionInstructions` field (despite being referenced in CLAUDE.md requirements); the `analysisSummary` field appears to be used as a catch-all.
