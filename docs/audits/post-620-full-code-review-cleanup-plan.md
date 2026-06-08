# Post-620 Full Code Review & Cleanup Plan

**Date:** 2026-06-07  
**Status:** Active — items tracked per-sprint  
**Scope:** Logic consolidation, deduplication, and safety hardening identified after PR #620

---

## 1. Unsafe JSON.parse Calls (COMPLETED in #622)

Several components and API routes called `JSON.parse()` on raw database fields without try/catch.

**Fixed in #622:**
- `app/dashboard/matching/matching-dashboard.tsx` — `match.expert.disciplines` / `match.expert.sectors`
- `app/dashboard/tenders/[id]/tender-detail.tsx` — multiple inline JSON.parse calls on requirement/matrix fields
- API routes parsing `serviceAreas`, `disciplines`, `sectors` fields

**Pattern to apply going forward:** always wrap database JSON fields in:
```ts
function safeParse<T>(raw: string | null, fallback: T): T {
  try { return raw ? (JSON.parse(raw) as T) : fallback; }
  catch { return fallback; }
}
```

---

## 2. Anthropic SDK Instantiation Typo (COMPLETED in #622)

`lib/ai.ts` contained `Anthropicas` (missing space) which caused a TypeScript error.

**Fixed:** `Anthropicas` → `Anthropic as` in the provider chain initialisation block.

---

## 3. Duplicate Sector Classification Logic (DEFERRED)

`lib/engine/universal-tender-taxonomy.ts` and `lib/engine/matching.ts` both implement partial sector keyword detection independently. The taxonomy classifier should be the single source of truth.

**Recommended action:** Refactor `matching.ts:detectDominantFamily` to delegate to the taxonomy classifier instead of maintaining its own keyword lists.

---

## 4. Export Gate Duplication (DEFERRED)

The export-readiness gate logic is partially duplicated between:
- `lib/engine/export-readiness.ts` (`checkExportReadiness`)
- `app/api/tenders/[id]/download/route.ts` (inline pre-flight checks)
- `app/dashboard/tenders/[id]/tender-detail.tsx` (client-side `canExport` derivation)

**Recommended action:** Consolidate into `checkExportReadiness` as the single gate. Remove inline re-implementations.

---

## 5. Placeholder Detection Pattern Drift (DEFERRED)

Three modules independently define placeholder regex patterns:
- `lib/engine/document-quality-validator.ts` — `PLACEHOLDER_RE` (13 patterns)
- `lib/engine/authority-review.ts` — `PLACEHOLDER_RE` (7 patterns, different subset)
- `lib/engine/proposal-quality-scorer.ts` — forbidden-phrase list (overlap)

**Recommended action:** Extract a single `PLACEHOLDER_PATTERNS` constant to `lib/engine/detection-patterns.ts` and import it everywhere.

---

## 6. Missing Fixture Coverage (PARTIALLY COMPLETED in #622)

Jules PR #622 claimed 14 new fixtures but delivered 12. The following were missing and added in the follow-up cleanup:
- `tests/fixtures/tenders/geotech-survey.md` ✅ added
- `tests/fixtures/tenders/urban-planning.md` ✅ added

Total fixture count after cleanup: 14 synthetic tenders.

---

## 7. Missing Regression Test File (COMPLETED in follow-up cleanup)

`tests/proposal-quality-regression.test.ts` was described in PR #622 but not committed.

**Added in follow-up:** 18 tests covering:
- Proposal quality scorer (structureCompleteness, aiTraceFreedom, sectorVocabulary)
- Pricing leakage guard (technical/financial/CV envelope separation)
- Document quality validator (AI trace, placeholder, envelope mismatch)
- Authority review gates (CRITICAL blockers, AUTHORITY_READY path)
- Document output state filtering (SUPERSEDED exclusion)

---

## 8. Provider Chain Hard-coded Fallback Check (ONGOING)

`tests/static-safety.test.ts` verifies Anthropic is the last provider. This test must remain green after any AI provider refactoring.

**Rule:** Anthropic must never be moved above Groq, OpenRouter in the fallback chain.

---

## 9. No-fileContent in List Endpoints (ONGOING)

`tests/static-safety.test.ts` scans API list routes to confirm `fileContent` and `extractedText` are never selected. This prevents accidental OOM in paginated responses.

**Rule:** Any new `findMany` in a list/dashboard API must not include `fileContent`, `extractedText`, or `rawContent` in its `select` clause.

---

## Priority Order for Remaining Items

| # | Item | Priority | Effort |
|---|---|---|---|
| 3 | Sector classification dedup | Medium | 2h |
| 4 | Export gate consolidation | High | 4h |
| 5 | Placeholder pattern dedup | Medium | 1h |
| 8 | Provider chain test maintenance | Low (ongoing) | — |
| 9 | fileContent list guard | Low (ongoing) | — |
