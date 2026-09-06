/**
 * Stand in for the scheduled automated caller, for the local drive harness.
 *
 * app/api/ai-jobs/run-next/route.ts re-arms retryable AI_ANALYZE jobs only for
 * an AUTOMATED caller — one presenting AI_JOBS_WORKER_SECRET or CRON_SECRET.
 * That is correct: an interactive session must not be able to trigger a
 * queue-wide retry sweep. In the deployed app the GitHub Actions cron and
 * /api/cron/ai-analyze-retry provide that caller.
 *
 * The local drive harness authenticates as a user, so on a run where a
 * provider returns a transient rate limit the analyze job is left FAILED with
 * a retry scheduled that nothing local ever fires, and the drive stops at
 * build-plan reporting an AI failure that the deployed app would have
 * recovered from by itself.
 *
 * This runs the EXACT sequence the automated branch of run-next runs — restore
 * provider health from the database, find jobs whose retry is due, re-arm them
 * — and nothing else. No gate is bypassed: rearmJobForRetry still refuses a
 * job whose tender content hash changed, still refuses a staged deterministic
 * draft, and the AI call itself must still succeed on the next drain.
 */
import { prismaReady } from "../lib/prisma";
import { restoreHealthFromDbBounded } from "../lib/ai-provider-health-db";
import { findJobsDueForRetry, rearmJobForRetry, isAnyProviderEligible } from "../lib/ai-analyze/retry-service";

await prismaReady;
const restore = await restoreHealthFromDbBounded(5_000);
if (restore.warning) console.log(`[rearm] provider health restore warning: ${restore.warning}`);
if (!isAnyProviderEligible()) {
  console.log("[rearm] no provider is currently eligible — nothing re-armed");
  process.exit(0);
}
const due = await findJobsDueForRetry(10);
if (due.length === 0) {
  console.log("[rearm] no job is due for retry");
  process.exit(0);
}
let rearmed = 0;
for (const job of due) {
  const ok = await rearmJobForRetry(job.jobId);
  console.log(`[rearm] ${job.jobId} (retryCount=${job.retryCount}) -> ${ok ? "QUEUED" : "refused"}`);
  if (ok) rearmed += 1;
}
console.log(`[rearm] re-armed ${rearmed}/${due.length}`);
