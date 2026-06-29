/**
 * Behavioral tests for two remaining gaps:
 * 1. Metadata grounding stricter contract: TenderFile ID validation
 * 2. Build Plan persistence: bound to content hash and file list
 */

import { describe, it, expect } from "vitest";
import { isGroundedEvidence, isGroundedEvidenceWithFileCheck } from "../lib/engine/evidence-grounding";
import { computeBuildPlanContentHash, isBuildPlanValid } from "../lib/engine/build-plan-hash";

describe("Gap 1: Metadata Grounding Stricter Contract", () => {
  describe("Evidence validation with TenderFile ID", () => {
    it("should require page, quote, AND valid fileId for full grounding", () => {
      // Basic check (no fileId validation)
      const hasBasicGrounding = isGroundedEvidence(5, "This is a meaningful quote");
      expect(hasBasicGrounding).toBe(true);

      // Stricter check with fileId validation
      const activeTenderFileIds = new Set(["file-1", "file-2"]);
      const hasFullGrounding = isGroundedEvidenceWithFileCheck(
        5,
        "This is a meaningful quote",
        "file-1", // Valid fileId
        activeTenderFileIds
      );
      expect(hasFullGrounding).toBe(true);
    });

    it("should reject evidence with null fileId when checking for full grounding", () => {
      const activeTenderFileIds = new Set(["file-1"]);
      const result = isGroundedEvidenceWithFileCheck(
        5,
        "This is a meaningful quote",
        null, // Missing fileId
        activeTenderFileIds
      );
      expect(result).toBe(false);
    });

    it("should reject evidence with inactive fileId (not in active set)", () => {
      const activeTenderFileIds = new Set(["file-1", "file-2"]);
      const result = isGroundedEvidenceWithFileCheck(
        5,
        "This is a meaningful quote",
        "file-3", // Deleted or inactive file
        activeTenderFileIds
      );
      expect(result).toBe(false);
    });

    it("should reject evidence with empty fileId string", () => {
      const activeTenderFileIds = new Set(["file-1"]);
      const result = isGroundedEvidenceWithFileCheck(
        5,
        "This is a meaningful quote",
        "", // Empty string
        activeTenderFileIds
      );
      expect(result).toBe(false);
    });

    it("should reject evidence with insufficient quote length even with valid fileId", () => {
      const activeTenderFileIds = new Set(["file-1"]);
      const result = isGroundedEvidenceWithFileCheck(
        5,
        "short", // Only 5 chars, needs > 5
        "file-1",
        activeTenderFileIds
      );
      expect(result).toBe(false);
    });

    it("should reject evidence with zero or missing page number even with valid fileId", () => {
      const activeTenderFileIds = new Set(["file-1"]);
      const result = isGroundedEvidenceWithFileCheck(
        0,
        "This is a meaningful quote",
        "file-1",
        activeTenderFileIds
      );
      expect(result).toBe(false);
    });
  });
});

describe("Gap 2: Build Plan Persistence", () => {
  describe("Content hash computation and validation", () => {
    it("should compute consistent hash for same file list", () => {
      const files = [
        { id: "file-1", originalFileName: "RFQ.pdf" },
        { id: "file-2", originalFileName: "Scope.pdf" },
      ];

      const hash1 = computeBuildPlanContentHash(files);
      const hash2 = computeBuildPlanContentHash(files);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA256 hex is 64 chars
    });

    it("should compute different hash when file is added", () => {
      const files1 = [{ id: "file-1", originalFileName: "RFQ.pdf" }];
      const files2 = [
        { id: "file-1", originalFileName: "RFQ.pdf" },
        { id: "file-2", originalFileName: "Scope.pdf" },
      ];

      const hash1 = computeBuildPlanContentHash(files1);
      const hash2 = computeBuildPlanContentHash(files2);

      expect(hash1).not.toBe(hash2);
    });

    it("should compute different hash when file is removed", () => {
      const files1 = [
        { id: "file-1", originalFileName: "RFQ.pdf" },
        { id: "file-2", originalFileName: "Scope.pdf" },
      ];
      const files2 = [{ id: "file-1", originalFileName: "RFQ.pdf" }];

      const hash1 = computeBuildPlanContentHash(files1);
      const hash2 = computeBuildPlanContentHash(files2);

      expect(hash1).not.toBe(hash2);
    });

    it("should compute different hash when file is renamed", () => {
      const files1 = [{ id: "file-1", originalFileName: "RFQ.pdf" }];
      const files2 = [{ id: "file-1", originalFileName: "Tender.pdf" }];

      const hash1 = computeBuildPlanContentHash(files1);
      const hash2 = computeBuildPlanContentHash(files2);

      expect(hash1).not.toBe(hash2);
    });

    it("should compute different hash when file order changes", () => {
      const files1 = [
        { id: "file-1", originalFileName: "RFQ.pdf" },
        { id: "file-2", originalFileName: "Scope.pdf" },
      ];
      const files2 = [
        { id: "file-2", originalFileName: "Scope.pdf" },
        { id: "file-1", originalFileName: "RFQ.pdf" },
      ];

      const hash1 = computeBuildPlanContentHash(files1);
      const hash2 = computeBuildPlanContentHash(files2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("Build plan validity checking", () => {
    it("should validate plan when contentHash matches current files", () => {
      const files = [
        { id: "file-1", originalFileName: "RFQ.pdf" },
        { id: "file-2", originalFileName: "Scope.pdf" },
      ];

      const recordedHash = computeBuildPlanContentHash(files);
      const isValid = isBuildPlanValid(recordedHash, files);

      expect(isValid).toBe(true);
    });

    it("should invalidate plan when a file is added after plan creation", () => {
      const filesAtPlanTime = [{ id: "file-1", originalFileName: "RFQ.pdf" }];
      const recordedHash = computeBuildPlanContentHash(filesAtPlanTime);

      const filesNow = [
        { id: "file-1", originalFileName: "RFQ.pdf" },
        { id: "file-2", originalFileName: "Scope.pdf" },
      ];
      const isValid = isBuildPlanValid(recordedHash, filesNow);

      expect(isValid).toBe(false);
    });

    it("should invalidate plan when a file is deleted after plan creation", () => {
      const filesAtPlanTime = [
        { id: "file-1", originalFileName: "RFQ.pdf" },
        { id: "file-2", originalFileName: "Scope.pdf" },
      ];
      const recordedHash = computeBuildPlanContentHash(filesAtPlanTime);

      const filesNow = [{ id: "file-1", originalFileName: "RFQ.pdf" }];
      const isValid = isBuildPlanValid(recordedHash, filesNow);

      expect(isValid).toBe(false);
    });

    it("should invalidate plan when a file is renamed after plan creation", () => {
      const filesAtPlanTime = [{ id: "file-1", originalFileName: "RFQ.pdf" }];
      const recordedHash = computeBuildPlanContentHash(filesAtPlanTime);

      const filesNow = [{ id: "file-1", originalFileName: "Tender.pdf" }];
      const isValid = isBuildPlanValid(recordedHash, filesNow);

      expect(isValid).toBe(false);
    });
  });
});
