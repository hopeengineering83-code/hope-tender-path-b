import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isExtractionAcceptableForExport, isExtractionAcceptableForGeneration } from "../lib/engine/quality/extraction-quality-gate";
import { assessTenderMetadataCompleteness } from "../lib/engine/metadata/tender-metadata-completeness";
import { runAuthorityReview } from "../lib/engine/quality/authority-review";
import { computeReadinessScore } from "../lib/engine/readiness/readiness-scoring";
import { buildSubmissionPlanWithDerivedFallback, hasExplicitSubmissionScope, findMissingGeneratedDocuments, findExtraGeneratedDocuments } from "../lib/engine/plans/submission-plan";
import { validateDocumentQuality } from "../lib/engine/quality/document-quality-validator";

describe("Tender Workflow E2E Gates Regression Pack", () => {

  describe("Extraction Quality Gates", () => {
    it("should block generation if extraction is unacceptable (e.g. corrupted fixture)", () => {
      // simulate corrupted-extraction.md result
      const files = [{ extractionScore: 0, totalPages: 0, extractedPages: 0, ocrPages: 0, failedPages: 1 }];
      assert.equal(isExtractionAcceptableForGeneration(files as any), false, "Generation should be blocked for corrupted extraction");
    });

    it("should block export if extraction is unacceptable", () => {
      const files = [{ extractionScore: 20, totalPages: 50, extractedPages: 10, ocrPages: 0, failedPages: 5 }];
      assert.equal(isExtractionAcceptableForExport(files as any), false, "Export should be blocked for poor extraction");
    });

    it("should allow export for good extraction (e.g. water-sanitation-tender.md)", () => {
      const files = [{ extractionScore: 95, totalPages: 10, extractedPages: 10, ocrPages: 0, failedPages: 0 }];
      assert.equal(isExtractionAcceptableForExport(files as any), true, "Export should be allowed for clean extraction");
    });
  });

  describe("Metadata Readiness Gates", () => {
    it("should block if critical metadata is missing", () => {
      const tender = { title: "", clientName: null, tenderCategory: "Work" };
      const result = assessTenderMetadataCompleteness(tender as any);
      assert.ok(result.missingCritical.some(f => f.field === "title"), "Title should be flagged as missing critical");
      assert.ok(result.blockingForGeneration, "Metadata should not be ready");
    });

    it("should block if metadata contains placeholders", () => {
      const tender = { title: "Test Tender", clientName: "[TBC] Bid Team to confirm", tenderCategory: "Service" };
      const result = assessTenderMetadataCompleteness(tender as any);
      assert.equal(result.placeholderCount, 1, "Should detect 1 placeholder");
      assert.ok(result.blockingForGeneration, "Metadata should not be ready due to placeholders");
    });
  });

  describe("Build Plan Gates", () => {
    it("should detect explicit submission scope if file naming/order is present", () => {
      const tender = {
        exactFileNaming: "[\"Tech.docx\"]",
        exactFileOrder: null,
        requirements: []
      };
      assert.equal(hasExplicitSubmissionScope(tender as any), true);
    });

    it("should NOT have explicit scope if everything is null", () => {
      const tender = {
        exactFileNaming: null,
        exactFileOrder: null,
        requirements: []
      };
      assert.equal(hasExplicitSubmissionScope(tender as any), false);
    });

    it("should create derived plan rows from requirements keywords", () => {
      const tender = {
        title: "Construction Project",
        tenderCategory: "Work",
        requirements: [
          { id: "r1", title: "Requirement", description: "Technical methodology approach", requirementType: "OTHER" }
        ]
      };
      const plan = buildSubmissionPlanWithDerivedFallback(tender as any);
      const docTypes = plan.files.map(f => f.documentType);
      assert.ok(docTypes.includes("TECHNICAL_PROPOSAL"), "Should derive Technical Proposal");
    });

    it("should identify missing and extra documents relative to the plan", () => {
        const plan = {
            files: [
                { exactFileName: "Required1.docx", required: true },
                { exactFileName: "Required2.docx", required: true }
            ]
        };
        const generated = [
            { exactFileName: "Required1.docx", generationStatus: "GENERATED" },
            { exactFileName: "Extra.docx", generationStatus: "GENERATED" }
        ];

        const missing = findMissingGeneratedDocuments(plan as any, generated as any);
        const extra = findExtraGeneratedDocuments(plan as any, generated as any);

        assert.equal(missing.length, 1);
        assert.equal(missing[0].exactFileName, "Required2.docx");
        assert.equal(extra.length, 1);
        assert.equal(extra[0].exactFileName, "Extra.docx");
    });
  });

  describe("Document Quality & Generation Gates", () => {
    it("should block documents with placeholders or AI traces", () => {
      const doc = {
        name: "Proposal",
        documentType: "TECHNICAL_PROPOSAL",
        fileContent: "As an AI language model, I recommend [insert client name]."
      };
      const result = validateDocumentQuality(doc as any);
      assert.equal(result.status, "BLOCKED");
      assert.ok(result.aiTrace);
      assert.ok(result.placeholders.length > 0);
    });

    it("should block if envelope mismatch (financial in technical)", () => {
      const doc = {
        name: "Technical Proposal",
        documentType: "TECHNICAL_PROPOSAL",
        fileContent: "Our total price is 00,000."
      };
      const result = validateDocumentQuality(doc as any);
      assert.equal(result.status, "BLOCKED");
      assert.ok(result.envelopeMismatch);
    });
  });

  describe("Authority Review Blocker", () => {
    it("should block if authority score is low", () => {
      const docs = [{ id: "1", name: "Doc 1", documentType: "TECHNICAL_PROPOSAL", contentSummary: "Short text" }];
      const manifest = [{ exactFileName: "Required.docx", documentType: "TENDER_REQUIRED_FILE" }];
      const requiredSections = ["Project Title"];
      const result = runAuthorityReview(docs as any, manifest as any, requiredSections);
      assert.notEqual(result.status, "AUTHORITY_READY", "Authority Review should not be ready with low score/missing docs");
    });
  });

  describe("Readiness Scoring Gates", () => {
    it("should cap score if finalExportGateOk is false", () => {
      const result = computeReadinessScore({
        analysisSource: "AI",
        metadataCompletenessRatio: 1.0,
        metadataInvalidCount: 0,
        sourceReferenceCoverage: 1.0,
        evidenceCoverage: 1.0,
        reviewedSelectionsPresent: true,
        matchingScore: 100,
        complianceMatrixCoverage: 1.0,
        requiredDocumentsTotal: 5,
        requiredDocumentsSatisfied: 5,
        outsidePlanDocuments: 0,
        qualityFailedDocuments: 0,
        finalExportCandidatesCount: 5,
        readyForExportCount: 5,
        finalExportGateOk: false // HARD BLOCK
      });
      assert.ok(result.score <= 99, "Readiness score should be capped if export gate is not OK");
    });

    it("should cap score significantly if metadata is missing", () => {
      const result = computeReadinessScore({
        analysisSource: "AI",
        metadataCompletenessRatio: 0.2, // Poor metadata
        metadataInvalidCount: 1,
        sourceReferenceCoverage: 1.0,
        evidenceCoverage: 1.0,
        requiredDocumentsTotal: 5,
        requiredDocumentsSatisfied: 5,
        outsidePlanDocuments: 0,
        qualityFailedDocuments: 0,
        finalExportCandidatesCount: 5,
        readyForExportCount: 5,
        finalExportGateOk: true
      });
      assert.ok(result.score <= 60, "Readiness score should be capped at 60 for missing/invalid metadata");
      assert.equal(result.appliedCap?.dimension, "metadataCompleteness");
    });
  });

  describe("Server-Side Gate Presence Checks", () => {
    it("Generate route must check for EMPTY_VAULT", async () => {
      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      const src = readFileSync(resolve(process.cwd(), "app/api/tenders/[id]/generate/route.ts"), "utf8");

      assert.ok(src.includes("errorCode: \"EMPTY_VAULT\""), "Generate route must check for empty vault");
      assert.ok(src.includes("vaultReviewedExpertCount === 0 && vaultReviewedProjectCount === 0"), "Empty vault gate logic must be present");
    });

    it("PDF route must block if document is not generated", async () => {
      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      const src = readFileSync(resolve(process.cwd(), "app/api/tenders/[id]/download/route.ts"), "utf8");

      assert.ok(src.includes("if (!docs.length) return err(\"No generated documents available for PDF export. Generate documents first.\", 400, { code: \"NO_DOCS_FOR_PDF\" })"), "PDF route must check for generated documents");
    });

    it("Download route must enforce canonical readiness for ZIP exports", async () => {
      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      const src = readFileSync(resolve(process.cwd(), "app/api/tenders/[id]/download/route.ts"), "utf8");

      assert.ok(src.includes("const canonical = await getFinalSubmissionReadiness"), "Download route must check canonical readiness");
      assert.ok(src.includes("if (!canonical.ok)"), "Download route must block if canonical readiness is not OK");
    });

    it("Export route must block on EXTRACTION_QUALITY_INSUFFICIENT", async () => {
      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      const src = readFileSync(resolve(process.cwd(), "app/api/tenders/[id]/export/route.ts"), "utf8");

      assert.ok(src.includes("isExtractionAcceptableForExport(tender.files)"), "Export route must check extraction quality");
      assert.ok(src.includes("code: \"EXTRACTION_QUALITY_INSUFFICIENT\""), "Export route must use correct error code for poor extraction");
    });
  });

  describe("DOCX/PDF Consistency Gates", () => {
    it("PDF route must pick the main technical proposal or target doc specified", async () => {
      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      const src = readFileSync(resolve(process.cwd(), "app/api/tenders/[id]/download/route.ts"), "utf8");

      // Verify target picking logic
      assert.ok(src.includes("target = docId"), "PDF route must respect docId if provided");
      assert.ok(src.includes("/technical.proposal|technical_proposal/i.test"), "PDF route must fallback to technical proposal if docId is null");
    });

    it("PDF route must generate from markdown content", async () => {
       const { readFileSync } = await import("node:fs");
       const { resolve } = await import("node:path");
       const src = readFileSync(resolve(process.cwd(), "app/api/tenders/[id]/download/route.ts"), "utf8");

       assert.ok(src.includes("generateProposalPdf({"), "PDF route must call generateProposalPdf");
       assert.ok(src.includes("markdown,"), "PDF route must pass markdown content to generator");
    });
  });
});
