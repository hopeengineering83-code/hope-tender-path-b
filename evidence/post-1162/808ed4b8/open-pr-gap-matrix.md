# Open PR Gap Matrix — Post-#1162 Audit

**Audited main SHA:** `808ed4b8992647a3dec7bbd2a2a6a8aca149d800`
**Date:** 2026-07-17

## Open PRs (6 total)

| PR | Branch | Base | Draft | Title | Status |
|---|---|---|---|---|---|
| #1128 | tmp/app-page-screenshot-capture | main | Y | Temporary screenshot capture workflow | Stale |
| #1130 | fix/github-control-tower | automation/control-plane | Y | Control Tower bootstrap | Stale base |
| #1139 | worker/screenshot-matching-002 | integration/controlled-recovery | Y | Matching pagination + provenance | BLOCKED_DEPENDENCY |
| #1146 | worker/screenshot-vault-privacy-004 | integration/controlled-recovery | Y | Vault privacy + review provenance | mergeable=False (dirty) |
| #1157 | codex/add-route-driven-verification-tests | main | N | Canonical readiness envelopes | Active |
| #1163 | fix/vercel-preview-every-pr | main | Y | Vercel preview for every PR | Active |

## Finding Disposition

| Finding | Description | Classification |
|---|---|---|
| F-01 | Post-merge exact-SHA CI missing | BLOCKER (environment) |
| F-02 | Company review page unbounded | SOLVED_BY_OPEN_PR (#1146, stale base) |
| F-03 | Matching page unbounded | SOLVED_BY_OPEN_PR (#1139, BLOCKED_DEPENDENCY) |
| F-04 | Admin index route 404 | SOLVED_IN_MAIN_BY_1162 |
| F-05 | AI readiness table clips mobile | **NOT_SOLVED_BY_ANY_OPEN_PR** → Fixed in this PR |
| F-06 | Export action group clipped | SOLVED_IN_MAIN_BY_1162 (recheck required) |
| F-07 | Executive snapshot truth mixing | PARTIALLY_SOLVED (#1162 + #1157) |
| F-08 | Documents heading contradicts content | **NOT_SOLVED_BY_ANY_OPEN_PR** → Fixed in this PR |
| F-09 | System page blockers | ENVIRONMENT_BLOCKER |
| F-10 | AI readiness page excessive density | **NOT_SOLVED_BY_ANY_OPEN_PR** → Fixed in this PR (mobile cards) |
| F-11 | Tender detail pages extremely long | PRODUCT_DECISION_REQUIRED |
| F-12 | 404 label/destination disagree | **NOT_SOLVED_BY_ANY_OPEN_PR** → Fixed in this PR |
| F-13 | Screenshot workflow secret pattern unsafe | SECURITY (PR #1128 issue) |
| F-14 | CONDITIONAL_OR_UNSCHEDULED unresolved | PRODUCT_DECISION_REQUIRED |
| F-15 | Integration branch diverged | ROUTING_BLOCKED_BY_DIVERGED_INTEGRATION_BASE |
