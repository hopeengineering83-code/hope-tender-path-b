# Runbook: Database Outage (Neon Unreachable)

## When to use

Use this runbook when the Neon Postgres database backing the app is
unreachable. The app reads `DATABASE_URL` exclusively from environment
variables (no hardcoded connection strings) and depends on Neon for auth,
tenders, AI jobs, rate limiting, and persistence. When the database is down,
almost every page and API route returns 500.

Trigger this runbook when end users report 500 errors on login, dashboard,
or tender detail pages, or when you see `PrismaClientInitializationError` in
Vercel function logs.

## Symptoms

- All authenticated pages return 500 (the `requireUser` helper throws when
  the session lookup hits the DB).
- Dashboard returns 500 when trying to load tenders list.
- Vercel function logs show repeated `PrismaClientInitializationError`,
  `Can't reach database server`, or `connection terminated` errors.
- AI Analyze jobs hang on `AiJob` insert or never advance past `QUEUED`.
- Tender detail page returns 500 when loading requirements or analysis.
- `/api/admin/db-stats` returns 500 or times out.

## Immediate steps (first 5 minutes)

1. **Confirm the outage is database, not the whole deployment:**
   - Try accessing a non-database-dependent route (e.g., any public static page).
   - If public pages work but authenticated pages 500, database is likely down.
   - Check Vercel logs: Vercel → Project → Functions → Logs

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

5. **Communicate** — post a banner via in-app notification:
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

3. **If a single migration broke a critical table** — check the Vercel logs
   for which table failed to create. If a migration was rolled out that
   dropped a table, roll back the deploy (see `bad-deploy-rollback.md`) and
   re-apply the migration fix forward.

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
   **DO NOT run `npm run db:push`** — it would drop tables that exist in the
   DB but not `schema.prisma`. Use `prisma migrate deploy` only (the Vercel
   build runs this automatically).

5. **After the DB is reachable**, verify it works:
   ```bash
   # Test a simple authenticated action (requires valid session)
   curl -sS https://YOUR_DEPLOYMENT_URL/api/tenders \
     -H "Cookie: session=YOUR_SESSION_ID" | jq .
   ```
   Expect HTTP 200 with your tenders list.

## Verification

- Try to log in with a test account — login should succeed and redirect to
  dashboard.
- Dashboard loads the tenders list without 500 errors.
- Opening a tender detail page renders without 500.
- A new AI Analyze job reaches `RUNNING` and then completes (not stuck at
  `QUEUED`).
- No error messages appear in Vercel logs related to database connectivity.
- You can successfully query the database from your local machine.

## Escalation

- **On-call engineer:** page immediately if the database has been down for
  more than 10 minutes, or if there are signs of data loss.
- **Neon support:** open a ticket at https://console.neon.tech/support if the
  outage is on the Neon side (console unreachable, compute refuses to start,
  storage quota exhausted).
- **Backup restore decision:** must be authorized by the on-call lead; a
  restore loses all writes since the backup was taken.
- **Comms:** post recovery update and email users who submitted tickets
  during the outage.
- **Post-mortem:** file within 48 hours — root cause, downtime duration,
  data-loss assessment, prevention (e.g. enable Neon high-availability,
  schedule nightly backups).
