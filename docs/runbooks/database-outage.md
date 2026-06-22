# Runbook: Database Outage (Neon Unreachable)

## When to use

Use this runbook when the Neon Postgres database backing the app is
unreachable. The app reads `DATABASE_URL` exclusively from environment
variables (no hardcoded connection strings) and depends on Neon for auth,
tenders, AI jobs, rate limiting, and persistence. When the database is down,
almost every page and API route returns 500.

Trigger this runbook when `/api/health` returns HTTP 503 with
`status: "degraded"`, or when end users report 500s on login, dashboard, or
tender detail pages.

## Symptoms

- `GET /api/health` returns **HTTP 503** with `ok: false`,
  `status: "degraded"`, and at least one entry in `tables` is `false`.
- All authenticated pages return 500 (the `requireUser` helper throws when
  the session lookup hits the DB).
- Vercel function logs show repeated `PrismaClientInitializationError`,
  `Can't reach database server`, or `connection terminated` errors.
- AI Analyze hangs on `AiJob` insert or never advances past `QUEUED`.
- Rate limiter logs `[rate-limit] Persistent limiter unavailable; request
  denied` and may switch to degraded in-memory mode if
  `RATE_LIMIT_ALLOW_DEGRADED=true`.
- `/api/admin/db-stats` returns 500 or times out.

## Immediate steps (first 5 minutes)

1. **Confirm the outage is database, not the whole deployment:**
   ```bash
   curl -sS -o /tmp/health.json -w "HTTP %{http_code}\n" \
     https://YOUR_DEPLOYMENT_URL/api/health
   cat /tmp/health.json | jq .
   ```
   A 503 with `tables: { AiJob: false, RateLimitBucket: false, ... }` is a
   database outage. A 200 means the DB is reachable and you should look
   elsewhere.

2. **Check Neon status:**
   - Neon status page: https://neon.tech/status
   - Neon console: https://console.neon.tech — confirm the project is
     reachable, the compute endpoint is not suspended, and there are no
     active incidents.
   - If the compute is suspended (free-tier auto-suspend after 5 min
     inactivity), the first request should wake it within ~3 seconds; if
     wake-up fails, the project may be quota-exhausted.

3. **Verify `DATABASE_URL` in Vercel** — Vercel → Project → Settings →
   Environment Variables. Confirm:
   - The value still ends in `-pooler` (pooled connection string, required
     for serverless).
   - It has not been rotated out from under the deployment.
   - The Vercel deployment was re-deployed after any env change.

4. **Test connectivity from your own machine** (read-only):
   ```bash
   # Replace $DATABASE_URL with the value from Vercel env vars (do not commit it)
   psql "$DATABASE_URL" -c "SELECT 1 AS alive;" -c "SELECT now();"
   ```
   If this fails with `connection refused` / `timeout`, the issue is on the
   Neon side. If it succeeds, the issue is the Vercel→Neon network path or
   the env var.

5. **Communicate** — post a banner via `/api/notifications` (ADMIN only):
   "We are investigating a database connectivity issue. The app may be slow
   or unavailable. No data has been lost."

## Recovery steps

1. **If Neon compute is suspended and won't wake** — in the Neon console,
   click "Restart" on the compute endpoint. If the project is over quota
   (compute hours or storage), upgrade the Neon plan or wait until the
   quota window resets.

2. **If the connection string changed** (Neon project switched, password
   rotated) — update `DATABASE_URL` in Vercel for Production / Preview /
   Development, then redeploy. Follow `docs/runbooks/neon-switch.md` for a
   full project switch.

3. **If a single migration broke a critical table** — check
   `/api/health` `tables` map for which table is missing. If a migration was
   rolled out that dropped a table, roll back the deploy (see
   `bad-deploy-rollback.md`) and re-apply the migration fix forward.

4. **Restore from backup if data was lost:**
   ```bash
   # Generate a fresh backup FIRST if the DB is still partially reachable
   pg_dump --format=custom --no-owner --no-privileges \
     --file="hope-tender-recovery-$(date +%Y%m%d-%H%M%S).dump" \
     "$DATABASE_URL"

   # Restore into a fresh Neon project (see neon-switch.md for full steps)
   pg_restore --no-owner --no-privileges \
     -d "$NEW_DATABASE_URL" hope-tender-YYYYMMDD-HHMMSS.dump
   ```
   **DO NOT run `npm run db:push`** — it would drop `SubmissionPlanState` and
   other tables that exist in the DB but not `schema.prisma`. Use
   `prisma migrate deploy` only (the Vercel build runs this automatically).

5. **After the DB is reachable**, force the app to re-probe:
   ```bash
   curl -sS https://YOUR_DEPLOYMENT_URL/api/health | jq .
   ```
   Expect HTTP 200 with `ok: true`, `status: "healthy"`, and every table
   `true`.

## Verification

- `/api/health` returns **HTTP 200**, `ok: true`, `status: "healthy"`, and
  all five critical tables (`RateLimitBucket`, `PasswordResetToken`,
  `SubmissionPlanState`, `AiAnalyzeChunk`, `AiJob`) are `true`.
- Login works end-to-end for at least one ADMIN and one USER account.
- Dashboard tenders list loads; opening a tender detail page renders without
  500.
- A new AI Analyze job reaches `RUNNING` and then `COMPLETED` (not stuck at
  `QUEUED`).
- `/api/admin/db-stats` returns 200 with sensible row counts.
- Rate limiter logs no longer show `Persistent limiter unavailable`.

## Escalation

- **On-call engineer:** page immediately if `/api/health` has been 503 for
  more than 10 minutes, or if there is any sign of data loss.
- **Neon support:** open a ticket at https://console.neon.tech/support if the
  outage is on the Neon side (console unreachable, compute refuses to
  start, storage quota exhausted).
- **Backup restore decision:** must be authorized by the on-call lead; a
  restore loses all writes since the backup was taken.
- **Comms:** post recovery update to `/api/notifications` and email users
  who submitted tickets during the outage.
- **Post-mortem:** file within 48 hours — root cause, downtime duration,
  data-loss assessment, prevention (e.g. enable Neon high-availability,
  schedule nightly backups, add alerting on `/api/health` 503).
