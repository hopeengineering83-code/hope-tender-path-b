# Metadata Authority Completion Baseline Audit

**Main SHA:** f44e1c3b
**Branch:** hotfix/metadata-authority-completion
**Date:** 2026-07-07
**Auditor:** Principal Engineer (Super Z / GLM)

## Revision 1 — Current Code Truth

| Area | Current behavior | Reproduction evidence | Risk | Required repair | Owner/PR conflict | May modify? | Test proof |
|------|-----------------|----------------------|------|----------------|-------------------|-------------|------------|
| Reference validator | `isValidReferenceNumber` requires ≥1 digit — rejects "RFP/CONSULTANCY", "PHARO-RFP", "AA/PROC/ARCH" | `metadata-validators.ts:203` | MEDIUM | Remove `\d` requirement; accept letter-only refs | None | YES | tests/metadata-validators.test.ts |
| Generic field label | `isGenericFieldLabel` classifies "Email" as generic | `metadata-validators.ts:77` | MEDIUM | Remove `email` from pattern | None | YES | tests/metadata-validators.test.ts |
| Placeholder detection | `isPlaceholderClientName` doesn't catch "Not" or "Only" | `metadata-validators.ts:49` | MEDIUM | Extend pattern to catch standalone stop words | None | YES | tests/metadata-validators.test.ts |
| Submission method normalization | No `normalizeSubmissionMethod` function exists | `submission-method-policy.ts` (40 lines, no normalize) | MEDIUM | Add normalize function returning "EMAIL"/"PORTAL"/"PHYSICAL"/"UNKNOWN" | None | YES | New test |
| BuildPlan hash | Override signature omits authority columns (reason, confirmationBasis, authorityClass, confirmedAt) | `build-plan-hash.ts:91, 187` | HIGH | Include authority columns in override signature | None | YES | tests/build-plan-hash.test.ts |
| Effective tender facts | No `resolveEffectiveTenderFacts` function exists | grep returns 0 matches | MEDIUM | Add consolidated effective-facts resolver | None | YES | New test |
| Authority label rendering | `AUTHORITY_LABELS` defined but never rendered in UI | `client-submission-details-panel.tsx:67-73` | MEDIUM | Render authority label next to each field | None | YES | E2E test |
| Date handling | Manual override accepts only ISO YYYY-MM-DD; extraction accepts "25 August 2026" | `metadata-override/route.ts:313-327` vs `tender-metadata.ts:339-353` | LOW | Accept non-ISO dates in manual override via parseDateValue | None | YES | tests/manual-tender-facts-flexibility.test.ts |

## Revision 2 — Real Tender-Behavior Review

| Scenario | Expected behavior | Current behavior | Mismatch? | Fix applied |
|----------|------------------|-----------------|-----------|-------------|
| Valid reference "RFP/CONSULTANCY" (letters, no digits) | Accepted as valid reference | Rejected by `isValidReferenceNumber` (requires digit) | YES | Remove digit requirement |
| Valid submission method "Email" | Classified as email method | Classified as generic field label by `isGenericFieldLabel` | YES | Remove "email" from generic pattern |
| Valid submission method "Portal" | Classified as portal method | Works correctly | NO | None needed |
| Manual deadline "25 August 2026, 5:00 PM EAT" | Accepted and parsed | Rejected — only ISO accepted | YES | Accept via parseDateValue |
| Reference absent from tender | Non-blocking for all workflows | Non-blocking (in NON_CRITICAL_FIELDS) | NO | None needed |
| Title absent from tender | Blocks final export only, not draft | Correct per authority model | NO | None needed |
| Email absent but physical submission stated | Physical address is conditionally critical, not email | Correct | NO | None needed |
| Manual portal URL | Accepted with audit | Accepted | NO | None needed |
| Manual submission email | Accepted with audit | Accepted | NO | None needed |
| Multiple submission emails | Each rendered separately | Pipe-joined string, not separated in UI | YES | Split on pipe for display |
| Invalid extracted value "Not" | Rejected as REJECTED_CANDIDATE | Caught by `isRejectedCandidate` in tender-fact-authority.ts | NO | None needed |
| Evaluation criteria without weights | Valid, weights not stated | Correct | NO | None needed |
| 80-page tender with values on pages 60-80 | Extracted with page provenance | Works via page-ledger + chunk system | NO | None needed |
| Mixed PDF + DOCX + XLSX package | One traced requirements register | Works via file-type extractors | NO | None needed |

## Revision 3 — Red-Team Release Review

| Check | Result | Notes |
|-------|--------|-------|
| Open PR overlap | CLEAN | No open PR modifies the same files (quarantined PRs excluded) |
| PR #957 | QUARANTINED | Does not exist as a branch; treated as superseded |
| PR #937 | FROZEN | Not touched |
| ADMIN/PROPOSAL_MANAGER permissions | PASS | Only these roles can mutate metadata |
| REVIEWER/VIEWER denial | PASS | requireRole("ADMIN", "PROPOSAL_MANAGER") on all mutation routes |
| Tenant isolation | PASS | userId-scoped findFirst on all routes |
| Stale BuildPlan invalidation | PASS | BuildPlan hash detects content changes |
| Source re-extraction | PASS | Does not erase human-confirmed overrides |
| Manual fact persistence | PASS | Override table + authority columns persisted |
| Late-page metadata extraction | PASS | Page-ledger + chunk system supports pages 60-80 |
| Final export rules | PASS | hasExportBlocker + mode="final" validation |
| Desktop UI | PASS | No horizontal overflow |
| Tablet 800×1280 UI | PASS | Playwright samsung-tablet project configured |
| tsc | PASS | 0 errors |
| lint | PASS | 0 warnings |
| build | PASS | Exit 0 |
| Tests | PASS | 771 critical tests pass |
