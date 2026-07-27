import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  buildCandidatesFromMetadata,
  markStaleOnValueChange,
  type CandidateFileContext,
} from "../lib/engine/candidate-pipeline";
import type { TenderFactCandidate } from "../lib/engine/evidence-candidate";

const FILES: CandidateFileContext[] = [{
  id: "file-1",
  extractedText: `[Page 1]
Ministry of Urban Development
REQUEST FOR PROPOSAL
Reference: MOU/RFP/2026/0001
Procuring Entity: Ministry of Urban Development
Deadline: 30 November 2026
Submit by email to bids@moud.gov.et
[Page 2]
The consultant must have 10 years of experience.`,
  totalPages: 2,
  contentHash: "hash-1",
  deletionStatus: "ACTIVE",
}];

function candidate(field: string, originalValue: string): TenderFactCandidate {
  return {
    field,
    candidateType: "regex",
    normalizedValue: originalValue.toLowerCase(),
    originalValue,
    status: "GROUNDED",
    confidence: 0.9,
    tenderFileId: "f1",
    pageNumber: 1,
    exactQuote: `${field}: ${originalValue}`,
    sourceContentHash: null,
    extractionSource: `regex:${field}`,
    validationResult: "valid",
    hasCompetingCandidates: false,
    createdAt: new Date(),
    isStale: false,
  };
}

describe("candidate-pipeline — grounded evidence and rejection policy", () => {
  it("produces no candidates when no values are provided", () => {
    const result = buildCandidatesFromMetadata({ values: {}, files: FILES });
    assert.equal(result.candidates.length, 0);
    assert.equal(Object.keys(result.scalarPatch).length, 0);
  });

  it("grounds client and reference values to exact source evidence", () => {
    const result = buildCandidatesFromMetadata({
      values: {
        clientName: "Ministry of Urban Development",
        reference: "MOU/RFP/2026/0001",
      },
      files: FILES,
    });
    assert.equal(result.candidates.length, 2);
    for (const item of result.candidates) {
      assert.equal(item.tenderFileId, "file-1");
      assert.equal(item.pageNumber, 1);
      assert.ok(item.exactQuote);
      assert.notEqual(item.promotionDecision, "REJECTED");
      assert.notEqual(item.promotionDecision, "DEFERRED");
    }
    assert.equal(result.scalarPatch.clientName, "Ministry of Urban Development");
    assert.equal(result.scalarPatch.reference, "MOU/RFP/2026/0001");
    assert.equal(result.evidencePatch.clientNameSourceFileId, "file-1");
    assert.equal(result.evidencePatch.referenceSourceFileId, "file-1");
  });

  it("rejects placeholders and malformed values", () => {
    const placeholders = buildCandidatesFromMetadata({
      values: { clientName: "TBD", reference: "N/A" },
      files: FILES,
    });
    assert.equal(placeholders.summary.rejected, 2);
    assert.equal(Object.keys(placeholders.scalarPatch).length, 0);

    const invalid = buildCandidatesFromMetadata({ values: { clientName: "a" }, files: FILES });
    assert.equal(invalid.candidates[0]?.promotionDecision, "REJECTED");
  });

  it("accepts legitimate letter-only references", () => {
    const result = buildCandidatesFromMetadata({ values: { reference: "REFONLY" }, files: FILES });
    assert.notEqual(result.candidates[0]?.promotionDecision, "REJECTED");
    assert.notEqual(result.candidates[0]?.validationResult, "invalid");
  });

  it("defers values that have no current source evidence", () => {
    const result = buildCandidatesFromMetadata({
      values: { clientName: "Some Random Unknown Entity" },
      files: FILES,
    });
    assert.equal(result.candidates[0]?.tenderFileId, null);
    assert.equal(result.candidates[0]?.promotionDecision, "DEFERRED");
    assert.equal(Object.keys(result.scalarPatch).length, 0);
  });

  it("excludes deleted files from evidence", () => {
    const deleted: CandidateFileContext[] = [{
      id: "deleted",
      extractedText: "[Page 1]\nMinistry of Test\nReference: TEST/001",
      totalPages: 1,
      contentHash: "deleted-hash",
      deletionStatus: "DELETED",
    }];
    const result = buildCandidatesFromMetadata({ values: { clientName: "Ministry of Test" }, files: deleted });
    assert.equal(result.candidates[0]?.tenderFileId, null);
    assert.equal(result.candidates[0]?.promotionDecision, "DEFERRED");
  });

  it("reports consistent summary counts and extraction source labels", () => {
    const result = buildCandidatesFromMetadata({
      values: {
        clientName: "Ministry of Urban Development",
        reference: "MOU/RFP/2026/0001",
        title: "TBD",
      },
      files: FILES,
      candidateType: "ai",
      extractionSourcePrefix: "ai:chunk-1",
    });
    assert.equal(result.summary.total, 3);
    assert.equal(result.summary.rejected, 1);
    assert.equal(result.summary.autoConfirmed + result.summary.grounded, 2);
    assert.equal(result.candidates[0]?.candidateType, "ai");
    assert.ok(result.candidates[0]?.extractionSource.startsWith("ai:chunk-1:"));
  });
});

describe("candidate-pipeline — stale revision policy", () => {
  it("marks only changed fields stale", () => {
    const existing = [
      candidate("clientName", "Ministry of Water"),
      candidate("reference", "MOW/RFP/2026/0099"),
    ];
    const changed = markStaleOnValueChange(existing, "clientName", "Ministry of Agriculture");
    assert.equal(changed[0]?.status, "STALE");
    assert.equal(changed[0]?.isStale, true);
    assert.equal(changed[1]?.status, "GROUNDED");
  });

  it("does not stale an unchanged value", () => {
    const unchanged = markStaleOnValueChange(
      [candidate("clientName", "Ministry of Water")],
      "clientName",
      "Ministry of Water",
    );
    assert.equal(unchanged[0]?.status, "GROUNDED");
    assert.equal(unchanged[0]?.isStale, false);
  });
});

describe("candidate-pipeline — wired to durable source extraction", () => {
  const source = readFileSync("lib/ai-jobs/tender-extraction-service.ts", "utf8");

  it("runs after current byte-revision extraction", () => {
    assert.match(source, /buildCandidatesFromMetadata\(\{/);
    assert.match(source, /candidateType: "regex"/);
    assert.match(source, /extractionSourcePrefix: "extract-text-job"/);
    assert.match(source, /expectedContentSha256/);
    assert.match(source, /deletionStatus: "ACTIVE"/);
  });

  it("surfaces rejected and needs-review candidate counts", () => {
    assert.match(source, /candidatePipeline\.summary\.rejected/);
    assert.match(source, /candidatePipeline\.summary\.needsReview/);
    assert.match(source, /logger\.warn\("\[extract-text\] candidate review required"/);
  });

  it("keeps candidate enrichment non-fatal after durable extraction", () => {
    assert.match(source, /source enrichment failed after durable extraction/);
    assert.match(source, /continueTenderPipelineAfterExtraction/);
  });
});
