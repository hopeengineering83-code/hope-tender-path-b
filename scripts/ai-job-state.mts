/**
 * Print the AiJob rows for one tender, newest first.
 *
 * A diagnostic companion to pipeline-drive.mjs and pipeline-rearm-retries.mts.
 * When a drive stops with ANALYSIS_NOT_READY or CURRENT_ANALYSIS_REQUIRED, the
 * question is always the same — did the job run and fail, or was it never given
 * a chance? — and the answer is one query the harness could not otherwise show.
 *
 * Usage: TENDER_ID=<uuid> npx tsx scripts/ai-job-state.mts
 * Development/diagnostic tooling only; nothing here runs in the app.
 */
import { prisma } from "../lib/prisma";

const tenderId = process.env.TENDER_ID;
if (!tenderId) throw new Error("TENDER_ID required");

const jobs = await prisma.aiJob.findMany({
  where: { tenderId },
  select: { jobType: true, status: true, retries: true, errorMessage: true, updatedAt: true },
  orderBy: { updatedAt: "desc" },
  take: Number(process.env.LIMIT ?? 8),
});

for (const job of jobs) {
  const detail = String(job.errorMessage ?? "").slice(0, 120);
  console.log(`${job.updatedAt.toISOString()} ${job.jobType} ${job.status} retries=${job.retries}${detail ? ` ${detail}` : ""}`);
}

const health = await prisma.providerHealthSnapshot.findMany({
  select: { provider: true, cooldownUntil: true, consecutiveFailures: true, lastSuccessAt: true, lastFailureAt: true },
});
console.log("\nprovider health:");
for (const row of health) console.log(" ", JSON.stringify(row));
console.log("now:", new Date().toISOString());

await prisma.$disconnect();
