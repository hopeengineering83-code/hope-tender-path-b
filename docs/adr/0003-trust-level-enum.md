# ADR 0003: Trust-level enum for Expert/Project records

**Status:** Accepted
**Date:** 2025-08-28
**Deciders:** Hope Engineering, initial codebase authors

## Context

The Hope Tender Engine generates proposals that cite company experts and past
projects as evidence of capability. If AI-generated or pattern-extracted
records (which may contain errors) flow into the proposal generator
unchecked, the result is fabricated evidence — a critical risk for a tender
system where factual accuracy is legally binding.

Forces at play:

- **Document import pipeline:** CVs and project documents are uploaded,
  text-extracted, and parsed. Two extraction methods:
  - Regex pass: pattern-matches names, dates, certifications. Fast but
    brittle; produces `REGEX_DRAFT` records.
  - AI pass: LLM extracts structured fields from document text. Slower but
    more accurate; produces `AI_DRAFT` records.
- **Human review:** a human reviewer validates each record against the source
  document. Reviewed records are `REVIEWED`.
- **Final proposal generation:** must only cite `REVIEWED` records.
- **Audit trail:** generated proposals must record how many `REVIEWED` vs
  `DRAFT` sources were used (even if zero `DRAFT` are used, the count
  must be present for transparency).

## Decision

Add a **`trustLevel` enum** to the `Expert` and `Project` Prisma models with
three states:

```
REGEX_DRAFT   — pattern-extracted, unreviewed
AI_DRAFT      — LLM-extracted, unreviewed
REVIEWED      — human-validated
```

Implementation:

- Field: `trustLevel String @default("REGEX_DRAFT")` on both models.
- **Generation gate:** `lib/engine/run-tender-engine.ts` filters to
  `trustLevel: "REVIEWED"` when loading experts and projects for proposal
  generation.
- **Audit fields on `GeneratedDocument`:** `reviewedExpertCount`,
  `draftExpertCount`, `reviewedProjectCount`, `draftProjectCount` —
  persisted on every generated document so reviewers can audit the source
  mix.
- **Review board UI:** `/dashboard/company/review-board` shows all draft
  records; reviewer toggles `trustLevel` to `REVIEWED`.
- **Cascading demotion:** if a source document is deleted, dependent records
  return to `REGEX_DRAFT` (not deleted) to preserve audit trail.

## Alternatives considered

### Alternative 1: Separate tables for drafts vs reviewed

- **Pros:** clearer separation; impossible to accidentally use drafts.
- **Cons:** table duplication; promotion = row copy (data drift risk);
  harder to query "all records for company X".

### Alternative 2: Boolean `isReviewed` flag

- **Pros:** simpler schema.
- **Cons:** loses extraction-method provenance (regex vs AI); cannot answer
  "how was this record originally created?".

### Alternative 3: Status workflow (`DRAFT → IN_REVIEW → REVIEWED → REJECTED`)

- **Pros:** richer workflow.
- **Cons:** premature optimization; current scale doesn't need IN_REVIEW state.

## Consequences

### Positive

- **Strong defense against fabricated evidence** (non-negotiable rule #3:
  "Never invent Experts, Projects, clients, credentials, ..."). The enum
  physically prevents unreviewed records from entering generation.
- **Audit trail:** `GeneratedDocument.draftExpertCount` + `reviewedExpertCount`
  transparency supports compliance and post-hoc review.
- **Provenance:** extraction method (REGEX vs AI) is preserved, supporting
  future quality analysis.

### Negative

- **Manual review bottleneck:** every imported record must be reviewed before
  it can be used. Mitigated by the review-board UI batch operations.
- **Schema rigidity:** adding a new trust level requires a Prisma migration.

### Neutral

- Default is `REGEX_DRAFT` (lowest trust). New records start untrusted and
  must earn trust through review.

## Compliance

- **Rule #2 (Company Vault is the only factual source for company claims):**
  ✓ — only `REVIEWED` records flow to generation.
- **Rule #3 (Never invent Experts, Projects, ...):** ✓ — the enum physically
  prevents unreviewed records from being used.
- **Rule #10 (Zero `GeneratedDocument` rows before ...):** ✓ — generation
  gate checks `reviewedExpertCount > 0` before allowing generation to
  proceed.

## Future considerations

- **Bulk review tooling (GAP-UX-05):** if review becomes a bottleneck, add
  bulk-approve UI for low-risk fields.
- **Confidence scoring:** attach a `confidenceScore` to AI_DRAFT records so
  reviewers can prioritize low-confidence items.

## References

- `prisma/schema.prisma` — `Expert.trustLevel`, `Project.trustLevel`,
  `GeneratedDocument.reviewedExpertCount`, etc.
- `lib/engine/run-tender-engine.ts` — REVIEWED filter
- `app/dashboard/company/review-board/page.tsx` — review UI
- `tests/trust-level-enforcement.test.ts` — behavior-lock tests
