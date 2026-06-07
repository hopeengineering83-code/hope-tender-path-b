# Harvest Report — Old Jules PR #587 Branch

**Date:** 2026-06-07  
**Old branch:** `claude/next-level-production-engine-14274064232190832433`  
**Harvest branch:** `claude/harvest-useful-code-from-old-587-jules-branch`  
**Author:** Claude Code (automated audit)

---

## Summary

All useful code from the old Jules branch has already been incorporated into `main`
by earlier PRs. No new code was harvested. The old branch can be safely deleted.

---

## File-by-file Classification

| File | Status | Classification | Notes |
|---|---|---|---|
| `app/api/tenders/[id]/generate/route.ts` | Differs | **D — Do not use** | Jules' version predates metadata override gate, submission-plan repair, authority review gate, and route hardening from PRs #621–#624. Main is 727 insertions ahead. |
| `app/api/tenders/[id]/download/route.ts` | Differs | **F — Superseded** | Main has 109 additional lines of newer download logic. |
| `app/api/tenders/[id]/auto-finalize/route.ts` | Identical | **A — Already in main** | No diff. |
| `lib/ai-job-handlers.ts` | Differs | **F — Superseded** | Main is 306 insertions ahead with newer async safety and job tracking. |
| `lib/engine/ai-input-builder.ts` | Jules only | **C — Refactor, not needed** | Extracts `buildAIBidWriterInput()` but generate-elite.ts already has this logic inline. Importing it would require reworking how generate-elite.ts exports functions. Not worth the risk. |
| `lib/engine/document-quality-validator.ts` | Differs | **A — Already in main** | Jules' two regex improvements (better `FINANCIAL_IN_TECHNICAL_RE` and 500-char base64 check) are both already in main. |
| `lib/engine/generate-elite-helpers.ts` | Jules only | **A — Already in main** | All DOCX helper functions (`parseInlineRuns`, `para`, `heading`, `bullet`, `isTableLine`, `isSeparatorRow`, `splitTableCells`, `parseMdTable`) already exist as private functions in main's `generate-elite.ts`. |
| `lib/engine/generate-elite.ts` | Differs | **A — Already in main** | Jules' `clientContactName` improvements in `fallbackProposalMarkdown` are already in main (lines 360, 410–411, 423, 1511, 1715, 1719). Jules also made many functions private; main correctly keeps them exported for current architecture. |
| `lib/engine/proposal-assembler.ts` | Jules only | **C — Depends on Jules exports** | Imports `repairSectionC2SubSections`, `cleanClientLanguage`, `stripAiSectionH`, `markdownToDocx`, `buildProfessionalDocument`, `buildContactFooterText`, `buildCompanyEvidenceLines`, `buildProjectEvidenceLines` from generate-elite.ts — but these are private in main. Would require making them all exported, which risks exposing internals. Not worth the risk. |
| `lib/engine/sectioned-generation-engine.ts` | Differs | **F — Jules removed a method** | Jules removed `getGeneratedSections()`. Main still has it. Do not apply Jules' diff. |
| `lib/engine/section-evidence-map.ts` | Identical | **A — Already in main** | No diff. |
| `tests/engine/tender-regression.test.ts` | Differs | **A — Already in main** | Jules' two regression tests for `FINANCIAL_IN_TECHNICAL_RE` false-positive fix are already in main at lines 72–95. |
| `tests/fixtures/tenders/building-design.md` | Identical | **A — Already in main** | No diff. |
| `tests/fixtures/tenders/road-design.md` | Identical | **A — Already in main** | No diff. |

---

## Useful Code Found

| Item | Description |
|---|---|
| Regex false-positive fix in `document-quality-validator.ts` | Narrows `FINANCIAL_IN_TECHNICAL_RE` so prose like "total price of the contract was fair" doesn't trigger envelope mismatch. Already in main. |
| Base64 detection window increase | `isBase64Like` check now scans 500 chars instead of 100. Already in main. |
| `clientContactName` in `fallbackProposalMarkdown` | Personalises the "To:" line and adds "Dear [name]," greeting. Already in main. |
| Regression tests for regex fix | Two `node:assert` tests covering both the true-positive and false-positive cases. Already in main. |

---

## Code Harvested

**None.** All useful changes were already present in `main`.

---

## Code Intentionally Rejected

| File | Reason |
|---|---|
| `generate/route.ts` | Jules' version predates metadata override, submission-plan repair, authority review gate, and all route hardening from PRs #621–#624. Merging it would delete those gates. |
| `ai-job-handlers.ts` | Main is 306 insertions newer. Jules' version lacks current async job safety. |
| `download/route.ts` | Main is 109 insertions ahead. Jules' version is older. |
| `ai-input-builder.ts` | Refactoring not needed. Inline logic in `generate-elite.ts` works. Importing would require re-exporting private functions. |
| `proposal-assembler.ts` | Imports functions that are private in main's `generate-elite.ts`. Harvesting would require breaking encapsulation. |
| `generate-elite-helpers.ts` | All functions already private in `generate-elite.ts`. Duplicate. |
| `sectioned-generation-engine.ts` | Jules removed `getGeneratedSections()` which main still needs. |

---

## Files Changed

None. This was a read-only audit. The harvest branch contains only this report.

---

## Tests Run

| Command | Result |
|---|---|
| `npm run typecheck` | PASS — 0 errors |
| `npm test` | PASS — 2313 tests, 0 failures |

---

## Risks

**Risk level: None.** No code was changed. The audit confirms the old Jules branch
has been fully superseded by current main.

---

## Old Branch Disposition

**The old Jules branch `claude/next-level-production-engine-14274064232190832433` can be
safely deleted.** All useful code from it is already in main, and its dangerous/outdated
code (generate route, ai-job-handlers, download route) would overwrite newer, safer
implementations if merged.

**Do NOT merge the old branch directly.** The branch is 1 commit ahead of the old
PR #587 merge point but many commits behind current main. A direct merge would
introduce a ~700-line regression in the generate route alone.

---

## Confirmation: Old Branch Was Not Merged

The old branch was fetched read-only (`git fetch origin <branch>`) and inspected
via `git diff` and `git show`. No cherry-pick, merge, or rebase was performed
against the old branch. All work was done on `claude/harvest-useful-code-from-old-587-jules-branch`,
which was created fresh from `origin/main`.
