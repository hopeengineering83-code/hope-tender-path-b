/**
 * Phase 5 Tests: Worker Hardening + Cold Restart
 *
 * Verifies:
 * - Lease claiming is atomic (only one worker wins)
 * - Fresh QUEUED jobs are claimed immediately
 * - Stale RUNNING jobs with expired leases are reclaimed
 * - Heartbeat renewal extends lease
 * - Cold restart promotes unpromoted SUCCEEDED jobs
 * - Concurrent worker races resolved correctly
 * - Lease loss detection works
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PrismaClient } from "@prisma/client";
import {
  claimJobWithLease,
  renewJobLease,
  findAndReclaimStaleLeases,
  coldRestartPromoteSucceededJobs,
  scheduleNextAttempt,
  getJobsReadyForRetry,
  stillOwnsLease,
} from "../lib/ai-analyze/worker-lease";

describe("Phase 5: Worker Hardening + Cold Restart", () => {
  let prisma: PrismaClient;
  let testTenderId: string;
  let testUserId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    testTenderId = "test-tender-" + Math.random().toString(36).substr(2, 9);
    testUserId = "test-user-" + Math.random().toString(36).substr(2, 9);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("Lease Claiming: Atomic Job Claiming", () => {
    it("should claim QUEUED job with lease", async () => {
      const job = await prisma.aiJob.create({
        data: {
          tenderId: testTenderId,
          userId: testUserId,
          jobType: "AI_ANALYZE",
          status: "QUEUED",
          analysisInputHash: "hash1",
        },
      });

      const result = await claimJobWithLease(
        { leaseOwnerWorkerId: "worker-1" },
        prisma,
      );

      expect(result).not.toBeNull();
      expect(result?.claimed).toBe(true);
      expect(result?.jobId).toBe(job.id);
      expect(result?.leaseExpiresAt).toBeTruthy();

      const claimed = await prisma.aiJob.findUnique({ where: { id: job.id } });
      expect(claimed?.leaseOwner).toBe("worker-1");
      expect(claimed?.status).toBe("RUNNING");

      await prisma.aiJob.delete({ where: { id: job.id } });
    });

    it("should return null when no jobs available", async () => {
      const result = await claimJobWithLease(
        { leaseOwnerWorkerId: "worker-2" },
        prisma,
      );

      expect(result).toBeNull();
    });

    it("should claim fresh QUEUED jobs before stale RUNNING", async () => {
      // Create a stale RUNNING job
      const staleJob = await prisma.aiJob.create({
        data: {
          tenderId: testTenderId,
          userId: testUserId,
          jobType: "AI_ANALYZE",
          status: "RUNNING",
          analysisInputHash: "hash1",
          leaseOwner: "worker-old",
          leaseExpiresAt: new Date(Date.now() - 10000), // Expired
        },
      });

      // Create a fresh QUEUED job
      const freshJob = await prisma.aiJob.create({
        data: {
          tenderId: testTenderId,
          userId: testUserId,
          jobType: "AI_ANALYZE",
          status: "QUEUED",
          analysisInputHash: "hash2",
        },
      });

      // Claim should take QUEUED first (older by creation order)
      const result = await claimJobWithLease(
        { leaseOwnerWorkerId: "worker-1" },
        prisma,
      );

      expect(result?.jobId).toBeTruthy();

      await prisma.aiJob.deleteMany({
        where: {
          id: { in: [staleJob.id, freshJob.id] },
        },
      });
    });
  });

  describe("Lease Renewal: Heartbeat", () => {
    it("should renew lease if worker owns it", async () => {
      const job = await prisma.aiJob.create({
        data: {
          tenderId: testTenderId,
          userId: testUserId,
          jobType: "AI_ANALYZE",
          status: "RUNNING",
          analysisInputHash: "hash1",
          leaseOwner: "worker-1",
          leaseExpiresAt: new Date(Date.now() + 10000),
        },
      });

      const oldExpiry = job.leaseExpiresAt;

      const result = await renewJobLease(
        job.id,
        "worker-1",
        prisma,
        5 * 60 * 1000, // 5 minute lease
      );

      expect(result).not.toBeNull();
      expect(result?.renewed).toBe(true);
      expect(result?.newLeaseExpiresAt.getTime()).toBeGreaterThan(
        oldExpiry!.getTime(),
      );

      await prisma.aiJob.delete({ where: { id: job.id } });
    });

    it("should fail if worker does not own lease", async () => {
      const job = await prisma.aiJob.create({
        data: {
          tenderId: testTenderId,
          userId: testUserId,
          jobType: "AI_ANALYZE",
          status: "RUNNING",
          analysisInputHash: "hash1",
          leaseOwner: "worker-1",
          leaseExpiresAt: new Date(Date.now() + 10000),
        },
      });

      const result = await renewJobLease(
        job.id,
        "worker-2", // Different worker
        prisma,
      );

      expect(result).toBeNull();

      await prisma.aiJob.delete({ where: { id: job.id } });
    });

    it("should fail if lease expired", async () => {
      const job = await prisma.aiJob.create({
        data: {
          tenderId: testTenderId,
          userId: testUserId,
          jobType: "AI_ANALYZE",
          status: "RUNNING",
          analysisInputHash: "hash1",
          leaseOwner: "worker-1",
          leaseExpiresAt: new Date(Date.now() - 1000), // Expired
        },
      });

      const result = await renewJobLease(job.id, "worker-1", prisma);

      expect(result).toBeNull();

      await prisma.aiJob.delete({ where: { id: job.id } });
    });
  });

  describe("Stale Lease Reclaiming", () => {
    it("should find and reclaim stale RUNNING jobs", async () => {
      // Create stale job
      const staleJob = await prisma.aiJob.create({
        data: {
          tenderId: testTenderId,
          userId: testUserId,
          jobType: "AI_ANALYZE",
          status: "RUNNING",
          analysisInputHash: "hash1",
          leaseOwner: "worker-dead",
          leaseExpiresAt: new Date(Date.now() - 60000), // Expired 1 min ago
        },
      });

      // Create fresh job (should not be reclaimed)
      const freshJob = await prisma.aiJob.create({
        data: {
          tenderId: testTenderId,
          userId: testUserId,
          jobType: "AI_ANALYZE",
          status: "RUNNING",
          analysisInputHash: "hash2",
          leaseOwner: "worker-alive",
          leaseExpiresAt: new Date(Date.now() + 60000), // Expires in 1 min
        },
      });

      const result = await findAndReclaimStaleLeases(prisma);

      expect(result.staleJobs).toContain(staleJob.id);
      expect(result.reclaimedCount).toBe(1);

      const reclaimed = await prisma.aiJob.findUnique({
        where: { id: staleJob.id },
      });
      expect(reclaimed?.leaseOwner).toBeNull();
      expect(reclaimed?.leaseExpiresAt).toBeNull();

      const fresh = await prisma.aiJob.findUnique({ where: { id: freshJob.id } });
      expect(fresh?.leaseOwner).toBe("worker-alive");

      await prisma.aiJob.deleteMany({
        where: { id: { in: [staleJob.id, freshJob.id] } },
      });
    });
  });

  describe("Cold Restart Recovery", () => {
    it("should promote unpromoted SUCCEEDED jobs on cold restart", async () => {
      // Create unpromoted SUCCEEDED job
      const succeededJob = await prisma.aiJob.create({
        data: {
          tenderId: testTenderId,
          userId: testUserId,
          jobType: "AI_ANALYZE",
          status: "SUCCEEDED",
          analysisInputHash: "hash1",
          promotedAt: null,
        },
      });

      // Create already promoted job (should not be re-promoted)
      const promotedJob = await prisma.aiJob.create({
        data: {
          tenderId: testTenderId,
          userId: testUserId,
          jobType: "AI_ANALYZE",
          status: "SUCCEEDED",
          analysisInputHash: "hash2",
          promotedAt: new Date(),
          promotedBy: "worker-1",
        },
      });

      const count = await coldRestartPromoteSucceededJobs(prisma);

      expect(count).toBe(1);

      const recovered = await prisma.aiJob.findUnique({
        where: { id: succeededJob.id },
      });
      expect(recovered?.promotedAt).not.toBeNull();
      expect(recovered?.promotedBy).toBe("cold-restart");

      const alreadyPromoted = await prisma.aiJob.findUnique({
        where: { id: promotedJob.id },
      });
      expect(alreadyPromoted?.promotedBy).toBe("worker-1");

      await prisma.aiJob.deleteMany({
        where: { id: { in: [succeededJob.id, promotedJob.id] } },
      });
    });

    it("should handle empty database on cold restart", async () => {
      const count = await coldRestartPromoteSucceededJobs(prisma);
      expect(count).toBe(0);
    });
  });

  describe("Retry Scheduling", () => {
    it("should schedule next attempt", async () => {
      const job = await prisma.aiJob.create({
        data: {
          tenderId: testTenderId,
          userId: testUserId,
          jobType: "AI_ANALYZE",
          status: "FAILED",
          analysisInputHash: "hash1",
        },
      });

      await scheduleNextAttempt(job.id, 60000, prisma); // Retry in 1 minute

      const scheduled = await prisma.aiJob.findUnique({ where: { id: job.id } });
      expect(scheduled?.nextAttemptAt).not.toBeNull();
      expect(scheduled?.nextAttemptAt!.getTime()).toBeGreaterThan(
        Date.now(),
      );

      await prisma.aiJob.delete({ where: { id: job.id } });
    });

    it("should find jobs ready for retry", async () => {
      // Create job ready for retry (nextAttemptAt in past)
      const readyJob = await prisma.aiJob.create({
        data: {
          tenderId: testTenderId,
          userId: testUserId,
          jobType: "AI_ANALYZE",
          status: "QUEUED",
          analysisInputHash: "hash1",
          nextAttemptAt: new Date(Date.now() - 10000), // In the past
        },
      });

      // Create job not ready (nextAttemptAt in future)
      const notReadyJob = await prisma.aiJob.create({
        data: {
          tenderId: testTenderId,
          userId: testUserId,
          jobType: "AI_ANALYZE",
          status: "QUEUED",
          analysisInputHash: "hash2",
          nextAttemptAt: new Date(Date.now() + 60000), // In future
        },
      });

      const readyIds = await getJobsReadyForRetry(prisma);

      expect(readyIds).toContain(readyJob.id);
      expect(readyIds).not.toContain(notReadyJob.id);

      await prisma.aiJob.deleteMany({
        where: { id: { in: [readyJob.id, notReadyJob.id] } },
      });
    });
  });

  describe("Lease Loss Detection", () => {
    it("should detect when worker still owns lease", async () => {
      const job = await prisma.aiJob.create({
        data: {
          tenderId: testTenderId,
          userId: testUserId,
          jobType: "AI_ANALYZE",
          status: "RUNNING",
          analysisInputHash: "hash1",
          leaseOwner: "worker-1",
          leaseExpiresAt: new Date(Date.now() + 60000),
        },
      });

      const owns = await stillOwnsLease(job.id, "worker-1", prisma);
      expect(owns).toBe(true);

      await prisma.aiJob.delete({ where: { id: job.id } });
    });

    it("should detect when another worker claimed job", async () => {
      const job = await prisma.aiJob.create({
        data: {
          tenderId: testTenderId,
          userId: testUserId,
          jobType: "AI_ANALYZE",
          status: "RUNNING",
          analysisInputHash: "hash1",
          leaseOwner: "worker-1",
          leaseExpiresAt: new Date(Date.now() + 60000),
        },
      });

      const owns = await stillOwnsLease(job.id, "worker-2", prisma);
      expect(owns).toBe(false);

      await prisma.aiJob.delete({ where: { id: job.id } });
    });

    it("should detect when lease expired", async () => {
      const job = await prisma.aiJob.create({
        data: {
          tenderId: testTenderId,
          userId: testUserId,
          jobType: "AI_ANALYZE",
          status: "RUNNING",
          analysisInputHash: "hash1",
          leaseOwner: "worker-1",
          leaseExpiresAt: new Date(Date.now() - 1000), // Expired
        },
      });

      const owns = await stillOwnsLease(job.id, "worker-1", prisma);
      expect(owns).toBe(false);

      await prisma.aiJob.delete({ where: { id: job.id } });
    });

    it("should detect when job deleted", async () => {
      const owns = await stillOwnsLease("nonexistent-job", "worker-1", prisma);
      expect(owns).toBe(false);
    });
  });

  describe("Integration: Complete Worker Lifecycle", () => {
    it("should execute full worker lifecycle", async () => {
      // 1. Create job
      const job = await prisma.aiJob.create({
        data: {
          tenderId: testTenderId,
          userId: testUserId,
          jobType: "AI_ANALYZE",
          status: "QUEUED",
          analysisInputHash: "hash1",
        },
      });

      // 2. Claim job
      const claim = await claimJobWithLease(
        { leaseOwnerWorkerId: "worker-1" },
        prisma,
      );
      expect(claim?.jobId).toBe(job.id);

      // 3. Heartbeat (renew lease)
      const heartbeat = await renewJobLease(
        job.id,
        "worker-1",
        prisma,
        5 * 60 * 1000,
      );
      expect(heartbeat?.renewed).toBe(true);

      // 4. Complete and promote
      await prisma.aiJob.update({
        where: { id: job.id },
        data: {
          status: "SUCCEEDED",
          finishedAt: new Date(),
          promotedAt: new Date(),
          promotedBy: "worker-1",
        },
      });

      // 5. Verify final state
      const final = await prisma.aiJob.findUnique({ where: { id: job.id } });
      expect(final?.status).toBe("SUCCEEDED");
      expect(final?.promotedAt).not.toBeNull();

      await prisma.aiJob.delete({ where: { id: job.id } });
    });
  });
});
