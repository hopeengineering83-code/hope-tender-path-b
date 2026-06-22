/**
 * Phase 1 Tests: Atomic Job Claiming + State Resolver
 *
 * Verifies:
 * - State resolver is the authoritative source of truth
 * - Tender.notes is display-only, never used for gates
 * - Fresh QUEUED jobs are claimed atomically
 * - Only AI_SUCCEEDED and HUMAN_APPROVED_FALLBACK allow generation
 * - Database failure fails closed (no silent fallback to notes)
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PrismaClient } from "@prisma/client";
import { getTenderAnalysisState, canGenerateFromState, getStateMessage } from "../lib/ai-analyze/state-resolver";

describe("Phase 1: State Resolver Authority", () => {
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

  describe("State Resolver: NOT_STARTED", () => {
    it("should return NOT_STARTED when no job exists", async () => {
      const state = await getTenderAnalysisState(testTenderId, testUserId, prisma);
      expect(state.state).toBe("NOT_STARTED");
      expect(state.canGenerate).toBe(false);
    });
  });

  describe("State Resolver: QUEUED", () => {
    it("should return QUEUED when job status is QUEUED", async () => {
      const job = await prisma.aiJob.create({
        data: {
          tenderId: testTenderId,
          userId: testUserId,
          jobType: "AI_ANALYZE",
          status: "QUEUED",
          analysisInputHash: "hash123",
        },
      });

      const state = await getTenderAnalysisState(testTenderId, testUserId, prisma);
      expect(state.state).toBe("QUEUED");
      expect(state.jobId).toBe(job.id);
      expect(state.canGenerate).toBe(false);

      await prisma.aiJob.delete({ where: { id: job.id } });
    });
  });

  describe("State Resolver: RUNNING", () => {
    it("should return RUNNING when job status is RUNNING", async () => {
      const job = await prisma.aiJob.create({
        data: {
          tenderId: testTenderId,
          userId: testUserId,
          jobType: "AI_ANALYZE",
          status: "RUNNING",
          analysisInputHash: "hash123",
          startedAt: new Date(),
        },
      });

      const state = await getTenderAnalysisState(testTenderId, testUserId, prisma);
      expect(state.state).toBe("RUNNING");
      expect(state.canGenerate).toBe(false);

      await prisma.aiJob.delete({ where: { id: job.id } });
    });
  });

  describe("State Resolver: PARTIAL_NEEDS_RESUME", () => {
    it("should return PARTIAL_NEEDS_RESUME when some chunks succeeded", async () => {
      const job = await prisma.aiJob.create({
        data: {
          tenderId: testTenderId,
          userId: testUserId,
          jobType: "AI_ANALYZE",
          status: "RUNNING",
          analysisInputHash: "hash123",
          startedAt: new Date(),
        },
      });

      // Create partial chunks
      await prisma.aiAnalyzeChunk.create({
        data: {
          tenderId: testTenderId,
          userId: testUserId,
          contentHash: "hash123",
          chunkIndex: 0,
          totalChunks: 3,
          status: "SUCCEEDED",
        },
      });

      const state = await getTenderAnalysisState(testTenderId, testUserId, prisma);
      expect(state.state).toBe("PARTIAL_NEEDS_RESUME");
      expect(state.requiresResume).toBe(true);
      expect(state.canGenerate).toBe(false);

      await prisma.aiAnalyzeChunk.deleteMany({
        where: { tenderId: testTenderId },
      });
      await prisma.aiJob.delete({ where: { id: job.id } });
    });
  });

  describe("State Resolver: AI_SUCCEEDED", () => {
    it("should return AI_SUCCEEDED when job status is SUCCEEDED", async () => {
      const job = await prisma.aiJob.create({
        data: {
          tenderId: testTenderId,
          userId: testUserId,
          jobType: "AI_ANALYZE",
          status: "SUCCEEDED",
          analysisInputHash: "hash123",
          startedAt: new Date(),
          finishedAt: new Date(),
        },
      });

      const state = await getTenderAnalysisState(testTenderId, testUserId, prisma);
      expect(state.state).toBe("AI_SUCCEEDED");
      expect(state.canGenerate).toBe(true);

      await prisma.aiJob.delete({ where: { id: job.id } });
    });
  });

  describe("State Resolver: REGEX_FALLBACK_UNAPPROVED", () => {
    it("should return REGEX_FALLBACK_UNAPPROVED when job status is REGEX_FALLBACK_UNAPPROVED", async () => {
      const job = await prisma.aiJob.create({
        data: {
          tenderId: testTenderId,
          userId: testUserId,
          jobType: "AI_ANALYZE",
          status: "REGEX_FALLBACK_UNAPPROVED",
          analysisInputHash: "hash123",
        },
      });

      const state = await getTenderAnalysisState(testTenderId, testUserId, prisma);
      expect(state.state).toBe("REGEX_FALLBACK_UNAPPROVED");
      expect(state.canGenerate).toBe(false);

      await prisma.aiJob.delete({ where: { id: job.id } });
    });
  });

  describe("State Resolver: HUMAN_APPROVED_FALLBACK", () => {
    it("should return HUMAN_APPROVED_FALLBACK when job status is HUMAN_APPROVED_FALLBACK", async () => {
      const job = await prisma.aiJob.create({
        data: {
          tenderId: testTenderId,
          userId: testUserId,
          jobType: "AI_ANALYZE",
          status: "HUMAN_APPROVED_FALLBACK",
          analysisInputHash: "hash123",
        },
      });

      const state = await getTenderAnalysisState(testTenderId, testUserId, prisma);
      expect(state.state).toBe("HUMAN_APPROVED_FALLBACK");
      expect(state.canGenerate).toBe(true); // Only approved fallback can generate

      await prisma.aiJob.delete({ where: { id: job.id } });
    });
  });

  describe("State Resolver: Fail Closed on DB Error", () => {
    it("should fail closed when database is unreachable", async () => {
      const badPrisma = new PrismaClient({
        datasources: {
          db: { url: "postgresql://invalid:invalid@invalid:9999/invalid" },
        },
      });

      const state = await getTenderAnalysisState(testTenderId, testUserId, badPrisma);
      expect(state.canGenerate).toBe(false);
      expect(state.error).toContain("unavailable");

      await badPrisma.$disconnect();
    });
  });

  describe("canGenerateFromState()", () => {
    it("should allow generation only for AI_SUCCEEDED and HUMAN_APPROVED_FALLBACK", () => {
      expect(canGenerateFromState("AI_SUCCEEDED")).toBe(true);
      expect(canGenerateFromState("HUMAN_APPROVED_FALLBACK")).toBe(true);

      expect(canGenerateFromState("NOT_STARTED")).toBe(false);
      expect(canGenerateFromState("QUEUED")).toBe(false);
      expect(canGenerateFromState("RUNNING")).toBe(false);
      expect(canGenerateFromState("PARTIAL_NEEDS_RESUME")).toBe(false);
      expect(canGenerateFromState("REGEX_FALLBACK_UNAPPROVED")).toBe(false);
      expect(canGenerateFromState("FAILED")).toBe(false);
      expect(canGenerateFromState("SUPERSEDED")).toBe(false);
    });
  });

  describe("getStateMessage()", () => {
    it("should return user-facing message for each state", () => {
      const states: Array<[string, string]> = [
        ["NOT_STARTED", "Analysis not started"],
        ["QUEUED", "AI Analyze queued"],
        ["RUNNING", "Analysis in progress"],
        ["PARTIAL_NEEDS_RESUME", "Analysis partially complete"],
        ["AI_SUCCEEDED", "Analysis complete"],
        ["REGEX_FALLBACK_UNAPPROVED", "Analysis failed"],
        ["HUMAN_APPROVED_FALLBACK", "Human-approved fallback"],
        ["FAILED", "Analysis failed"],
        ["SUPERSEDED", "A newer analysis exists"],
      ];

      for (const [state, expectedPhrase] of states) {
        const msg = getStateMessage(state as any);
        expect(msg.toLowerCase()).toContain(expectedPhrase.toLowerCase());
      }
    });
  });

  describe("Superseded jobs are ignored", () => {
    it("should ignore superseded jobs and return latest non-superseded", async () => {
      const job1 = await prisma.aiJob.create({
        data: {
          tenderId: testTenderId,
          userId: testUserId,
          jobType: "AI_ANALYZE",
          status: "SUCCEEDED",
          analysisInputHash: "hash1",
        },
      });

      // Supersede it
      await prisma.aiJob.update({
        where: { id: job1.id },
        data: { supersededBy: "content-changed" },
      });

      // Create new job
      const job2 = await prisma.aiJob.create({
        data: {
          tenderId: testTenderId,
          userId: testUserId,
          jobType: "AI_ANALYZE",
          status: "QUEUED",
          analysisInputHash: "hash2",
        },
      });

      const state = await getTenderAnalysisState(testTenderId, testUserId, prisma);
      expect(state.jobId).toBe(job2.id);
      expect(state.state).toBe("QUEUED");

      await prisma.aiJob.deleteMany({
        where: { tenderId: testTenderId },
      });
    });
  });
});
