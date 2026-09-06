import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { getCanonicalTenderWorkflowState } from "../lib/engine/workflow/workflow-state";

describe("Workflow Readiness Scenarios", () => {
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
    notes: "Analysis source: AI (chunked multi-call when tender > 60K chars).",
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
  });

  it("Scenario 3: Unsafe analysis blocks matching and generation", async () => {
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

  it("Scenario 4: Untraced mandatory requirements block generation", async () => {
    const tender = {
        ...baseTender,
        requirements: [{ priority: "MANDATORY", title: "Req 1", requirementType: "TECHNICAL_PROPOSAL", sourceConfidence: 0 }]
    };
    const mockPrisma = { tender: { findFirst: async () => tender } };
    const state = await getCanonicalTenderWorkflowState(mockPrisma as any, "u1", "t1");
    assert.equal(state.nextAction, "RUN_AI_ANALYZE");
    assert.equal(state.readyForGeneration, false);
  });

  it("Scenario 5: Derived draft plan cannot pass final readiness", async () => {
    const tender = {
        ...baseTender,
        requirements: [{ priority: "MANDATORY", title: "Technical Proposal", requirementType: "TECHNICAL_PROPOSAL", sourceConfidence: 0.9, sourcePageNumber: 1 }]
    };
    const mockPrisma = { tender: { findFirst: async () => tender } };
    const state = await getCanonicalTenderWorkflowState(mockPrisma as any, "u1", "t1");
    assert.equal(state.nextAction, "BUILD_SUBMISSION_PLAN");
    assert.equal(state.readyForGeneration, false);
  });
});
