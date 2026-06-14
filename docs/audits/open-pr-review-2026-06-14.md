# Open PR audit and review — 2026-06-14

## Scope

Audited the GitHub open pull request list for `hopeengineering83-code/hope-tender-path-b` on 2026-06-14. The public pull request page showed **1 open pull request** at review time:

| PR | Status | Branch | Title | Review verdict |
| --- | --- | --- | --- | --- |
| [#724](https://github.com/hopeengineering83-code/hope-tender-path-b/pull/724) | Draft | `codex/full-gap-closure` -> `main` | Draft: application security and reliability hardening | **Do not merge yet** |

Note: unauthenticated GitHub pages sometimes showed stale/cached pull request counts while loading dynamic content. The latest accessible pull request list and PR page both identified #724 as the only open PR at the time of this audit.

## PR #724 summary

PR #724 is a broad 50-commit draft security and reliability hardening branch. Its stated scope includes:

- Revocable sessions and hashed session/reset tokens.
- One-time password reset flow.
- Shared PostgreSQL-backed rate limiting.
- Migration-only production schema management and controlled production baseline scripts.
- Liveness/readiness separation.
- Tenant isolation for AI background job claims.
- Durable storage controls and deletion lifecycle hardening.
- Secure upload validation.
- Production security headers.
- AI prompt-injection trust-boundary work.
- CI workflow for branch verification.

## Review verdict

**Do not merge PR #724 while it remains draft.** The branch is directionally valuable, but it is large, operationally sensitive, and includes changes that can affect authentication, production migrations, storage deletion, upload acceptance, background job ownership, and deployment health checks. It should be treated as a release-candidate branch, not as a routine feature PR.

## Blocking findings before merge

1. **Preview deployment history is not clean.** The PR timeline includes an earlier Vercel deployment failure from the project deployment limit and a later successful preview deployment. Because this branch changes production migration behavior, health/readiness behavior, and storage policies, a single later deploy event is not enough; the final head commit needs a clean Vercel preview and a documented smoke test.

2. **Database baseline changes are high risk.** The branch includes multiple commits around controlled Prisma baselining and P3005 handling. Before merge, the reviewer should verify the exact production database target guard, confirm it cannot run against an unintended database, and confirm rollback steps are documented.

3. **Authentication changes need end-to-end verification.** Session revocation, hashed token storage, one-time reset handling, password reset email safety, and disabled bootstrap credential repair are all security-positive changes, but they can lock out users if partially misconfigured. Verify login, logout, reset request, reset consume, expired-token handling, and repeated-token handling on preview.

4. **Storage deletion changes need data-loss review.** The branch deliberately deletes underlying objects when records are deleted. This needs manual review against tender files and company documents to ensure object deletion is scoped to the authenticated owner and cannot delete shared or cross-tenant storage objects.

5. **Upload hardening may reject real tender files.** Signature, archive, quota, and active-content checks need fixture coverage for expected PDF, DOCX, XLSX, ZIP, and edge-case tender documents. The merge gate should include a representative upload smoke test, not just unit tests.

6. **AI job ownership changes need concurrency coverage.** Owner-scoped job claiming is important, but it should be checked under simultaneous users/jobs so jobs are neither stolen nor starved.

7. **PR remains marked draft with no reviews.** GitHub showed the PR as draft and with no reviews. It should not be merged until converted to ready-for-review and reviewed after the final head commit.

## Required checks before marking ready

- GitHub Actions for the final head commit must pass: install, Prisma validate/generate, migrations, typecheck, lint, tests, and production build.
- Vercel preview for the final head commit must be ready.
- Preview smoke test must cover:
  - login/logout;
  - forgot-password request without leaking reset links in logs/responses;
  - reset-password consume-once behavior;
  - upload of representative PDF/DOCX/XLSX/ZIP tender files;
  - tender file delete and company document delete with storage-object cleanup;
  - AI Analyze/job processing for two separate users or owner contexts;
  - `/api/health` liveness response;
  - restricted readiness endpoint behavior.
- Migration baseline script must be reviewed with production database guard evidence.
- Rollback plan must be written before merge.

## Suggested PR review comment

```md
Review verdict: do not merge yet while draft.

This PR is directionally strong and addresses important security/reliability gaps, but it touches authentication, production migration behavior, storage deletion, upload validation, background job tenancy, and health/readiness endpoints in one large branch. Please keep it draft until the final head commit has clean GitHub CI, a ready Vercel preview, documented database baseline guard verification, and an authenticated preview smoke test covering login/logout, one-time password reset, representative uploads, storage deletion, owner-scoped AI jobs, liveness, and restricted readiness.

Particular merge blockers to resolve/document:
1. Confirm the controlled Prisma baseline cannot run against an unintended database and document rollback.
2. Verify reset tokens are consume-once and never exposed in response/log output.
3. Verify object deletion is owner-scoped for tender files and company documents.
4. Verify hardened upload accepts real tender PDF/DOCX/XLSX/ZIP samples while rejecting active-content/mismatched signature cases.
5. Verify owner-scoped AI job claiming under multiple users/jobs.
6. Re-run final-head CI and Vercel preview after the latest merge from main.
```

## Non-blocking recommendations

- Split future security hardening into smaller PRs by blast radius: auth, migrations/deploy, storage, uploads, AI jobs, health/readiness, and headers.
- Keep a release checklist in the PR description and mark each item with the exact commit/run that satisfied it.
- Add a post-merge monitoring plan for reset failures, upload rejections, job queue failures, and storage delete errors.
