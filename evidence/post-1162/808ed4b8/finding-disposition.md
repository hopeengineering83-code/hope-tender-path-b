# Finding Disposition — Post-#1162 Audit

**Audited main SHA:** `808ed4b8992647a3dec7bbd2a2a6a8aca149d800`
**Repair branch:** `fix/post-1162-screenshot-gap-closure`

## Fixes implemented (3 — all NOT_SOLVED_BY_ANY_OPEN_PR)

### F-05: AI readiness table clips mobile content
- **Severity:** High
- **Root cause:** `overflow-hidden` on section + `min-w-full` table clips Scope, Severity, Purpose columns on mobile
- **Fix:** Replaced `overflow-hidden` with `overflow-x-auto` wrapper for desktop/tablet + mobile card layout (`sm:hidden`) showing all fields
- **File:** `app/dashboard/admin/ai-readiness/page.tsx`
- **Test:** 5 source-text tests verifying no overflow-hidden, has overflow-x-auto, has mobile cards, cards show all fields

### F-08: Documents page heading contradicts content
- **Severity:** Medium
- **Root cause:** Heading says "Generated Documents" when 0 are generated — misleading
- **Fix:** Changed heading to "Document Workspace" (truthful for all states: 0 generated, planned, or generated)
- **File:** `app/dashboard/documents/page.tsx`
- **Test:** 1 source-text test verifying heading says "Document Workspace" not "Generated Documents"

### F-12: 404 page label/destination disagree
- **Severity:** Medium
- **Root cause:** Button says "Return to dashboard" but links to `/` (home, not dashboard)
- **Fix:** Changed label to "Return home" to match the `/` destination
- **File:** `app/not-found.tsx`
- **Test:** 1 source-text test verifying label says "Return home" not "Return to dashboard"

## Gaps NOT fixed (owned by other PRs or blocked)

| Gap | Owner | Reason |
|---|---|---|
| F-02 Company review unbounded | PR #1146 | Stale base (integration/controlled-recovery diverged) |
| F-03 Matching unbounded | PR #1139 | BLOCKED_DEPENDENCY on #1146/#1149/#1151 |
| F-07 Executive snapshot truth mixing | PR #1157 + #1162 | Partially solved; #1157 adds readiness envelopes |
| F-01 Exact-SHA CI missing | Environment | No GitHub Actions runs on merge commit |
| F-09 System page blockers | Environment | Vercel/storage configuration, not code defect |
| F-11 Tender detail length | Product decision | Needs tabs/anchors design decision |
| F-13 Screenshot workflow security | PR #1128 | Unsafe credential pattern; needs trusted workflow |
| F-14 CONDITIONAL_OR_UNSCHEDULED | Product decision | Needs business rule specification |
| F-15 Integration branch diverged | Routing | 9 commits ahead, 1 behind; needs reconciliation |
