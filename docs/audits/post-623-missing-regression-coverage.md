# Post-PR-623 Missing Regression Coverage

**Date:** 2026-06-08
**Related PR:** #622 / #623

## Issue

`tests/proposal-quality-regression.test.ts` referenced in PR #622 was not found in main after the merge. The file is absent from the repository.

## Existing coverage

Similar regression coverage exists in the following files:

- `tests/proposal-quality-repair.test.ts`
- `tests/proposal-quality-scorer-depth.test.ts`
- `tests/core-engine-regressions.test.ts`

## Action required

Recreate `tests/proposal-quality-regression.test.ts` in a follow-up PR, covering any regression scenarios that are not already present in the files listed above.
