import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { getCanonicalTenderWorkflowState } from "../lib/engine/workflow/workflow-state";

describe("Comprehensive Workflow Regression Scenarios", () => {
  const baseTender = {
    id: "t1",
    userId: "u1",
    updatedAt: new Date(),
    stage: "ACTIVE",
    status: "ACTIVE",
    title: "Project Alpha",
    clientName: "Client A",
    reference: "REF-001",
    files: [{ extractionScore: 90, totalPages: 5, extractedPages: 5, ocrPages: 0, failedPages: 0 }],
    requirements: [],
    generatedDocuments: [],
    complianceGaps: [],
    analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED",
    analysisSource: "AI",
  };

  it("Scenario 1: No files blocks analysis", async () => {
    const tender = { ...baseTender, files: [] };
    const mockPrisma = { tender: { findFirst: async () => tender } };
    const state = await getCanonicalTenderWorkflowState(mockPrisma as any, "u1", "t1");
    assert.equal(state.nextAction, "UPLOAD_TENDER");
  });

  it("Scenario 2: Corrupt extraction blocks analysis", async () => {
    const tender = { ...baseTender, analysisExtractionStatus: "OCR_REQUIRED" };
    const mockPrisma = { tender: { findFirst: async () => tender } };
    const state = await getCanonicalTenderWorkflowState(mockPrisma as any, "u1", "t1");
    assert.equal(state.nextAction, "RUN_OCR");
    assert.equal(state.readyForAnalysis, false);
  });

  it("Scenario 3: OCR-required extraction returns RUN_OCR", async () => {
    const tender = { ...baseTender, analysisExtractionStatus: "OCR_REQUIRED" };
    const mockPrisma = { tender: { findFirst: async () => tender } };
    const state = await getCanonicalTenderWorkflowState(mockPrisma as any, "u1", "t1");
    assert.equal(state.nextAction, "RUN_OCR");
  });

  it("Scenario 4: Partial extraction blocks final generation", async () => {
    const tender = {
        ...baseTender,
        analysisExtractionStatus: "PARTIAL_EXTRACTION_AI_ANALYZED",
        status: "PLAN_APPROVED",
        requirements: [{ priority: "MANDATORY", title: "Req 1", requirementType: "TECHNICAL_PROPOSAL", sourceConfidence: 0.9, sourcePageNumber: 1, exactFileName: "tech.docx" }]
    };
    const mockPrisma = { tender: { findFirst: async () => tender } };
    const state = await getCanonicalTenderWorkflowState(mockPrisma as any, "u1", "t1");
    assert.equal(state.readyForGeneration, true);
    assert.equal(state.readyForExport, false, "Partial extraction must block export");
  });

  it("Scenario 5: Valid extraction permits AI analysis", async () => {
    const tender = { ...baseTender, analysisSource: null };
    const mockPrisma = { tender: { findFirst: async () => tender } };
    const state = await getCanonicalTenderWorkflowState(mockPrisma as any, "u1", "t1");
    assert.equal(state.readyForAnalysis, true);
    assert.equal(state.nextAction, "RUN_AI_ANALYZE");
  });

  it("Scenario 6: Unsafe analysis blocks matching and generation", async () => {
    const tender = {
        ...baseTender,
        analysisSeverity: "UNSAFE",
        requirements: [{ priority: "MANDATORY", title: "Req 1", requirementType: "TECHNICAL_PROPOSAL" }]
    };
    const mockPrisma = { tender: { findFirst: async () => tender } };
    const state = await getCanonicalTenderWorkflowState(mockPrisma as any, "u1", "t1");
    assert.equal(state.readyForMatching, false);
    assert.equal(state.readyForGeneration, false);
  });

  it("Scenario 7: All mandatory requirements must be traced", async () => {
    const tender = {
        ...baseTender,
        requirements: [
            { priority: "MANDATORY", title: "Req 1", requirementType: "TECHNICAL_PROPOSAL", sourceConfidence: 0.9, sourcePageNumber: 1 },
            { priority: "MANDATORY", title: "Req 2", requirementType: "TECHNICAL_PROPOSAL", sourceConfidence: 0 }
        ]
    };
    const mockPrisma = { tender: { findFirst: async () => tender } };
    const state = await getCanonicalTenderWorkflowState(mockPrisma as any, "u1", "t1");
    assert.equal(state.nextAction, "REVIEW_REQUIREMENTS");
    assert.equal(state.readyForGeneration, false);
  });

  it("Scenario 8: Unresolved critical metadata blocks plan approval", async () => {
    const tender = { ...baseTender, title: "Pr" };
    const mockPrisma = { tender: { findFirst: async () => tender } };
    const state = await getCanonicalTenderWorkflowState(mockPrisma as any, "u1", "t1");
    assert.equal(state.metadataState, "BLOCKED");
    assert.equal(state.nextAction, "EDIT_METADATA");
  });

  it("Scenario 9: Derived draft plan cannot pass final readiness", async () => {
    const tender = {
        ...baseTender,
        requirements: [{ priority: "MANDATORY", title: "Technical Proposal", requirementType: "TECHNICAL_PROPOSAL", sourceConfidence: 0.9, sourcePageNumber: 1 }]
    };
    const mockPrisma = { tender: { findFirst: async () => tender } };
    const state = await getCanonicalTenderWorkflowState(mockPrisma as any, "u1", "t1");
    assert.equal(state.nextAction, "BUILD_SUBMISSION_PLAN");
    assert.equal(state.readyForGeneration, false);
  });

  it("Scenario 10: Canonical approved plan permits generation", async () => {
    const tender = {
        ...baseTender,
        status: "PLAN_APPROVED",
        requirements: [{ priority: "MANDATORY", title: "Technical Proposal", requirementType: "TECHNICAL_PROPOSAL", sourceConfidence: 0.9, sourcePageNumber: 1, exactFileName: "tech.docx" }]
    };
    const mockPrisma = { tender: { findFirst: async () => tender } };
    const state = await getCanonicalTenderWorkflowState(mockPrisma as any, "u1", "t1");
    assert.equal(state.readyForGeneration, true);
  });

  it("Scenario 11: Missing planned document blocks export", async () => {
    const tender = {
        ...baseTender,
        status: "PLAN_APPROVED",
        requirements: [{ priority: "MANDATORY", title: "Technical Proposal", requirementType: "TECHNICAL_PROPOSAL", sourceConfidence: 0.9, sourcePageNumber: 1, exactFileName: "tech.docx" }],
        generatedDocuments: []
    };
    const mockPrisma = { tender: { findFirst: async () => tender } };
    const state = await getCanonicalTenderWorkflowState(mockPrisma as any, "u1", "t1");
    assert.equal(state.nextAction, "GENERATE_DOCUMENTS");
    assert.equal(state.readyForExport, false);
  });

  it("Scenario 12: Extra generated document blocks export", async () => {
    const tender = {
        ...baseTender,
        status: "PLAN_APPROVED",
        requirements: [{ priority: "MANDATORY", title: "Technical Proposal", requirementType: "TECHNICAL_PROPOSAL", sourceConfidence: 0.9, sourcePageNumber: 1, exactFileName: "tech.docx" }],
        generatedDocuments: [
            { name: "Tech", exactFileName: "tech.docx", generationStatus: "GENERATED" },
            { name: "Extra", exactFileName: "extra.docx", generationStatus: "GENERATED" }
        ]
    };
    const mockPrisma = { tender: { findFirst: async () => tender } };
    const state = await getCanonicalTenderWorkflowState(mockPrisma as any, "u1", "t1");
    assert.equal(state.nextAction, "GENERATE_DOCUMENTS");
    assert.equal(state.readyForExport, false);
  });

  it("Scenario 13: Stale analysis versions block export", async () => {
    const tender = {
        ...baseTender,
        status: "PLAN_APPROVED",
        requirements: [{ priority: "MANDATORY", title: "Technical Proposal", requirementType: "TECHNICAL_PROPOSAL", sourceConfidence: 0.9, sourcePageNumber: 1, exactFileName: "tech.docx" }],
        generatedDocuments: [{ name: "Tech", exactFileName: "tech.docx", generationStatus: "GENERATED", contentSummary: JSON.stringify({ analysisHash: "OLD_HASH" }) }]
    };
    const mockPrisma = { tender: { findFirst: async () => tender } };
    const state = await getCanonicalTenderWorkflowState(mockPrisma as any, "u1", "t1");
    assert.equal(state.readyForExport, false, "Stale documents must block export");
  });

  it("Scenario 14: Unresolved critical gap blocks export", async () => {
    const tender = {
        ...baseTender,
        status: "PLAN_APPROVED",
        requirements: [{ priority: "MANDATORY", title: "Technical Proposal", requirementType: "TECHNICAL_PROPOSAL", sourceConfidence: 0.9, sourcePageNumber: 1, exactFileName: "tech.docx" }],
        generatedDocuments: [{ name: "Tech", exactFileName: "tech.docx", generationStatus: "GENERATED" }],
        complianceGaps: [{ severity: "CRITICAL", isResolved: false }]
    };
    const mockPrisma = { tender: { findFirst: async () => tender } };
    const state = await getCanonicalTenderWorkflowState(mockPrisma as any, "u1", "t1");
    tender.generatedDocuments[0].contentSummary = JSON.stringify({ analysisHash: state.analysisVersion });

    const state2 = await getCanonicalTenderWorkflowState(mockPrisma as any, "u1", "t1");
    assert.equal(state2.readyForExport, false);
  });
});
