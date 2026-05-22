# PR Backlog Audit — 2026-05-22

## Scope and execution constraints

This audit was executed from the local workspace only. The environment has no configured Git remote and no GitHub CLI (`gh`) installed, so direct PR operations (commenting/closing PRs, checking live mergeability, inspecting remote PR file diffs) could not be executed from this runtime.

- `git remote -v` returned no remotes.
- `gh` command is unavailable.

Because of that, PR-state fields below are marked **manual action required** where GitHub API access is needed.

## Current local baseline

- Local branch: `work`
- Current local HEAD at audit time: `40f0e2d` (after Plan-B audit-action typing fix)
- Confirmed target main SHA from request: `2a0e6234139297c044b1a811441d120aae8b041c` (not verifiable from this environment due to no remote)

## Vercel/deployment status

Not directly queryable from this environment. Use Vercel dashboard for authoritative status.

## PR #411 closure status

- **Status in this environment:** cannot verify or close directly (no GitHub API/CLI access).
- **Required comment text:**
  > Superseded by merged PR #412. The Plan-B import hardening work is already in main. Closing to avoid duplicate/diverged PR history.
- **Manual action required:** add comment and close PR #411 in GitHub UI.

## PR #413 audit (cron)

### What was verified locally

- `vercel.json` is present in repository.
- Route path exists in codebase pattern for cron target checks should reference:
  - `app/api/ai-jobs/run-next/route.ts`

### What could not be verified without PR branch access

- Whether PR #413 changes only `vercel.json`.
- Whether exact cron entry is present in PR diff:
  - `{"path":"/api/ai-jobs/run-next","schedule":"* * * * *"}`
- Whether PR #413 draft/ready state is current.

### Validation runs (local)

- `npm run typecheck` ✅ passed
- `npm test` ✅ passed
- `npm run build` ⚠️ failed only due to missing local env vars:
  - `DATABASE_URL`
  - `SESSION_SECRET`

(These are environment precheck failures, not code compile/test regressions.)

## Open PR backlog classification (requested set)

> Classification legend:
> A = Already fully present in main
> B = Superseded by newer open PR
> C = Still valuable and missing from main
> D = Unsafe/outdated/conflicting and should be closed
> E = Needs manual review because risk is high

Because PR branch diffs are not accessible from this environment, these are **provisional classifications requiring GitHub-side confirmation**.

| PR | Title (short) | Provisional Class | Recommended Action | Notes |
|---|---|---:|---|---|
| #404 | Tighten generation/readiness gates... | E | needs manual review | Likely overlaps with #405 and subsequent main commits; verify unique deltas before close. |
| #403 | Tighten generation/export readiness... | E | needs manual review | Likely partially superseded by later readiness/export work; compare commits to main. |
| #402 | Fix AI proposal input wiring... | E | needs manual review | High overlap potential with later merges; code-diff confirmation needed. |
| #401 | Normalize requirementType... | E | needs manual review | Risk of mixed domain/constraint logic drift; verify tests vs main. |
| #400 | Refine doc-generation gating... | E | needs manual review | Potentially superseded by later gating fixes; verify exact files. |
| #367 | Auto-fill client name during engine run | E | needs manual review | Some related behavior appears in main history; still confirm branch diff. |
| #332 | Proposal stability/serverless/test bootstrap | E | needs manual review | Older broad PR with possible stale infra assumptions; high-risk. |
| #323 | Matching constraints/diagnostics UI | E | needs manual review | Could contain still-useful diagnostics; must diff carefully. |
| #322 | Homepage revamp + matching changes | D/E | needs manual review | Homepage scope is non-core for tender-engine hygiene; likely close unless matching deltas are unique and safe. |
| #313 | PIC evaluator loop | E | needs manual review | High-risk feature branch; needs targeted architectural review. |
| #312 | Wire PIC into AI writer | E | needs manual review | Dependent on #313 semantics; unsafe to merge blindly. |
| #262 | Extraction classification/quantity/scoring | E | needs manual review | Very old branch likely stale; still code-diff required before closure. |

## Files changed by each PR

Not available from this environment (no PR ref access). Use GitHub PR “Files changed” tab or `gh pr view <id> --json files` in an authenticated environment.

## Unique missing functionality assessment

Cannot be concluded without fetching PR branches and diffing against target main SHA. Manual GitHub-side diff audit required.

## Risks and conflicts

1. **Operational risk:** Closing PRs without code-diff verification could lose unique bug fixes.
2. **Regression risk:** Older branches may regress #407 safe-mode and #412 Plan-B hardening unless cherry-picked selectively.
3. **Merge hygiene risk:** Multiple overlapping readiness/gating PRs increase accidental reintroduction of stale logic.

## Validation commands and results

- `npm run typecheck` → pass
- `npm test` → pass
- `npm run build` → fail (env precheck only: missing `DATABASE_URL`, `SESSION_SECRET` in local environment)

## Consolidation branch decision

No consolidation branch was created from this environment because remote/main parity and PR diffs cannot be verified locally without GitHub access.

Recommended once remote access is available:

1. Fetch `origin/main` and all PR heads.
2. Run file-level diff matrix PR-by-PR.
3. Create `audit/consolidate-remaining-pr-gaps` only if unique safe deltas (Class C) are found.
4. Re-run full validation and open a single consolidation PR.

## Exact manual actions remaining

1. Close PR #411 with the superseded comment.
2. Audit PR #413 file diff and route/env correctness in GitHub UI; if only cron config and checks pass, mark ready for review.
3. Run authoritative backlog audit with GitHub access for PRs #404/#403/#402/#401/#400/#367/#332/#323/#322/#313/#312/#262.
4. Only then decide close vs consolidate for each PR.
