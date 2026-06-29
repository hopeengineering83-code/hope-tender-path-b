import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { resolveCanonicalFieldState } from "../lib/engine/canonical-field-state";
import { evaluateGenerationReadiness } from "../lib/engine/generation-readiness-gate";

describe("Canonical Resolver - Strict Grounding", () => {
  const baseTender = {
    id: "t1",
    title: "Tender 2026",
    deadline: new Date("2026-12-01"),
    clientName: "Ministry of Health",
    clientNameSourcePage: 1,
    clientNameSourceQuote: "The client is Ministry of Health",
    metadataContaminated: false,
    requirements: [],
  };

  it("grounds USER_CONFIRMED when normalized value matches evidence", () => {
    const r = resolveCanonicalFieldState({
      tender: baseTender as any,
      overrides: [{
        field: "clientName",
        fieldState: "USER_CONFIRMED",
        overrideValue: "MINISTRY OF HEALTH", // Case difference
        reason: "matched",
        overriddenBy: "u1",
        createdAt: new Date()
      }],
      hasExtractedRequirements: true,
    });
    const f = r.fields.find(f => f.fieldKey === "clientName")!;
    assert.equal(f.status, "EXTRACTED_AND_GROUNDED");
    assert.equal(f.isGrounded, true);
    assert.equal(f.blockerReason, null);
  });

  it("blocks USER_CONFIRMED when normalized value mismatches evidence", () => {
    const r = resolveCanonicalFieldState({
      tender: baseTender as any,
      overrides: [{
        field: "clientName",
        fieldState: "USER_CONFIRMED",
        overrideValue: "Different Entity",
        reason: "wrong",
        overriddenBy: "u1",
        createdAt: new Date()
      }],
      hasExtractedRequirements: true,
    });
    const f = r.fields.find(f => f.fieldKey === "clientName")!;
    assert.equal(f.status, "MANUAL_CONFIRMED");
    assert.equal(f.isGrounded, false);
    assert.match(f.blockerReason!, /does not match the linked tender-source evidence/);
  });

  it("grounds USER_EDITED when normalized value matches evidence", () => {
    const r = resolveCanonicalFieldState({
      tender: baseTender as any,
      overrides: [{
        field: "clientName",
        fieldState: "USER_EDITED",
        overrideValue: "Ministry of Health ", // Trailing space
        reason: "edited",
        overriddenBy: "u1",
        createdAt: new Date()
      }],
      hasExtractedRequirements: true,
    });
    const f = r.fields.find(f => f.fieldKey === "clientName")!;
    assert.equal(f.status, "EXTRACTED_AND_GROUNDED");
    assert.equal(f.isGrounded, true);
  });

  it("blocks USER_EDITED when normalized value mismatches evidence", () => {
    const r = resolveCanonicalFieldState({
      tender: baseTender as any,
      overrides: [{
        field: "clientName",
        fieldState: "USER_EDITED",
        overrideValue: "New Candidate",
        reason: "speculative",
        overriddenBy: "u1",
        createdAt: new Date()
      }],
      hasExtractedRequirements: true,
    });
    const f = r.fields.find(f => f.fieldKey === "clientName")!;
    assert.equal(f.status, "MANUAL_OVERRIDE_CONFIRMATION_REQUIRED");
    assert.equal(f.isGrounded, false);
    assert.match(f.blockerReason!, /has a candidate value/);
  });

  it("normalizes dates before comparison", () => {
    const r = resolveCanonicalFieldState({
      tender: baseTender as any,
      overrides: [{
        field: "deadline",
        fieldState: "USER_CONFIRMED",
        overrideValue: "2026-12-01T00:00:00.000Z",
        reason: "date sync",
        overriddenBy: "u1",
        createdAt: new Date()
      }],
      hasExtractedRequirements: true,
    });
    const f = r.fields.find(f => f.fieldKey === "deadline")!;
    assert.equal(f.status, "MANUAL_CONFIRMED"); // Still needs evidence to be EXTRACTED_AND_GROUNDED
  });
});

describe("Generation Readiness Gate - Strict Blocking", () => {
  const validBase = {
    purpose: "generate" as const,
    tenderExistsAndOwned: true,
    activeFileCount: 1,
    extractionFiles: [{ fileId: "f1", corrupted: false, weak: false, hasOverride: false }],
    analysisState: "AI_SUCCEEDED" as const,
    canonicalJobId: "job1",
    latestJobHash: "hash1",
    currentContentHash: "hash1",
    fallbackApprovalBound: false,
    currentHashChunks: [],
    requirementCount: 1,
    requirements: [{ priority: "MANDATORY", sourceTenderFileId: "f1", sourcePageNumber: 1, sourceExactQuote: "Verified quote for requirement", sourceFileActiveInTender: true }],
    criticalMetadataOk: true,
    submissionPlanDocumentCount: 1,
  };

  it("blocks when analysisState is REGEX_FALLBACK_UNAPPROVED", () => {
    const res = evaluateGenerationReadiness({ ...validBase, analysisState: "REGEX_FALLBACK_UNAPPROVED" as any });
    assert.equal(res.ok, false);
    assert.equal(res.blockerCode, "FALLBACK_UNAPPROVED");
  });

  it("blocks when analysisState is HUMAN_APPROVED_FALLBACK", () => {
    const res = evaluateGenerationReadiness({ ...validBase, analysisState: "HUMAN_APPROVED_FALLBACK" as any });
    assert.equal(res.ok, false);
    assert.equal(res.blockerCode, "FALLBACK_NOT_ALLOWED");
  });

  it("blocks when extraction is corrupted", () => {
    const res = evaluateGenerationReadiness({ ...validBase, extractionFiles: [{ fileId: "f1", corrupted: true, weak: false, hasOverride: true }] });
    assert.equal(res.ok, false);
    assert.equal(res.blockerCode, "EXTRACTION_CORRUPTED");
  });

  it("blocks when metadata contamination is present (criticalMetadataOk=false)", () => {
    const res = evaluateGenerationReadiness({ ...validBase, criticalMetadataOk: false });
    assert.equal(res.ok, false);
    assert.equal(res.blockerCode, "METADATA_CRITICAL_FIELD_INVALID");
  });

  it("blocks when mandatory requirement is ungrounded (missing quote)", () => {
    const res = evaluateGenerationReadiness({ ...validBase, requirements: [{ priority: "MANDATORY", sourceTenderFileId: "f1", sourcePageNumber: 1, sourceExactQuote: "", sourceFileActiveInTender: true }] });
    assert.equal(res.ok, false);
    assert.equal(res.blockerCode, "REQUIREMENT_SOURCE_UNGROUNDED");
  });

  it("blocks when tender ownership is missing", () => {
    const res = evaluateGenerationReadiness({ ...validBase, tenderExistsAndOwned: false });
    assert.equal(res.ok, false);
    assert.equal(res.blockerCode, "OWNERSHIP_TENDER_NOT_FOUND");
  });
});

describe("Submission Plan & Export Gates", () => {
  const validBase = {
    purpose: "export" as const,
    tenderExistsAndOwned: true,
    activeFileCount: 1,
    extractionFiles: [{ fileId: "f1", corrupted: false, weak: false, hasOverride: false }],
    analysisState: "AI_SUCCEEDED" as const,
    canonicalJobId: "job1",
    latestJobHash: "hash1",
    currentContentHash: "hash1",
    fallbackApprovalBound: false,
    currentHashChunks: [],
    requirementCount: 1,
    requirements: [{ priority: "MANDATORY", sourceTenderFileId: "f1", sourcePageNumber: 1, sourceExactQuote: "Verified quote for requirement", sourceFileActiveInTender: true }],
    criticalMetadataOk: true,
    submissionPlanDocumentCount: 1,
  };

  it("blocks generation when Build Plan is missing (count 0)", () => {
    const res = evaluateGenerationReadiness({ ...validBase, submissionPlanDocumentCount: 0, purpose: "generate" });
    assert.equal(res.ok, false);
    assert.equal(res.blockerCode, "SUBMISSION_PLAN_MISSING");
  });
});

describe("Generation Readiness Gate - Additional Failure Conditions", () => {
  const validBase = {
    purpose: "generate" as const,
    tenderExistsAndOwned: true,
    activeFileCount: 1,
    extractionFiles: [{ fileId: "f1", corrupted: false, weak: false, hasOverride: false }],
    analysisState: "AI_SUCCEEDED" as const,
    canonicalJobId: "job1",
    latestJobHash: "hash1",
    currentContentHash: "hash1",
    fallbackApprovalBound: false,
    currentHashChunks: [],
    requirementCount: 1,
    requirements: [{ priority: "MANDATORY", sourceTenderFileId: "f1", sourcePageNumber: 1, sourceExactQuote: "Verified quote for requirement", sourceFileActiveInTender: true }],
    criticalMetadataOk: true,
    submissionPlanDocumentCount: 1,
  };

  it("blocks when analysisState is PARTIAL_NEEDS_RESUME", () => {
    const res = evaluateGenerationReadiness({ ...validBase, analysisState: "PARTIAL_NEEDS_RESUME" as any });
    assert.equal(res.ok, false);
    assert.equal(res.blockerCode, "ANALYSIS_NOT_READY");
  });

  it("blocks when analysisState is FAILED", () => {
    const res = evaluateGenerationReadiness({ ...validBase, analysisState: "FAILED" as any });
    assert.equal(res.ok, false);
    assert.equal(res.blockerCode, "ANALYSIS_NOT_READY");
  });

  it("blocks when analysisState is OCR_REQUIRED", () => {
    const res = evaluateGenerationReadiness({ ...validBase, analysisState: "OCR_REQUIRED" as any });
    assert.equal(res.ok, false);
    assert.equal(res.blockerCode, "ANALYSIS_NOT_READY");
  });

  it("blocks when hash mismatch is present", () => {
    const res = evaluateGenerationReadiness({ ...validBase, currentContentHash: "new-hash" });
    assert.equal(res.ok, false);
    assert.equal(res.blockerCode, "ANALYSIS_HASH_MISMATCH");
  });

  it("blocks when weak extraction has no override", () => {
    const res = evaluateGenerationReadiness({ ...validBase, extractionFiles: [{ fileId: "f1", corrupted: false, weak: true, hasOverride: false }] });
    assert.equal(res.ok, false);
    assert.equal(res.blockerCode, "EXTRACTION_WEAK_NO_OVERRIDE");
  });
});
