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

## Immediate steps (first 5 minutes)

1. **Identify the storm** — Vercel dashboard → Project → Logs → filter by
   `Status: 5xx`. Note which routes are failing:
   - `/api/tenders/upload-first` → likely a huge tender file (PDF/DOCX > 25 MB
     extracted text).
   - `/api/tenders/[id]/engine` → likely seven-pass generation hitting
     `maxDuration`.
   - `/api/ai-jobs/run-next` → worker pulling too many jobs concurrently.

2. **Check tender file sizes** — query the DB for the largest recent uploads:
   ```sql
   SELECT id, "originalFileName", "mimeType", 
          octet_length("extractedText") AS extracted_bytes,
          octet_length("fileContent") AS file_bytes
   FROM "TenderFile"
   ORDER BY file_bytes DESC LIMIT 10;
   ```
   Any single file > 15 MB is a strong OOM suspect.

3. **If a specific user is the source** (e.g. they uploaded a 200-page PDF),
   ask them to pause; in extreme cases, mark the tender's files as inactive
   so other users' jobs are not blocked behind it.

4. **Communicate** — notify users:
   "We are investigating elevated timeouts. Some long-running operations may
   fail; please retry in a few minutes."

## Recovery steps

1. **Reduce the size of the offending tender input.** If a tender file is
   exceptionally large, advise the user to split it, or pre-extract the text
   out-of-band and upload only the relevant excerpt. The text extraction
   pipeline holds the extracted text in memory; smaller input = lower peak RSS.

2. **Pause AI Analyze jobs temporarily** — if OOM is persistent:
   - Stop the worker: Temporarily pause `/api/ai-jobs/run-next` invocations
     by removing it from the cron jobs in `vercel.json` (or disabling the
     scheduled function).
   - Wait 5–10 minutes for the storm to subside.
   - Resume: re-enable `/api/ai-jobs/run-next`.

3. **Re-run failed jobs** — after the storm subsides, list FAILED jobs and
   investigate:
   ```sql
   SELECT id, "jobType", "tenderId", "errorMessage", "createdAt"
   FROM "AiJob"
   WHERE status = 'FAILED'
   ORDER BY "createdAt" DESC
   LIMIT 20;
   ```
   Then recreate them (ADMIN only via database or internal tool).

4. **Consider upgrading Vercel plan.** If OOM/timeout storms are recurring on
   legitimate workloads (not a single oversized file), upgrade to Vercel
   **Pro**:
   - Pro raises the function memory cap to 3 GB and max duration to 300s.
   - After upgrading, update route timeout settings via `vercel.json` or
     Vercel dashboard.

5. **Forward-fix code** — if a specific route has a memory leak (e.g. holds
   the full tender text + extracted chunks + provider response in memory
   simultaneously), open a ticket to stream/chunk the work. The chunked AI
   Analyze pipeline already exists to mitigate this — verify the route is
   actually using it.

## Verification

- Vercel → Logs shows no new `OUT_OF_MEMORY` or `FUNCTION_RUNTIME_LIMIT`
  entries for 15+ minutes.
- A test AI Analyze on a moderate-sized tender (≤ 5 MB extracted text)
  completes without timing out and reaches `COMPLETED`.
- No new 504 responses from the dashboard or upload routes.
- Vercel → Usage shows function invocations / durations returning to
  baseline.
- Users report that the app is responsive again.

## Escalation

- **On-call engineer:** page if 5xx rate from Vercel exceeds 10% of requests
  for 5 minutes, or if the app becomes unusable.
- **Vercel support:** open a ticket at https://vercel.com/support if the
  platform itself is degraded (check https://www.vercel-status.com/ first).
- **Plan upgrade approval:** Pro plan spend needs manager sign-off; raise a
  purchase request before flipping the project to Pro if it is not already
  pre-approved.
- **Post-mortem:** file within 48 hours covering which route OOMed, the input
  size, the concurrency at the time, and the fix (pausing jobs, code fix, or
  plan upgrade).
