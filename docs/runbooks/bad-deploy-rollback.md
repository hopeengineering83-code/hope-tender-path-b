# Runbook: Bad Deploy Rollback

## When to use

Use this runbook when a production deployment is broken — errors after
deploy, broken UI, mass 500s, or a critical user flow regresses. Vercel
keeps every deployment around and supports **instant rollback** to the
previous good deployment, which is almost always faster than forward-fixing.

Trigger this runbook when:
- `/api/health` flips from 200 to 503 within minutes of a deploy.
- Vercel → Deployments shows the latest deployment with `Error` or `Building`
  status while the previous one was `Ready`.
- The error rate in Vercel logs jumps immediately after a deploy.
- A user reports a previously-working page is broken.

## Symptoms

- The Vercel "Production Deployment" tab shows a new deployment that
  immediately started erroring.
- `/api/health` returns 503, or returns 200 but `release` (commit SHA) is
  the new broken commit.
- UI shows `app/error.tsx` (the Next.js error boundary) or a blank page on
  load — typically a runtime error in a client component or a missing
  export.
- API routes that worked yesterday now return 500 with stack traces
  pointing at recently-merged code.
- Vercel function logs show a new error pattern starting at the deploy
  timestamp.

## Immediate steps (first 5 minutes)

1. **Confirm the bad deploy is the cause.** Check Vercel → Deployments:
   - Note the timestamp of the most recent "Ready" deployment.
   - Note the timestamp of the current (broken) deployment.
   - Confirm the error rate jumped at the boundary.

2. **Identify the good previous deployment.** In Vercel → Deployments, find
   the most recent deployment with `Ready` status and a green checkmark.
   Copy its deployment URL (`https://hope-tender-path-b-abc123.vercel.app`)
   and verify `/api/health` returns 200 there:
   ```bash
   curl -sS -o /tmp/prev.json -w "HTTP %{http_code}\n" \
     https://hope-tender-path-b-abc123.vercel.app/api/health
   ```

3. **Instant rollback** — Vercel → Deployments → click the three-dot menu on
   the last-known-good deployment → "Promote to Production". This swaps the
   production alias atomically; no rebuild needed.
   - Alternatively, via Vercel CLI:
     ```bash
     npx vercel promote <deployment-url-or-id> --prod
     ```
   - The rollback takes effect within seconds.

4. **Verify the rollback** — hit the production URL:
   ```bash
   curl -sS https://YOUR_PRODUCTION_URL/api/health | jq .
   ```
   The `release` field should now be the previous commit SHA, and `ok`
   should be `true`.

5. **Communicate** — post to `/api/notifications`: "We rolled back the
   latest deploy due to a regression. The app is healthy again on the
   previous version. Investigating the cause."

## Recovery steps

1. **Identify the bad commit.** Compare the SHA of the broken deployment
   against the previous-good deployment:
   ```bash
   # In the repo
   git log --oneline <good-sha>..<bad-sha>
   ```
   This lists every commit that landed in the broken deploy.

2. **Inspect the diff for obvious regressions:**
   ```bash
   git diff <good-sha>..<bad-sha> -- app/ lib/ middleware.ts
   ```
   Look for: removed exports, changed route handlers, schema migrations that
   may not have applied cleanly, env var additions that are not yet set in
   Vercel.

3. **Check whether a missing env var is the cause** — if the deploy added
   code that reads a new env var (e.g. a new `AI_ANALYZE_CHUNK_TOKENS`) and
   it was not set in Vercel, set it now and redeploy rather than reverting.

4. **Forward-fix or revert:**
   - **Forward-fix** (preferred for small, well-understood bugs): branch off
     the bad commit, fix, PR, merge, redeploy.
     ```bash
     git checkout -b fix/<short-description> <bad-sha>
     # edit, test, commit
     git push -u origin fix/<short-description>
     # open PR
     ```
   - **Revert** (for large or unclear breakages): create a revert commit and
     PR so the history is explicit.
     ```bash
     git checkout main
     git pull
     git revert -m 1 <merge-commit-sha>   # for merge commits
     # or
     git revert <bad-commit-sha>          # for direct commits
     git push
     ```

5. **Do NOT just re-merge the bad commit.** If you reverted, do not re-merge
   until the underlying bug is fixed on a fresh branch and passes CI,
   including the regression tests that should have caught it.

6. **Add a regression test** — if the bug slipped through CI, add a test in
   `tests/` that would have failed on the bad commit. The repo's convention
   is one focused `.test.ts` file per regression.

## Verification

- `/api/health` returns 200 with `ok: true` and the `release` SHA matches
  the rollback target (or the new forward-fix deploy).
- The user-reported broken flow now works (reproduce the original report
  and confirm it is fixed).
- Vercel → Logs shows the error rate back to baseline for at least 10
  minutes.
- Vercel → Deployments shows the rollback / forward-fix deployment as the
  current Production deployment.
- CI is green on the forward-fix branch before merge.

## Escalation

- **On-call engineer:** page if the rollback itself fails (e.g. the
  previous deployment is also broken, or Vercel promotion errors out).
- **Vercel support:** open a ticket at https://vercel.com/support if the
  "Promote to Production" action is not switching the alias — check
  https://www.vercel-status.com/ first.
- **Database migration safety:** if the bad deploy ran a Prisma migration
  (via `migrate-deploy-safe.mjs` in the build), the rollback does NOT
  un-apply the migration. Verify forward-compatibility — additive migrations
  (all in this repo) are safe; if a destructive migration landed, follow
  `database-outage.md` to restore from backup.
- **Post-mortem:** file within 24 hours covering what the deploy changed,
  how the regression escaped CI, rollback timeline, and the regression test
  added.
