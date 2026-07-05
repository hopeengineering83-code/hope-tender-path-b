# Runbook: OOM / Timeout Storm (Vercel Functions)

## When to use

Use this runbook when Vercel serverless functions are repeatedly running out
of memory (OOM) or hitting the route's `maxDuration` timeout. The Hope Tender
Path app runs on Vercel Hobby by default with tight limits (1 GB memory,
10–60s function duration per route). An OOM/timeout storm typically surfaces
when several users upload large tender files or run AI Analyze concurrently.

Trigger this runbook when Vercel logs show a sustained burst of
`FUNCTION_RUNTIME_LIMIT` / `OUT_OF_MEMORY` errors, or when users report 504
Gateway Timeout on the dashboard or AI Analyze.

## Symptoms

- Vercel → Project → Functions logs show repeated
  `Task timed out after X seconds` or
  `Error: Runtime exited with error: signal: killed` (OOM-killer).
- End users see **HTTP 504** from `/api/tenders/upload-first`,
  `/api/tenders/[id]/engine`, or `/api/ai-jobs/*`.
- AI Analyze jobs stay in `RUNNING` then flip to `FAILED` with
  `FUNCTION_RUNTIME_LIMIT` in the error metadata.
- Vercel → Project → Usage shows a sharp spike in function invocations and
  "Edge function execution timeout" or "Function execution duration" alerts.
- The `/api/health` endpoint itself may start returning slow / 504 under
  memory pressure (it does a small DB probe).

## Immediate steps (first 5 minutes)

1. **Identify the storm** — Vercel dashboard → Project → Logs → filter by
   `Status: 5xx`. Note which routes are failing:
   - `/api/tenders/upload-first` → likely a huge tender file (PDF/DOCX > 25 MB
     extracted text).
   - `/api/tenders/[id]/engine` → likely seven-pass generation hitting
     `maxDuration`.
   - `/api/ai-jobs/run-next` → worker pulling too many jobs concurrently.

2. **Reduce concurrency** — temporarily raise the in-app concurrency guard
   by setting (in Vercel → Settings → Environment Variables):
   ```
   AI_JOB_MAX_CONCURRENCY=1
   AI_MAX_PROVIDER_ATTEMPTS=1
   ```
   Redeploy (empty commit). This stops the worker from pulling multiple
   long-running jobs at once.

3. **Check tender file sizes** — query the DB for the largest recent uploads:
   ```sql
   SELECT id, "originalName", "mimeType", octet_length("fileContent") AS bytes
   FROM "TenderFile"
   ORDER BY bytes DESC LIMIT 10;
   ```
   Any single file > 15 MB is a strong OOM suspect.

4. **If a specific user is the source** (e.g. they uploaded a 200-page PDF),
   ask them to pause; in extreme cases, mark the tender's files as inactive
   so other users' jobs are not blocked behind it.

5. **Communicate** — post to `/api/notifications`: "We are investigating
   elevated timeouts. Some long-running operations may fail; please retry
   in a few minutes."

## Recovery steps

1. **Reduce the size of the offending tender input.** If a tender file is
   exceptionally large, advise the user to split it, or pre-extract the text
   out-of-band and upload only the relevant excerpt. The `extract-text.ts`
   pipeline holds the extracted text in memory; smaller input = lower peak RSS.

2. **Lower AI Analyze chunk size** — set (Vercel env):
   ```
   AI_ANALYZE_CHUNK_TOKENS=4000
   ```
   This reduces the per-chunk memory footprint at the cost of more chunks.

3. **Re-run failed jobs** — after the storm subsides, list FAILED jobs and
   requeue them:
   ```bash
   # Admin only — requires ADMIN session cookie
   curl -s https://YOUR_DEPLOYMENT_URL/api/admin/release-stuck-jobs \
     -H "Cookie: $ADMIN_COOKIE" | jq .   # POST to release stuck ones
   ```
   Then let the worker pick them up naturally via `/api/ai-jobs/run-next`.

4. **Consider upgrading Vercel plan.** If OOM/timeout storms are recurring on
   legitimate workloads (not a single oversized file), upgrade to Vercel
   **Pro**:
   - Pro raises the function memory cap to 3 GB and max duration to 300s.
   - Configure the affected routes in `vercel.json` `functions` block with
     higher `maxDuration` and `memory` once on Pro.

5. **Forward-fix code** — if a specific route has a memory leak (e.g. holds
   the full tender text + extracted chunks + provider response in memory
   simultaneously), open a ticket to stream/chunk the work. The seven-pass
   generator and the chunked AI Analyze pipeline already exist to mitigate
   this — verify the route is actually using them.

## Verification

- Vercel → Logs shows no new `OUT_OF_MEMORY` or `FUNCTION_RUNTIME_LIMIT`
  entries for 15+ minutes.
- `/api/health` returns 200 consistently.
- A test AI Analyze on a moderate-sized tender (≤ 5 MB extracted text)
  completes within `maxDuration` and reaches `COMPLETED`.
- No new 504 responses from the dashboard or upload routes.
- Vercel → Usage shows function invocations / durations returning to
  baseline.

## Escalation

- **On-call engineer:** page if 5xx rate from Vercel exceeds 10% of requests
  for 5 minutes, or if `/api/health` itself starts 504ing.
- **Vercel support:** open a ticket at https://vercel.com/support if the
  platform itself is degraded (check https://www.vercel-status.com/ first).
- **Plan upgrade approval:** Pro plan spend needs manager sign-off; raise a
  purchase request before flipping the project to Pro if it is not already
  pre-approved.
- **Post-mortem:** file within 48 hours covering which route OOMed, the input
  size, the concurrency at the time, and the fix (env var change, code fix,
  or plan upgrade).
