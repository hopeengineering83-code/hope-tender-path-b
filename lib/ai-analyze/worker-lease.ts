/**
 * Worker Lease Management
 *
 * Coordinates distributed job claiming between workers using lease-based claiming.
 *
 * Lease Model:
 * - Worker claims a QUEUED or stale RUNNING job by setting leaseOwner + leaseExpiresAt
 * - Worker must heartbeat (renew lease) before expiry
 * - If lease expires, job becomes reclaimable (another worker can claim it)
 * - stale RUNNING jobs (no heartbeat for 5+ min) are reclaimed
 * - nextAttemptAt controls retry scheduling after failure
 *
 * Guarantees:
 * - Exactly one worker holds lease at any time (atomic SQL FOR UPDATE)
 * - Stale jobs eventually reclaimed (leaseExpiresAt check)
 * - No silent failures (if lease expires, worker detects and stops)
 * - Cold restart: unpromoted SUCCEEDED jobs are promoted on recovery
 */

import type { PrismaClient } from "@prisma/client";

export interface LeaseConfig {
  leaseDurationMs?: number; // Default: 5 minutes = 300,000 ms
  leaseOwnerWorkerId: string; // Worker ID (pod name, hostname, etc.)
}

export interface LeaseResult {
  jobId: string;
  claimed: boolean;
  leaseExpiresAt: Date;
}

export interface HeartbeatResult {
  jobId: string;
  renewed: boolean;
  newLeaseExpiresAt: Date;
  reason?: string;
}

export interface StaleLeaseCheckResult {
  staleJobs: string[]; // Job IDs with expired leases
  reclaimedCount: number;
}

const DEFAULT_LEASE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Claim a QUEUED job with a lease.
 *
 * Atomic operation: uses FOR UPDATE SKIP LOCKED to claim exactly one job.
 * Sets leaseOwner and leaseExpiresAt on successful claim.
 *
 * Returns the claimed job or undefined if no jobs available.
 */
export async function claimJobWithLease(
  config: LeaseConfig,
  prismaClient: PrismaClient,
): Promise<LeaseResult | null> {
  const now = new Date();
  const leaseDuration = config.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
  const leaseExpiresAt = new Date(now.getTime() + leaseDuration);

  try {
    // Use raw SQL for atomic FOR UPDATE SKIP LOCKED + lease setting
    const result = await prismaClient.$queryRaw<
      Array<{ id: string }>
    >`
      UPDATE "AiJob"
      SET
        "leaseOwner" = ${config.leaseOwnerWorkerId},
        "leaseExpiresAt" = ${leaseExpiresAt},
        "status" = 'RUNNING',
        "startedAt" = ${now},
        "updatedAt" = ${now}
      WHERE "id" IN (
        SELECT "id"
        FROM "AiJob"
        WHERE (
          ("status" = 'QUEUED')
          OR
          ("status" = 'RUNNING' AND "leaseExpiresAt" < ${now})
        )
        AND "jobType" = 'AI_ANALYZE'
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id"
    `;

    if (result.length === 0) {
      return null;
    }

    return {
      jobId: result[0].id,
      claimed: true,
      leaseExpiresAt,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to claim job with lease: ${message}`);
  }
}

/**
 * Renew (heartbeat) a job lease.
 *
 * Worker calls this periodically to extend the lease.
 * Only the current lease owner can renew.
 */
export async function renewJobLease(
  jobId: string,
  leaseOwner: string,
  prismaClient: PrismaClient,
  leaseDurationMs?: number,
): Promise<HeartbeatResult | null> {
  const now = new Date();
  const duration = leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
  const newLeaseExpiresAt = new Date(now.getTime() + duration);

  const job = await prismaClient.aiJob.updateMany({
    where: {
      id: jobId,
      leaseOwner, // Only renew if worker owns the lease
      status: "RUNNING",
    },
    data: {
      leaseExpiresAt: newLeaseExpiresAt,
      updatedAt: now,
    },
  });

  if (job.count === 0) {
    return null; // Job not found or lease ownership mismatch
  }

  return {
    jobId,
    renewed: true,
    newLeaseExpiresAt,
  };
}

/**
 * Check for and reclaim stale jobs.
 *
 * Jobs with expired leases become available for claiming by other workers.
 * This is called periodically or on worker startup.
 *
 * Returns stale job IDs that are now reclaimable.
 */
export async function findAndReclaimStaleLeases(
  prismaClient: PrismaClient,
): Promise<StaleLeaseCheckResult> {
  const now = new Date();

  // Find all jobs with expired leases
  const staleJobs = await prismaClient.aiJob.findMany({
    where: {
      status: "RUNNING",
      leaseExpiresAt: {
        lt: now, // leaseExpiresAt in the past
      },
    },
    select: {
      id: true,
      leaseOwner: true,
      leaseExpiresAt: true,
    },
  });

  if (staleJobs.length === 0) {
    return {
      staleJobs: [],
      reclaimedCount: 0,
    };
  }

  // Reclaim stale jobs by clearing lease and resetting to QUEUED/next attempt
  const staleIds = staleJobs.map((j) => j.id);

  await prismaClient.aiJob.updateMany({
    where: {
      id: {
        in: staleIds,
      },
    },
    data: {
      leaseOwner: null,
      leaseExpiresAt: null,
      nextAttemptAt: now, // Retry immediately
      updatedAt: now,
    },
  });

  return {
    staleJobs: staleIds,
    reclaimedCount: staleIds.length,
  };
}

/**
 * Cold restart recovery: promote unpromoted SUCCEEDED jobs.
 *
 * On worker restart, find any SUCCEEDED jobs that weren't yet promoted
 * to canonical. Promote them to ensure analysis results are available.
 *
 * Returns count of promoted jobs.
 */
export async function coldRestartPromoteSucceededJobs(
  prismaClient: PrismaClient,
): Promise<number> {
  // Find SUCCEEDED jobs not yet promoted
  const unpromotedJobs = await prismaClient.aiJob.findMany({
    where: {
      status: "SUCCEEDED",
      promotedAt: null,
      jobType: "AI_ANALYZE",
    },
    select: {
      id: true,
    },
  });

  if (unpromotedJobs.length === 0) {
    return 0;
  }

  const now = new Date();
  const ids = unpromotedJobs.map((j) => j.id);

  // Promote all in single batch update
  await prismaClient.aiJob.updateMany({
    where: {
      id: {
        in: ids,
      },
    },
    data: {
      promotedAt: now,
      promotedBy: "cold-restart",
      updatedAt: now,
    },
  });

  return ids.length;
}

/**
 * Schedule next attempt for a job after failure.
 *
 * Sets nextAttemptAt to a time in the future based on retry backoff.
 * Worker can query jobs with nextAttemptAt <= now to find ready jobs.
 */
export async function scheduleNextAttempt(
  jobId: string,
  delayMs: number, // How long to wait (e.g., 60000 for 1 minute)
  prismaClient: PrismaClient,
): Promise<void> {
  const now = new Date();
  const nextAttempt = new Date(now.getTime() + delayMs);

  await prismaClient.aiJob.update({
    where: { id: jobId },
    data: {
      nextAttemptAt: nextAttempt,
      updatedAt: now,
    },
  });
}

/**
 * Get all jobs ready for retry.
 *
 * Returns jobs where nextAttemptAt <= now.
 */
export async function getJobsReadyForRetry(
  prismaClient: PrismaClient,
): Promise<string[]> {
  const now = new Date();

  const readyJobs = await prismaClient.aiJob.findMany({
    where: {
      nextAttemptAt: {
        lte: now,
      },
      status: {
        in: ["QUEUED", "FAILED"], // Ready to retry
      },
    },
    select: {
      id: true,
    },
  });

  return readyJobs.map((j) => j.id);
}

/**
 * Detect lease loss.
 *
 * Worker calls this to verify it still owns the lease.
 * If lease is no longer held, returns false (another worker claimed it).
 */
export async function stillOwnsLease(
  jobId: string,
  leaseOwner: string,
  prismaClient: PrismaClient,
): Promise<boolean> {
  const job = await prismaClient.aiJob.findUnique({
    where: { id: jobId },
    select: {
      leaseOwner: true,
      leaseExpiresAt: true,
    },
  });

  if (!job) {
    return false; // Job deleted
  }

  if (job.leaseOwner !== leaseOwner) {
    return false; // Another worker claimed it
  }

  const now = new Date();
  if (job.leaseExpiresAt && job.leaseExpiresAt <= now) {
    return false; // Lease expired
  }

  return true;
}
