# Open PR deep audit and extraction plan — 2026-06-14

## Scope and source limitations

This audit re-checks the current public GitHub pull request state for `hopeengineering83-code/hope-tender-path-b` on 2026-06-14 and reviews the only open PRs the owner identified: **#724, #725, #726, and #727**.

Live GitHub access from this container is limited:

- `gh` is not installed.
- `git ls-remote https://github.com/hopeengineering83-code/hope-tender-path-b.git ...` failed with `CONNECT tunnel failed, response 403`.
- The browser-accessible GitHub HTML pages were available and showed PR metadata, descriptions, commits, and Vercel comments, but not all file diffs.

Because the branch diffs could not be fetched locally, this document separates **verified facts from GitHub pages**, **verified facts in the local app checkout**, and **recommendations/inferences**. Do not treat this as a merge approval for any draft PR.

## Executive verdict

| PR | Title | Current state | Helpfulness | Action |
| --- | --- | --- | --- | --- |
| [#724](https://github.com/hopeengineering83-code/hope-tender-path-b/pull/724) | Draft: application security and reliability hardening | Draft, 50 commits into `main` from `codex/full-gap-closure` | **Helpful ideas, risky package** | Do **not** merge as one batch. Extract/verify the best security pieces only after #725 is reconciled. |
| [#725](https://github.com/hopeengineering83-code/hope-tender-path-b/pull/725) | fix: secure and stabilize the production foundation | Draft, 1 commit into `main` from `fix/foundation-security-release-p0-16933862128327373888` | **Potentially important P0 security work** | Highest-priority extraction target, but needs hard review because some claims conflict with current app state. |
| [#726](https://github.com/hopeengineering83-code/hope-tender-path-b/pull/726) | docs: add dated audit of open PRs (2026-06-14) | 1 commit into `main` from `codex/create-new-pr-and-audit-open-prs` | **Not useful enough as originally written** | Replace with this deeper audit; do not merge the shallow original by itself. |
| [#727](https://github.com/hopeengineering83-code/hope-tender-path-b/pull/727) | fix(ui): align user actions with extraction and analysis readiness | Draft, 1 commit into `main` from `claude/fix-extraction-workflow-alignment-14399471516264639915` | **Useful and comparatively low risk** | Keep/extract the workflow-readiness logic. Fix preview deployment before merge. |

## Priority extraction plan

### 1. Extract/keep PR #727 first

PR #727 is the clearest product improvement. It fixes a direct user-facing contradiction: the app should not push users to run AI Analyze when extraction quality is weak, partial, OCR-required, or otherwise untrusted.

**Why it matters:** this aligns the main app with the safety model already used throughout the codebase: bad extraction must block analysis, generation, and export rather than letting users advance into misleading green states.

**Local verification:** the current checkout already contains the core #727 extraction:

- `lib/tender-next-action.ts` defines a centralized workflow decision model with `FIX_EXTRACTION`, `RUN_AI_ANALYZE`, `REVIEW_REQUIREMENTS`, and export-related states.
- `resolveTenderNextAction()` prioritizes extraction failures before AI Analyze by checking page coverage, average score, corruption, OCR, and partial extraction signals.
- `tests/tender-next-action.test.ts` verifies that weak extraction shows **Fix Extraction First**, regex fallback wording remains draft-only, raw and trusted requirements are displayed separately, and stale/missing documents are not shown as export-ready.

**Required fix before merge:** PR #727's Vercel preview showed an error. Do not merge until the final head deploys successfully. If GitHub still cannot expose the diff, cherry-pick only the already-verified local files and tests rather than merging the PR branch blindly.

**Suggested review:** approve the idea, request deployment repair, then merge or cherry-pick after typecheck/tests pass.

### 2. Review PR #725 as the focused security candidate

PR #725 is more focused than #724 and claims to harden: database-backed revocable sessions, secure password reset, centralized RBAC, upload/storage pipelines, security headers, health/readiness, and production schema management.

**Why it matters:** if correct, this is the most important security work among the open PRs. The current local app still has gaps that #725 claims to fix:

- `lib/auth.ts` still creates a stateless HMAC cookie and has no revocation lookup in `getSession()`.
- `prisma/schema.prisma` has a `Session` model, but the visible auth helper does not use it for session creation/lookup in the current checkout.
- `middleware.ts` currently only applies CSRF policy and does not set the production security headers claimed by #725.
- `app/api/system/readiness/route.ts` requires authentication but does not require ADMIN in the current checkout.
- `app/api/health/route.ts` still performs database/schema checks; #725 claims a lighter health route and a restricted readiness endpoint.

**Contradiction to resolve:** #725 says shared rate limiting remains in-memory, while #724 claims shared PostgreSQL-backed rate limiting. If both are open, #725 may be a partial/focused subset and #724 may be the broader follow-up. Do not merge both without deduplicating their migration/schema/auth changes.

**High-value extraction targets from #725:**

1. Database-backed, revocable sessions using hashed tokens.
2. One-time password reset tokens with indistinguishable responses and no reset-link leakage.
3. Removal of runtime DDL from request/login paths.
4. ADMIN-only readiness checks while keeping public health lightweight.
5. Security headers in middleware, without weakening CSRF.
6. Upload magic-byte validation and safe size limits.
7. Service worker exclusions for private/API routes.

**Merge blockers:**

- Must inspect actual diff for migration correctness before merge.
- Must verify login, logout, session revocation, reset request, reset consume-once, and repeated/expired reset handling.
- Must verify production env vars (`SESSION_SECRET`, `DATABASE_URL`, bootstrap flags, SMTP) are configured.
- Must verify migration strategy against production database and write a real rollback plan; "revert to base SHA" is too thin for schema/auth changes.
- Must run final CI and Vercel preview on the final head.

**Suggested review:** do not approve as-is while draft; request exact diff review, migration proof, auth/reset smoke evidence, and an extraction list if #724 overlaps.

### 3. Treat PR #724 as a broad audit/source branch, not a direct merge candidate

PR #724 is broad: 50 commits, draft, and includes auth, reset, rate limiting, migrations, AI job isolation, storage deletion, upload hardening, readiness/liveness separation, headers, CI, and AI prompt-injection boundary work.

**Why it matters:** several ideas are valuable, but merging 50 commits at once risks breaking production auth, database schema, uploads, AI jobs, storage deletion, and deployment health checks simultaneously.

**High-value extraction targets from #724 after #725 review:**

1. PostgreSQL-backed shared rate limiting if #725 only uses an in-memory map.
2. Owner-scoped AI background job claiming/failing so one user cannot claim or fail another user's jobs.
3. Durable storage enforcement and deletion lifecycle hardening, but only with owner-scoped deletion tests.
4. Hardened upload routing for all upload endpoints if #725 covers only part of the pipeline.
5. AI prompt-injection trust-boundary handling and idempotent provider reconciliation.
6. CI workflow additions that verify install, Prisma, typecheck, lint, tests, and build for hardening branches.
7. Controlled Prisma baseline scripts, but only after manual database target verification.

**Merge blockers:**

- Do not merge #724 directly while #725 exists with overlapping auth/storage/upload/migration scope.
- Require a file-level diff review and split extraction into smaller PRs by blast radius.
- Require final Vercel preview, migration guard proof, auth/reset smoke, storage delete smoke, upload fixture smoke, and multi-user AI job smoke.

**Suggested review:** convert #724 into a source-of-patches branch. Extract only non-overlapping, tested pieces after #725 and #727 are resolved.

### 4. Replace PR #726 with this deeper audit

PR #726 was too shallow. It originally saw only #724 and missed the owner's current open PR set (#724, #725, #726, #727). This updated audit is the correct replacement because it:

- audits all four open PRs the owner identified;
- compares the PR claims against the current local app files where possible;
- separates useful extraction targets from risky merge candidates;
- gives a concrete order for extracting important updates instead of ignoring them.

Do not merge the original one-PR-only audit by itself.

## Detailed PR reviews

### PR #724 — consolidated security/reliability hardening

**Observed from GitHub:** draft PR; 50 commits; branch `codex/full-gap-closure`; owner comment says it must not be merged until GitHub CI, controlled Prisma baseline, database guard verification, and Vercel preview checks pass. Scope includes revocable sessions, secure password reset, shared rate limiting, migration-only schema management, AI job tenant isolation, durable storage controls, secure upload validation, readiness/liveness separation, and security headers.

**Helpful?** Yes, but too broad to merge safely.

**Waste of time?** Not if treated as a patch source. Yes if treated as a single merge.

**Extract these if not already in main:** owner-scoped AI jobs, DB-backed rate limiting, prompt-injection boundary, upload hardening, storage lifecycle, CI verification, and any production migration guard not present in #725.

**Reject/defer these until proved:** destructive storage deletion, Prisma baseline scripts, and auth/session rewrites without final smoke evidence.

### PR #725 — focused production foundation/security

**Observed from GitHub:** draft PR; 1 commit; base SHA `1c50bb4`; Vercel preview ready; claims seven new behavioral security tests and 3450+ baseline tests passing; remaining risk says shared rate limiting still uses an in-memory map.

**Helpful?** Yes. This is the most important PR to inspect and extract because current local files show real gaps in stateless sessions, readiness role restrictions, and security headers.

**Waste of time?** No, but it must not be merged blindly. It changes foundation-level behavior.

**Extract these first:** DB-backed sessions, hashed reset token flow, readiness ADMIN gate, security headers, upload validation, and service-worker private/API cache exclusions.

**Fix before merge:** make the rollback plan concrete, verify migrations, and reconcile overlap with #724.

### PR #726 — original dated audit

**Observed from GitHub:** 1 commit; Vercel preview ready; adds `docs/audits/open-pr-review-2026-06-14.md`; originally identified #724 as the only open PR.

**Helpful?** Only as a starting point.

**Waste of time?** Yes if merged unchanged, because it misses #725 and #727 and does not answer the owner's actual extraction question.

**Action:** keep this updated replacement; the old one-PR-only audit should be considered superseded.

### PR #727 — workflow UI/extraction readiness alignment

**Observed from GitHub:** draft PR; 1 commit; branch `claude/fix-extraction-workflow-alignment-14399471516264639915`; description says it centralizes next-action logic, prioritizes "Fix Extraction First," clarifies regex fallback as draft-only/untrusted, prevents 100% metadata completion with missing placeholders, separates traced vs mandatory counts, adds untrusted-analysis confidence warnings, and adds tests. Vercel preview showed deployment error.

**Helpful?** Yes. This is a direct app-quality fix and should be extracted/kept.

**Waste of time?** No, except the failing preview must be fixed.

**Local verification:** the current checkout includes the centralized `resolveTenderNextAction()` implementation and matching tests, and the full local test suite passed with 3437 tests.

**Action:** keep the code, repair preview/build if the PR branch still fails, then merge/cherry-pick.

## Recommended sequence

1. **Keep this audit update (#726 replacement).** It becomes the triage map.
2. **Finish #727 next.** It is useful, low-risk, and locally verified by tests.
3. **Deep-review #725 diff.** Extract security foundation changes with migration/auth smoke evidence.
4. **Mine #724 only after #725.** Pull non-overlapping improvements from #724: DB-backed rate limits, AI job tenancy, prompt-injection boundary, upload/storage hardening, CI, and migration guard scripts.
5. **Close/supersede duplicate drafts.** Do not keep multiple overlapping hardening PRs open after extracting their useful changes.

## Minimum checks before merging extracted work

- `npm run typecheck`
- `npm test -- --runInBand`
- Vercel preview ready on final head
- Auth smoke: login, logout, session revocation, reset request, reset consume once, expired/reused token rejection
- Upload smoke: valid PDF/DOCX/XLSX/ZIP accepted; mismatched signatures and active content rejected
- Storage smoke: deleting a tender file/company document deletes only the authenticated owner's underlying object
- AI job smoke: two users/jobs cannot claim or fail each other's jobs
- Health/readiness smoke: public liveness is lightweight; readiness is restricted to ADMIN
- Migration proof: final migration plan, target DB guard, and rollback written before production deploy
