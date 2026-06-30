import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateGenerationReadiness } from "../lib/engine/generation-readiness-gate";
import { CANONICAL_AI_PROVIDER_ORDER } from "../lib/ai-provider-registry";
import { validateBuildPlanForConfirmation, validateConfirmedPlanDocuments, type BuildPlanItem } from "../lib/engine/build-plan";

describe("Section C release safety", () => {
  const base = {
    purpose: "generate" as const,
    tenderExistsAndOwned: true,
    activeFileCount: 1,
    extractionFiles: [{ fileId: "f1", corrupted: false, weak: false, hasOverride: false }],
    analysisState: "AI_SUCCEEDED" as const,
    canonicalJobId: "job1",
    latestJobHash: "hash",
    currentContentHash: "hash",
    fallbackApprovalBound: false,
    currentHashChunks: [],
    requirementCount: 1,
    requirements: [{ priority: "MANDATORY", sourceTenderFileId: "f1", sourcePageNumber: 1, sourceExactQuote: "meaningful source quote", sourceFileActiveInTender: true }],
    criticalMetadataOk: true,
    hasValidVirtualSubmissionPlan: true,
    exportReadyDocumentCount: 1,
  };

  const planItem: BuildPlanItem = {
    canonicalId: "req-r1",
    exactFileName: "Technical Proposal.docx",
    exactOrder: 1,
    documentType: "TECHNICAL",
    format: "DOCX",
    required: true,
    envelope: "TECHNICAL",
    sourceRequirementIds: ["r1"],
    pageLimit: null,
    templateRequired: false,
    templateSourceFileId: null,
    brandingAllowed: true,
    signatureAllowed: true,
    stampAllowed: true,
    grouping: null,
    notes: null,
  };

  it("blocks release actions when the Build Plan is not current and confirmed", () => {
    const result = evaluateGenerationReadiness({ ...base, hasCurrentConfirmedBuildPlan: false });
    assert.equal(result.ok, false);
    assert.equal(result.blockerCode, "BUILD_PLAN_NOT_CONFIRMED");
  });

  it("permits generation only after all gates including confirmed Build Plan pass", () => {
    const result = evaluateGenerationReadiness({ ...base, hasCurrentConfirmedBuildPlan: true });
    assert.equal(result.ok, true);
  });

  it("blocks export/final ZIP when confirmed-plan documents are missing, extra, empty, or not exact matches", () => {
    const result = evaluateGenerationReadiness({
      ...base,
      purpose: "final-zip",
      hasCurrentConfirmedBuildPlan: true,
      confirmedPlanDocumentsOk: false,
      confirmedPlanDocumentBlockers: ["Required plan file 1 Technical Proposal.docx is missing."],
      exportReadyDocumentCount: 0,
    });
    assert.equal(result.ok, false);
    assert.equal(result.blockerCode, "CONFIRMED_PLAN_DOCUMENTS_INCOMPLETE");
  });

  it("rejects plan confirmation when an item is not in tender-controlled scope", async () => {
    const prisma = {
      tender: {
        findFirst: async () => ({
          id: "t1",
          title: "Tender",
          exactFileNaming: "[]",
          exactFileOrder: "[]",
          pageLimit: null,
          submissionMethod: "email",
          files: [{ id: "f1", deletionStatus: "ACTIVE", extractedText: "This tender requires a meaningful source quote for the technical proposal." }],
          requirements: [{ id: "r1", title: "Technical Proposal", description: "Submit technical proposal", requirementType: "TECHNICAL", priority: "MANDATORY", exactFileName: "Technical Proposal.docx", exactOrder: 1, sourceTenderFileId: "f1", sourcePageNumber: 1, sourceExactQuote: "meaningful source quote" }],
        }),
      },
    };
    const result = await validateBuildPlanForConfirmation(prisma as any, "t1", "u1", [{ ...planItem, exactFileName: "Invented.docx" }]);
    assert.equal(result.ok, false);
    assert.match(result.blockers.join("\n"), /not in current tender-controlled scope|missing from the Build Plan/);
  });

  it("rejects confirmed release documents that are extra, empty, or do not match exact plan order/name/type", async () => {
    const prisma = {
      tender: { findFirst: async () => ({ id: "t1" }) },
      generatedDocument: {
        findMany: async () => ([
          { id: "d1", name: "Technical Proposal.docx", exactFileName: "Technical Proposal.docx", exactOrder: 1, documentType: "TECHNICAL", format: "DOCX", generationStatus: "GENERATED", fileContent: "", storagePath: null, validationStatus: "VALIDATED", reviewStatus: "APPROVED" },
          { id: "d2", name: "Extra.docx", exactFileName: "Extra.docx", exactOrder: 2, documentType: "TECHNICAL", format: "DOCX", generationStatus: "GENERATED", fileContent: "extra", storagePath: null, validationStatus: "VALIDATED", reviewStatus: "APPROVED" },
        ]),
      },
    };
    const result = await validateConfirmedPlanDocuments(prisma as any, "t1", "u1", [planItem]);
    assert.equal(result.ok, false);
    assert.match(result.blockers.join("\n"), /empty|not generated, validated, and approved|not in the confirmed Build Plan/);
  });

  it("keeps Anthropic last in actual automatic runtime fallback", () => {
    assert.deepEqual(CANONICAL_AI_PROVIDER_ORDER, ["gemini", "openrouter", "openai", "groq", "deepseek", "anthropic"]);
  });
});
