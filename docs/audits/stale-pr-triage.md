# Stale PR triage

Snapshot taken alongside `fix/strict-final-zip-scope-and-export-policy`
(post-PR #422 production alignment pass). This document gives the
repository owner a recommendation per stale open PR. **No PRs are
closed or merged automatically — this is documentation only.**

## Already-resolved

| PR | Title | State | Recommendation |
|---|---|---|---|
| #418 | Repair export readiness document gaps | MERGED | Already on `main` (commit fbef…). No action. |
| #420 | Harden CI and stale PR hygiene | MERGED | Already on `main`. No action. |
| #422 | feat: 4-provider AI fallback, source-grounding repair, export hygiene gate, ZIP tests | MERGED | Already on `main` (commit 8e32…). This PR builds on top. |

## Stale / superseded — recommend close

These PRs predate the production alignment work and overlap with
already-merged fixes. Do not merge directly.

| PR | Why superseded |
|---|---|
| #419 | "Fix export pricing hygiene false positive" — superseded by #422's export hygiene gate. Close as superseded. |
| #421 | "Add DeepSeek and OpenAI as AI provider fallbacks" — fully implemented by #422. Close as superseded. |
| #407 | Closed/redundant per task brief. Do not reopen. |
| #404 | Diverged from `main`; do not merge directly. Cherry-pick if any individual commit is still useful. |

## Older open PRs — manual extraction only

These PRs are old enough that a direct merge will conflict. Open
each and extract only the still-valid changes if any. **Do not
merge directly.**

| PR | Recommendation |
|---|---|
| #402 | Manual review — extract still-valid changes only; close after extraction. |
| #401 | Manual review — close if changes are no longer applicable. |
| #367 | Manual review — likely superseded by deep-reasoning rollout (#384–#393). |
| #332 | Manual review — pre-#382 timestamp; close if scope is covered. |
| #323 | Manual review. |
| #312 | Manual review. |
| #262 | Manual review — old enough that scope drift is likely; close if superseded. |

## Process

1. Repository owner reviews each "Stale" PR and clicks **Close as
   superseded** with a comment pointing to the merged PR that
   replaced it.
2. For "manual extraction" PRs, owner either:
   - cherry-picks any commit still worth keeping into a fresh
     branch, then closes the PR, OR
   - closes outright if no commit is still relevant.
3. Do not enable GitHub auto-close on staleness without a label
   review — the repo has hand-curated branches that should not
   be auto-closed by date alone.

## CI / Vercel / Datadog gate

Per merge-policy docs added in PR #420, every PR — including this
audit — must show:

- ✅ GitHub Actions (Typecheck, test, and build)
- ✅ Vercel deployment ready
- ✅ Datadog synthetics green

before merging to `main`.
