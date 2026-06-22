/**
 * Phase 4 Tests: Extraction Quality Gates
 *
 * Verifies:
 * - Corrupted extraction blocks analysis (cannot proceed even with force=true)
 * - Weak extraction blocks analysis (can override with force=true)
 * - Quality metrics calculated correctly
 * - Coverage percentage tracked
 * - Force mode does NOT bypass corrupted extraction gate
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PrismaClient } from "@prisma/client";
import {
  calculateExtractionMetrics,
  assessExtractionQuality,
  canStartAnalysisWithExtraction,
} from "../lib/ai-analyze/extraction-quality";
import { startOrResumeAnalysis } from "../lib/ai-analyze/production-analysis-service";

describe("Phase 4: Extraction Quality Gates", () => {
  let prisma: PrismaClient;
  let testTenderId: string;
  let testUserId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    // Create test user and tender
    // (simplified - in real setup use test database)
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("Extraction Metrics Calculation", () => {
    it("should calculate coverage correctly", async () => {
      // Create file with 10 total pages, 9 extracted
      const file = await prisma.tenderFile.create({
        data: {
          tenderId: testTenderId,
          fileName: "test.pdf",
          originalFileName: "test.pdf",
          mimeType: "application/pdf",
          size: 5000,
          totalPages: 10,
          extractedPages: 9,
          extractedText: "A".repeat(5000), // 5000 chars
        },
      });

      const metrics = await calculateExtractionMetrics(testTenderId, prisma);
      expect(metrics.totalPages).toBe(10);
      expect(metrics.extractedPages).toBe(9);
      expect(metrics.extractionCoverage).toBe(90); // 9/10 = 90%
      expect(metrics.totalCharacters).toBe(5000);

      await prisma.tenderFile.delete({ where: { id: file.id } });
    });

    it("should detect corrupted extraction (very low char count)", async () => {
      const file = await prisma.tenderFile.create({
        data: {
          tenderId: testTenderId,
          fileName: "corrupted.pdf",
          originalFileName: "corrupted.pdf",
          mimeType: "application/pdf",
          size: 100000, // Large file but
          totalPages: 50,
          extractedPages: 50,
          extractedText: "???", // Only 3 chars from 50 pages = corruption
        },
      });

      const metrics = await calculateExtractionMetrics(testTenderId, prisma);
      expect(metrics.isCorrupted).toBe(true);
      expect(metrics.totalCharacters).toBe(3);

      await prisma.tenderFile.delete({ where: { id: file.id } });
    });

    it("should calculate average chars per page", async () => {
      const file = await prisma.tenderFile.create({
        data: {
          tenderId: testTenderId,
          fileName: "test.pdf",
          originalFileName: "test.pdf",
          mimeType: "application/pdf",
          size: 3000,
          totalPages: 10,
          extractedPages: 10,
          extractedText: "A".repeat(3000), // 300 chars per page
        },
      });

      const metrics = await calculateExtractionMetrics(testTenderId, prisma);
      expect(metrics.avgCharsPerPage).toBe(300);

      await prisma.tenderFile.delete({ where: { id: file.id } });
    });
  });

  describe("Extraction Quality Assessment", () => {
    it("should flag corrupted extraction", async () => {
      const file = await prisma.tenderFile.create({
        data: {
          tenderId: testTenderId,
          fileName: "corrupted.pdf",
          originalFileName: "corrupted.pdf",
          mimeType: "application/pdf",
          size: 100000,
          totalPages: 50,
          extractedPages: 50,
          extractedText: "", // 0 characters
        },
      });

      const quality = await assessExtractionQuality(testTenderId, prisma);
      expect(quality.metrics.isCorrupted).toBe(true);
      expect(quality.status).toBe("REGEX_FALLBACK_FROM_WEAK_EXTRACTION");
      expect(quality.meetsMinimumQuality).toBe(false);

      await prisma.tenderFile.delete({ where: { id: file.id } });
    });

    it("should flag weak extraction (< 70% coverage)", async () => {
      const file = await prisma.tenderFile.create({
        data: {
          tenderId: testTenderId,
          fileName: "weak.pdf",
          originalFileName: "weak.pdf",
          mimeType: "application/pdf",
          size: 5000,
          totalPages: 10,
          extractedPages: 6, // 60% coverage
          ocrPages: 0, // No OCR available
          extractedText: "A".repeat(2000),
        },
      });

      const quality = await assessExtractionQuality(testTenderId, prisma);
      expect(quality.metrics.extractionCoverage).toBe(60);
      expect(quality.status).toBe("EXTRACTION_WEAK_REVIEW_REQUIRED");
      expect(quality.meetsMinimumQuality).toBe(false);

      await prisma.tenderFile.delete({ where: { id: file.id } });
    });

    it("should suggest OCR for weak extraction", async () => {
      const file = await prisma.tenderFile.create({
        data: {
          tenderId: testTenderId,
          fileName: "needs_ocr.pdf",
          originalFileName: "needs_ocr.pdf",
          mimeType: "application/pdf",
          size: 5000,
          totalPages: 10,
          extractedPages: 6, // 60% coverage
          ocrPages: 2, // OCR available
          extractedText: "A".repeat(2000),
        },
      });

      const quality = await assessExtractionQuality(testTenderId, prisma);
      expect(quality.status).toBe("OCR_REQUIRED");

      await prisma.tenderFile.delete({ where: { id: file.id } });
    });

    it("should accept good extraction (> 90% coverage)", async () => {
      const file = await prisma.tenderFile.create({
        data: {
          tenderId: testTenderId,
          fileName: "good.pdf",
          originalFileName: "good.pdf",
          mimeType: "application/pdf",
          size: 5000,
          totalPages: 10,
          extractedPages: 10,
          extractedText: "A".repeat(5000),
        },
      });

      const quality = await assessExtractionQuality(testTenderId, prisma);
      expect(quality.meetsMinimumQuality).toBe(true);
      expect(quality.status).toBe("FULL_EXTRACTION_AI_ANALYZED");

      await prisma.tenderFile.delete({ where: { id: file.id } });
    });

    it("should accept partial extraction (70-90% coverage)", async () => {
      const file = await prisma.tenderFile.create({
        data: {
          tenderId: testTenderId,
          fileName: "partial.pdf",
          originalFileName: "partial.pdf",
          mimeType: "application/pdf",
          size: 5000,
          totalPages: 10,
          extractedPages: 8, // 80% coverage
          extractedText: "A".repeat(5000),
        },
      });

      const quality = await assessExtractionQuality(testTenderId, prisma);
      expect(quality.meetsMinimumQuality).toBe(true);
      expect(quality.status).toBe("PARTIAL_EXTRACTION_AI_ANALYZED");

      await prisma.tenderFile.delete({ where: { id: file.id } });
    });
  });

  describe("Extraction Gate: Analysis Blocking", () => {
    it("should block corrupted extraction (no force override)", async () => {
      const file = await prisma.tenderFile.create({
        data: {
          tenderId: testTenderId,
          fileName: "corrupted.pdf",
          originalFileName: "corrupted.pdf",
          mimeType: "application/pdf",
          size: 100000,
          totalPages: 50,
          extractedPages: 50,
          extractedText: "", // Corrupted
        },
      });

      const result = await canStartAnalysisWithExtraction(testTenderId, prisma, false);
      expect(result.allowed).toBe(false);
      expect(result.quality.metrics.isCorrupted).toBe(true);

      // Even with force=true, should still block
      const resultForce = await canStartAnalysisWithExtraction(testTenderId, prisma, true);
      expect(resultForce.allowed).toBe(false);

      await prisma.tenderFile.delete({ where: { id: file.id } });
    });

    it("should block weak extraction without force", async () => {
      const file = await prisma.tenderFile.create({
        data: {
          tenderId: testTenderId,
          fileName: "weak.pdf",
          originalFileName: "weak.pdf",
          mimeType: "application/pdf",
          size: 5000,
          totalPages: 10,
          extractedPages: 6,
          extractedText: "A".repeat(2000),
        },
      });

      const result = await canStartAnalysisWithExtraction(testTenderId, prisma, false);
      expect(result.allowed).toBe(false);

      await prisma.tenderFile.delete({ where: { id: file.id } });
    });

    it("should allow weak extraction with force=true", async () => {
      const file = await prisma.tenderFile.create({
        data: {
          tenderId: testTenderId,
          fileName: "weak.pdf",
          originalFileName: "weak.pdf",
          mimeType: "application/pdf",
          size: 5000,
          totalPages: 10,
          extractedPages: 6,
          extractedText: "A".repeat(2000),
        },
      });

      const result = await canStartAnalysisWithExtraction(testTenderId, prisma, true);
      expect(result.allowed).toBe(true);

      await prisma.tenderFile.delete({ where: { id: file.id } });
    });
  });

  describe("Integration: startOrResumeAnalysis with Quality Gate", () => {
    it("should return blocked status when extraction is corrupted", async () => {
      const file = await prisma.tenderFile.create({
        data: {
          tenderId: testTenderId,
          fileName: "corrupted.pdf",
          originalFileName: "corrupted.pdf",
          mimeType: "application/pdf",
          size: 100000,
          totalPages: 50,
          extractedPages: 50,
          extractedText: "",
        },
      });

      const result = await startOrResumeAnalysis(
        { tenderId: testTenderId, userId: testUserId, force: true },
        prisma,
      );

      expect(result.extractionBlocked).toBe(true);
      expect(result.jobId).toBeUndefined();
      expect(result.extractionQuality?.metrics.isCorrupted).toBe(true);

      await prisma.tenderFile.delete({ where: { id: file.id } });
    });

    it("should block weak extraction without force", async () => {
      const file = await prisma.tenderFile.create({
        data: {
          tenderId: testTenderId,
          fileName: "weak.pdf",
          originalFileName: "weak.pdf",
          mimeType: "application/pdf",
          size: 5000,
          totalPages: 10,
          extractedPages: 6,
          extractedText: "A".repeat(2000),
        },
      });

      const result = await startOrResumeAnalysis(
        { tenderId: testTenderId, userId: testUserId, force: false },
        prisma,
      );

      expect(result.extractionBlocked).toBe(true);
      expect(result.jobId).toBeUndefined();

      await prisma.tenderFile.delete({ where: { id: file.id } });
    });

    it("should allow analysis with good extraction", async () => {
      const file = await prisma.tenderFile.create({
        data: {
          tenderId: testTenderId,
          fileName: "good.pdf",
          originalFileName: "good.pdf",
          mimeType: "application/pdf",
          size: 5000,
          totalPages: 10,
          extractedPages: 10,
          extractedText: "A".repeat(5000),
        },
      });

      const result = await startOrResumeAnalysis(
        { tenderId: testTenderId, userId: testUserId },
        prisma,
      );

      expect(result.extractionBlocked).toBeFalsy();
      expect(result.jobId).toBeTruthy();
      expect(result.extractionQuality?.meetsMinimumQuality).toBe(true);

      if (result.jobId) {
        await prisma.aiJob.delete({ where: { id: result.jobId } });
      }
      await prisma.tenderFile.delete({ where: { id: file.id } });
    });
  });
});
