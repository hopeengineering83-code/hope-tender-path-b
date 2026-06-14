import { describe, it } from "node:test";
import assert from "node:assert";
import { resolveNextTenderAction, TenderWorkflowContext } from "../lib/tender-next-action";
import { Tender, TenderRequirement, GeneratedDocument, ComplianceGap, MetadataOverride, TenderFile } from "@prisma/client";

// Mock helper
function createMockContext(overrides: Partial<Tender & {
  requirements: TenderRequirement[];
  generatedDocuments: GeneratedDocument[];
  complianceGaps: ComplianceGap[];
  metadataOverrides: MetadataOverride[];
  files: TenderFile[];
}>): TenderWorkflowContext {
  const tender = {
    id: "tender-1",
    status: "DRAFT",
    stage: "TENDER_INTAKE",
    analysisSummary: null,
    analysisExtractionStatus: null,
    clientName: "Client Name",
    title: "Test Tender",
    country: "US",
    clientContactName: "Contact",
    clientContactEmail: "email@example.com",
    submissionAddress: "Address",
    submissionEmails: "email@example.com",
    submissionMethod: "PORTAL",
    deadline: new Date(Date.now() + 86400000),
    currency: "USD",
    metadataContaminated: false,
    exactFileNaming: '["file.pdf"]',
    requirements: [],
    generatedDocuments: [],
    complianceGaps: [],
    metadataOverrides: [
      { field: "evaluationCriteria", fieldState: "USER_CONFIRMED" },
      { field: "requiredDocuments", fieldState: "USER_CONFIRMED" },
      { field: "pageLimit", fieldState: "USER_CONFIRMED" },
      { field: "bidBondAmount", fieldState: "USER_CONFIRMED" },
      { field: "mandatorySiteVisit", fieldState: "USER_CONFIRMED" },
      { field: "proposalValidity", fieldState: "USER_CONFIRMED" },
      { field: "validityDays", fieldState: "USER_CONFIRMED" },
      { field: "reference", fieldState: "USER_CONFIRMED" },
      { field: "clientContactPhone", fieldState: "USER_CONFIRMED" },
      { field: "budget", fieldState: "USER_CONFIRMED" },
      { field: "numberOfCopiesRequired", fieldState: "USER_CONFIRMED" },
      { field: "preBidMeetingDate", fieldState: "USER_CONFIRMED" },
      { field: "preBidMeetingLocation", fieldState: "USER_CONFIRMED" },
      { field: "clientCity", fieldState: "USER_CONFIRMED" },
      { field: "clientAddress", fieldState: "USER_CONFIRMED" },
      { field: "clientWebsite", fieldState: "USER_CONFIRMED" },
      { field: "submissionEmailSubject", fieldState: "USER_CONFIRMED" },
      { field: "preBidChannel", fieldState: "USER_CONFIRMED" },
      { field: "clientRepresentative", fieldState: "USER_CONFIRMED" },
      { field: "legalClientName", fieldState: "USER_CONFIRMED" },
      { field: "donorAgency", fieldState: "USER_CONFIRMED" },
      { field: "implementingAgency", fieldState: "USER_CONFIRMED" },
      { field: "submissionEndpoint", fieldState: "USER_CONFIRMED" }
    ],
    files: [],
    ...overrides
  } as unknown as Tender & {
    requirements: TenderRequirement[];
    generatedDocuments: GeneratedDocument[];
    complianceGaps: ComplianceGap[];
    metadataOverrides: MetadataOverride[];
    files: TenderFile[];
  };

  return { tender };
}

describe("resolveNextTenderAction", () => {
  it("shows FIX_EXTRACTION when no files exist", () => {
    const ctx = createMockContext({ files: [] });
    const action = resolveNextTenderAction(ctx);
    assert.strictEqual(action.step, "FIX_EXTRACTION");
    assert.strictEqual(action.label, "Fix Extraction First");
  });

  it("shows FIX_EXTRACTION when extraction is corrupted", () => {
    const ctx = createMockContext({
      files: [{ extractedText: "EXTRACTION_CORRUPTED", extractionScore: 10, totalPages: 1 } as TenderFile]
    });
    const action = resolveNextTenderAction(ctx);
    assert.strictEqual(action.step, "FIX_EXTRACTION");
    assert.ok(action.blockers.includes("Extracted text is corrupted"));
  });

  it("shows FIX_EXTRACTION when score is low", () => {
    const ctx = createMockContext({
      files: [{ extractedText: "Some text", extractionScore: 30, totalPages: 1, extractedPages: 1 } as TenderFile]
    });
    const action = resolveNextTenderAction(ctx);
    assert.strictEqual(action.step, "FIX_EXTRACTION");
    assert.ok(action.blockers.some(b => b.includes("Average extraction score 30/100")));
  });

  it("shows RUN_AI_ANALYZE when extraction is good but analysis missing", () => {
    const ctx = createMockContext({
      files: [{ extractedText: "Valid text".repeat(20), extractionScore: 90, extractedPages: 10, totalPages: 10, extractionMethod: "text" } as TenderFile]
    });
    const action = resolveNextTenderAction(ctx);
    assert.strictEqual(action.step, "RUN_AI_ANALYZE");
    assert.strictEqual(action.label, "Run AI Analyze");
  });

  it("shows RESUME_AI_ANALYZE when status is AI_ANALYSIS_PARTIAL", () => {
    const ctx = createMockContext({
      status: "AI_ANALYSIS_PARTIAL",
      files: [{ extractedText: "Valid text".repeat(20), extractionScore: 90, extractedPages: 10, totalPages: 10, extractionMethod: "text" } as TenderFile]
    });
    const action = resolveNextTenderAction(ctx);
    assert.strictEqual(action.step, "RESUME_AI_ANALYZE");
    assert.strictEqual(action.label, "Resume AI Analyze");
  });

  it("shows RUN_AI_ANALYZE with re-extract wording when regex fallback exists", () => {
    const ctx = createMockContext({
      analysisSummary: "Some summary",
      analysisExtractionStatus: "REGEX_FALLBACK_FROM_WEAK_EXTRACTION",
      files: [{ extractedText: "Valid text".repeat(20), extractionScore: 90, extractedPages: 10, totalPages: 10, extractionMethod: "text" } as TenderFile]
    });
    const action = resolveNextTenderAction(ctx);
    assert.strictEqual(action.step, "RUN_AI_ANALYZE");
    assert.strictEqual(action.label, "Run OCR / Re-extract before AI Analyze");
  });

  it("shows EDIT_METADATA when critical fields missing", () => {
    const ctx = createMockContext({
      analysisSummary: "Summary",
      analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED",
      clientName: null,
      files: [{ extractedText: "Valid text".repeat(20), extractionScore: 90, extractedPages: 10, totalPages: 10, extractionMethod: "text" } as TenderFile],
      requirements: [{ id: "req-1", priority: "MANDATORY", sourceConfidence: 0.9 } as TenderRequirement]
    });
    const action = resolveNextTenderAction(ctx);
    assert.strictEqual(action.step, "EDIT_METADATA");
    assert.strictEqual(action.label, "Edit Metadata");
  });

  it("shows REVIEW_REQUIREMENTS when requirements untraced", () => {
    const ctx = createMockContext({
      analysisSummary: "Summary",
      analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED",
      files: [{ extractedText: "Valid text".repeat(20), extractionScore: 90, extractedPages: 10, totalPages: 10, extractionMethod: "text" } as TenderFile],
      requirements: [{ id: "req-1", priority: "MANDATORY", sourceConfidence: 0 } as TenderRequirement]
    });
    const action = resolveNextTenderAction(ctx);
    assert.strictEqual(action.step, "REVIEW_REQUIREMENTS");
  });

  it("shows BUILD_SUBMISSION_PLAN when plan is empty", () => {
    const ctx = createMockContext({
      analysisSummary: "Summary",
      analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED",
      files: [{ extractedText: "Valid text".repeat(20), extractionScore: 90, extractedPages: 10, totalPages: 10, extractionMethod: "text" } as TenderFile],
      requirements: [{ id: "req-1", priority: "MANDATORY", sourceConfidence: 0.9, sourcePageNumber: 1, sourceExactQuote: "quote" } as TenderRequirement],
      exactFileNaming: "[]"
    });
    const action = resolveNextTenderAction(ctx);
    assert.strictEqual(action.step, "BUILD_SUBMISSION_PLAN");
  });

  it("shows GENERATE_DOCUMENTS when everything ready but no docs", () => {
    const ctx = createMockContext({
      analysisSummary: "Summary",
      analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED",
      files: [{ extractedText: "Valid text".repeat(20), extractionScore: 90, extractedPages: 10, totalPages: 10, extractionMethod: "text" } as TenderFile],
      requirements: [{ id: "req-1", priority: "MANDATORY", sourceConfidence: 0.9, sourcePageNumber: 1, sourceExactQuote: "quote" } as TenderRequirement],
      exactFileNaming: '["file.pdf"]',
      generatedDocuments: []
    });
    const action = resolveNextTenderAction(ctx);
    assert.strictEqual(action.step, "GENERATE_DOCUMENTS");
    assert.strictEqual(action.color, "green");
  });

  it("shows FIX_EXPORT_BLOCKERS when compliance gaps exist", () => {
    const ctx = createMockContext({
      analysisSummary: "Summary",
      analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED",
      files: [{ extractedText: "Valid text".repeat(20), extractionScore: 90, extractedPages: 10, totalPages: 10, extractionMethod: "text" } as TenderFile],
      requirements: [{ id: "req-1", priority: "MANDATORY", sourceConfidence: 0.9, sourcePageNumber: 1, sourceExactQuote: "quote" } as TenderRequirement],
      exactFileNaming: '["file.pdf"]',
      generatedDocuments: [{ id: "doc-1", generationStatus: "GENERATED", validationStatus: "PASSED" } as GeneratedDocument],
      complianceGaps: [{ id: "gap-1" } as ComplianceGap]
    });
    const action = resolveNextTenderAction(ctx);
    assert.strictEqual(action.step, "FIX_EXPORT_BLOCKERS");
  });

  it("shows EXPORT_READY when all clear", () => {
    const ctx = createMockContext({
      analysisSummary: "Summary",
      analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED",
      files: [{ extractedText: "Valid text".repeat(20), extractionScore: 90, extractedPages: 10, totalPages: 10, extractionMethod: "text" } as TenderFile],
      requirements: [{ id: "req-1", priority: "MANDATORY", sourceConfidence: 0.9, sourcePageNumber: 1, sourceExactQuote: "quote" } as TenderRequirement],
      exactFileNaming: '["file.pdf"]',
      generatedDocuments: [{ id: "doc-1", generationStatus: "GENERATED", validationStatus: "PASSED" } as GeneratedDocument],
      complianceGaps: []
    });
    const action = resolveNextTenderAction(ctx);
    assert.strictEqual(action.step, "EXPORT_READY");
    assert.strictEqual(action.color, "green");
  });
});
