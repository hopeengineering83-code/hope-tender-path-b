# Runbook: Stuck AI Jobs (RUNNING forever)

## When to use

Use this runbook when AI jobs stay in `RUNNING` status indefinitely. The
Hope Tender Path app tracks long-running AI work in the `AiJob` table
(queued, started, completed, failed). A healthy job completes in seconds to
a couple of minutes. A job that has been `RUNNING` for more than the stuck
threshold (default ~10 minutes) is stuck — the worker likely crashed, the
function timed out, or the DB connection died mid-run.

Trigger this runbook when:
- A user reports an infinite spinner on AI Analyze or generation.
- `/api/admin/release-stuck-jobs` (GET preview) returns a non-zero
  `stuckCount`.
- The `AiJob` table has rows with `startedAt` older than 15 minutes and
  `status = 'RUNNING'`.

## Symptoms

- **Infinite spinner** on the tender detail page's AI Analyze panel or
  generation progress panel — the UI polls `/api/jobs/[jobId]` and the job
  never leaves `RUNNING`.
- `/api/admin/release-stuck-jobs` GET returns:
  ```json
  { "stuckCount": 3, "jobs": [ { "id": "...", "startedAt": "...",
      "stuckForMs": 9320000 } ] }
  ```
- The `ai-analyze-recovery-panel` shows a job that has been "in progress"
  longer than the user's patience.
- Vercel logs show `/api/ai-jobs/run-next` returning 200 with no job pulled
  (because the stuck job is already marked RUNNING and the worker refuses
  to double-pull).
- `/api/health` is otherwise healthy (DB up, providers up) — this is not a
  database outage, it is a job-state consistency problem.

## Immediate steps (first 5 minutes)

1. **List the stuck jobs** (admin only):
   ```bash
   curl -s https://YOUR_DEPLOYMENT_URL/api/admin/release-stuck-jobs \
     -H "Cookie: $ADMIN_COOKIE" | jq .
   ```
   Note `stuckCount`, the `jobType` of each, and how long each has been
   stuck (`stuckForMs`). One stuck job is an isolated incident; many stuck
   jobs of the same `jobType` is a systemic worker failure.

2. **Verify the worker is running.** The AI job worker is invoked via
   `/api/ai-jobs/run-next` — typically called by the cron route
   `/api/cron/*` or by the action that created the job. Check Vercel → Logs
   for recent invocations of `run-next`. If there are zero invocations in
   the last 5 minutes, the cron trigger may be misconfigured or the route
   is failing.

3. **Check the function timeout.** Vercel → Logs for the stuck job's
   `run-next` invocation — look for `FUNCTION_RUNTIME_LIMIT`. If the worker
   timed out mid-job, the job row is left in `RUNNING`. This is the most
   common cause; see `oom-timeout-storm.md` for mitigation.

4. **Check the DB connection.** A worker that lost its DB connection mid-run
   cannot update the job row to `FAILED`. Verify `/api/health` returns 200
   and that the AiJob table is reachable:
   ```bash
   psql "$DATABASE_URL" -c 'SELECT id, status, "startedAt" FROM "AiJob" ORDER BY "startedAt" DESC LIMIT 10;'
   ```

5. **Communicate** — if many users are affected, post to
   `/api/notifications`: "Some AI jobs are stuck. We are releasing them
   now; please retry your analysis in a few minutes."

## Recovery steps

1. **Release the stuck jobs** (admin only — this is the POST path):
   ```bash
   curl -X POST https://YOUR_DEPLOYMENT_URL/api/admin/release-stuck-jobs \
     -H "Cookie: $ADMIN_COOKIE" | jq .
   ```
   The endpoint marks every stuck job as `FAILED` with a clear
   `"auto-failed by stuck-job recovery"` tag. It is **idempotent** — a job
   that finished between detection and recovery is not clobbered.
   The action is audit-logged under `ADMIN_RELEASE_STUCK_JOBS`.

2. **Verify the release worked:**
   ```bash
   psql "$DATABASE_URL" -c \
     "SELECT status, count(*) FROM \"AiJob\" WHERE status='RUNNING' GROUP BY status;"
   ```
   Should return zero rows. Then re-list via the GET preview endpoint to
   confirm `stuckCount: 0`.

3. **Re-queue work for affected users.** Users whose jobs were just failed
   will see a recovery banner in the tender detail page's
   `ai-analyze-recovery-panel`. They can click "Re-run AI Analyze" to
   requeue. For generation jobs, the `tender-workflow-action-center` exposes
   a re-run button.

4. **If the worker is not running at all** (no `run-next` invocations in
   logs), manually kick it:
   ```bash
   curl -X POST https://YOUR_DEPLOYMENT_URL/api/ai-jobs/run-next \
     -H "Cookie: $ADMIN_COOKIE"
   ```
   Then investigate why the cron trigger stopped — check
   `/api/cron/*` route configuration in `vercel.json` and the Vercel cron
   settings page.

5. **Forward-fix the root cause.** Common causes and fixes:
   - **Function timeout (most common):** raise `maxDuration` for the worker
     route in `vercel.json`, or reduce per-job work (chunk smaller, see
     `oom-timeout-storm.md`).
   - **Worker crash with unhandled promise rejection:** add a `try/finally`
     that flips the job to `FAILED` on any error path. The
     `engine-stuck-heartbeat.test.ts` test guards this — verify it passes.
   - **DB connection lost mid-run:** the `prismaReady` guard in `lib/prisma`
     should reject the call; ensure the worker catches and fails the job.

## Verification

- `GET /api/admin/release-stuck-jobs` returns `stuckCount: 0`.
- `psql` query for `status='RUNNING'` older than 15 minutes returns zero
  rows for at least 15 minutes of observation.
- A fresh AI Analyze job reaches `COMPLETED` (or `FAILED` with a real error
  message) within the expected duration.
- The user-reported spinner has resolved; the tender detail page shows the
  recovery panel with a "Re-run" button or the completed result.
- Vercel logs show `run-next` invocations on the expected cadence.
- Audit log shows the `ADMIN_RELEASE_STUCK_JOBS` entry from the recovery
  step.

## Escalation

- **On-call engineer:** page if `stuckCount` keeps climbing after release
  (worker is fundamentally broken), or if the release endpoint itself
  returns 500.
- **Database team:** escalate if the `AiJob` table is unreadable or if
  `psql` queries time out — that is a database outage (see
  `database-outage.md`), not a stuck-job issue.
- **Vercel plan / `maxDuration`:** if the root cause is function timeout
  on legitimate workloads, follow `oom-timeout-storm.md` to raise limits or
  upgrade to Pro.
- **Post-mortem:** file within 48 hours covering the root cause, how many
  users were affected, the detection-to-release timeline, and the
  forward-fix (code change or config change) that prevents recurrence.
