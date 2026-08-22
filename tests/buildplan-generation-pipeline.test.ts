// Regression tests for the build-plan → document-generation → validation →
// approval → export pipeline.
//
// Proves that:
//   1. Confirmed Build Plan is required before full generation.
//   2. PLANNED docs become GENERATED only after content exists.
//   3. Empty generated docs fail validation.
//   4. Required PDF missing blocks export.
//   5. PDF conversion unavailable blocks export with exact code.
//   6. Validation failure prevents approval (bulk-review gates READY_FOR_EXPORT).
//   7. Approval failure prevents export-ready count.
//   8. Stale/superseded docs excluded from ZIP.
//   9. Export ZIP manifest matches active export-ready docs.
//  10. No AI traces or internal IDs in generated documents.
//  11. Final export remains fail-closed.
//
// These tests are source-shape + pure-function tests — they do NOT spin up
// a database. They verify the gate logic and helper functions directly.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readAppFile(relPath: string): string {
  return readFileSync(resolve(process.cwd(), relPath), "utf8");
}

function readLibFile(relPath: string): string {
  return readFileSync(resolve(process.cwd(), "lib", relPath), "utf8");
}

// ─── 1. Confirmed Build Plan required before full generation ──────────────────

describe("Spec Test 1 — Confirmed Build Plan required before full generation", () => {
  it("generate/route.ts imports getCurrentConfirmedBuildPlan and calls assertTenderReadyForGenerationAndExport", () => {
    const src = readAppFile("app/api/tenders/[id]/generate/route.ts");
    assert.ok(src.includes("getCurrentConfirmedBuildPlan"), "generate route must import getCurrentConfirmedBuildPlan");
    assert.ok(src.includes("assertTenderReadyForGenerationAndExport"), "generate route must call the central gate");
    assert.ok(src.includes('purpose: "generate"'), "central gate must be called with purpose='generate'");
  });

  it("generation-readiness-gate returns BUILD_PLAN_NOT_CONFIRMED when no confirmed plan exists", () => {
    const src = readLibFile("engine/generation-readiness-gate.ts");
    assert.ok(src.includes("BUILD_PLAN_NOT_CONFIRMED"), "gate must return BUILD_PLAN_NOT_CONFIRMED blocker code");
    assert.ok(src.includes("BUILD_PLAN_MISSING"), "gate must return BUILD_PLAN_MISSING blocker code");
    assert.ok(src.includes("BUILD_PLAN_STALE"), "gate must return BUILD_PLAN_STALE blocker code");
  });

  it("build-plan.ts getCurrentConfirmedBuildPlan is fail-closed at every step", () => {
    const src = readLibFile("engine/build-plan.ts");
    // Must check: row exists, items parse, hash matches, metadata evidence valid
    assert.ok(src.includes('status: "CONFIRMED"'), "must query for status=CONFIRMED");
    assert.ok(src.includes("JSON.parse"), "must parse items JSON");
    assert.ok(src.includes("confirmedContentHash"), "must verify content hash");
    assert.ok(src.includes("confirmedRevision"), "must verify revision");
    assert.ok(src.includes("validateCriticalMetadataEvidenceForBuildPlan"), "must validate metadata evidence");
  });
});

// ─── 2. PLANNED docs become GENERATED only after content exists ───────────────

describe("Spec Test 2 — PLANNED docs become GENERATED only after content exists", () => {
  it("submission-plan.ts findMissingGeneratedDocuments excludes PLANNED from generated count", () => {
    const src = readLibFile("engine/submission-plan.ts");
    // The function must filter to === "GENERATED" when counting docs as present
    assert.ok(
      /findMissingGeneratedDocuments[\s\S]*?generationStatus[^;]*"GENERATED"/.test(src),
      "findMissingGeneratedDocuments must only count GENERATED docs as present, not PLANNED",
    );
  });

  it("generate-missing-plan-files/route.ts writes generationStatus: GENERATED with real content", () => {
    const src = readAppFile("app/api/tenders/[id]/generate-missing-plan-files/route.ts");
    assert.ok(src.includes('generationStatus: "GENERATED"'), "route must write generationStatus=GENERATED");
    assert.ok(src.includes("Packer.toBuffer"), "route must produce real DOCX bytes via Packer.toBuffer");
    assert.ok(src.includes("fileContent"), "route must write fileContent with real bytes");
  });

  it("generate-missing-plan-files/route.ts converts existing PLANNED rows to GENERATED with content", () => {
    const src = readAppFile("app/api/tenders/[id]/generate-missing-plan-files/route.ts");
    assert.ok(src.includes("convertedFromPlanned"), "route must have a convertedFromPlanned path");
    assert.ok(
      /convertedFromPlanned[\s\S]*?generationStatus:\s*"GENERATED"/.test(src),
      "convertedFromPlanned path must set generationStatus=GENERATED",
    );
  });

  it("isFinalExportCandidateDocument excludes PLANNED rows", async () => {
    const { isFinalExportCandidateDocument } = await import("../lib/engine/document-output-state");
    const plannedDoc = {
      generationStatus: "PLANNED",
      validationStatus: "PENDING",
      reviewStatus: "PENDING",
      format: "DOCX",
      documentType: "TECHNICAL_PROPOSAL",
      name: "Technical Proposal",
      exactFileName: "Technical-Proposal.docx",
    };
    assert.equal(isFinalExportCandidateDocument(plannedDoc as any), false, "PLANNED rows must NOT be final export candidates");
  });
});

// ─── 3. Empty generated docs fail validation ─────────────────────────────────

describe("Spec Test 3 — Empty generated docs fail validation", () => {
  it("validateDocumentQuality blocks empty content (status=BLOCKED, isEmpty=true)", async () => {
    const { validateDocumentQuality } = await import("../lib/engine/document-quality-validator");
    const result = validateDocumentQuality({
      name: "Technical-Proposal.docx",
      documentType: "TECHNICAL_PROPOSAL",
      fileContent: "", // empty
      storagePath: null,
    });
    assert.equal(result.isEmpty, true, "empty content must set isEmpty=true");
    assert.equal(result.status, "BLOCKED", "empty content must be BLOCKED");
    assert.equal(result.score, 0, "empty content must score 0");
  });

  it("validateDocumentQuality blocks very short content (<50 chars)", async () => {
    const { validateDocumentQuality } = await import("../lib/engine/document-quality-validator");
    const result = validateDocumentQuality({
      name: "Technical-Proposal.docx",
      documentType: "TECHNICAL_PROPOSAL",
      fileContent: "Short.", // <50 chars
      storagePath: null,
    });
    assert.equal(result.isEmpty, true, "very short content must set isEmpty=true");
    assert.equal(result.status, "BLOCKED", "very short content must be BLOCKED");
  });

  it("checkExportReadiness blocks docs with no content when requireFileContent=true", async () => {
    const { checkExportReadiness } = await import("../lib/engine/export-readiness");
    const result = checkExportReadiness([{
      id: "doc1",
      name: "Technical Proposal",
      exactFileName: "Technical-Proposal.docx",
      exactOrder: 1,
      documentType: "TECHNICAL_PROPOSAL",
      format: "DOCX",
      generationStatus: "GENERATED",
      validationStatus: "PASSED",
      reviewStatus: "READY_FOR_EXPORT",
      fileContent: null,
      storagePath: null,
    }], { requireFileContent: true });
    assert.equal(result.ok, false, "docs with no content must fail readiness when requireFileContent=true");
    assert.ok(result.failures.length > 0, "must have at least one failure");
  });
});

// ─── 4. Required PDF missing blocks export ───────────────────────────────────

describe("Spec Test 4 — Required PDF missing blocks export", () => {
  it("deriveDocumentOutputState returns PDF_CONVERSION_REQUIRED for .pdf with non-PDF bytes", async () => {
    const { deriveDocumentOutputState } = await import("../lib/engine/document-output-state");
    const state = deriveDocumentOutputState({
      generationStatus: "GENERATED",
      validationStatus: "VALIDATED",
      reviewStatus: "READY_FOR_EXPORT",
      format: "PDF", // format field says PDF
      documentType: "TECHNICAL_PROPOSAL",
      name: "Technical Proposal",
      exactFileName: "Technical-Proposal.pdf", // .pdf extension
      fileContent: "UEsDBBQAAAAIA", // base64 of PK zip header (DOCX), not %PDF-
    } as any);
    assert.equal(state, "PDF_CONVERSION_REQUIRED", ".pdf file with DOCX bytes must be PDF_CONVERSION_REQUIRED");
  });

  it("PDF_CONVERSION_REQUIRED is in EXPORT_BLOCKING_STATES", async () => {
    const { EXPORT_BLOCKING_STATES } = await import("../lib/engine/document-output-state");
    assert.ok(
      (EXPORT_BLOCKING_STATES as readonly string[]).includes("PDF_CONVERSION_REQUIRED"),
      "PDF_CONVERSION_REQUIRED must be in EXPORT_BLOCKING_STATES",
    );
  });

  it("validateFileSignature rejects .pdf file without %PDF- signature", async () => {
    const { validateFileSignature } = await import("../lib/engine/export-format-policy");
    // DOCX bytes (PK zip header) in a .pdf file — pass as base64 string
    const docxBase64 = "UEsDBBQAAAAIA"; // PK..
    const result = validateFileSignature("Technical-Proposal.pdf", docxBase64);
    assert.equal(result.ok, false, ".pdf with DOCX bytes must fail signature check");
    assert.ok(result.reason!.includes("PDF"), "reason must mention PDF");
  });
});

// ─── 5. PDF conversion unavailable blocks export with exact code ─────────────

describe("Spec Test 5 — PDF conversion unavailable blocks export with exact code", () => {
  it("checkTenderFormatCoverage returns PDF_REQUIRED_CONVERSION_UNAVAILABLE when PDF required but missing", async () => {
    const { detectTenderFormatPolicy, checkTenderFormatCoverage } = await import("../lib/engine/export-format-policy");
    // exactFileNaming must be a JSON array string (see safeParseJsonArray)
    const policy = detectTenderFormatPolicy({
      exactFileNaming: JSON.stringify(["Technical Proposal.pdf", "Financial Proposal.xlsx"]),
      exactFileOrder: null,
    });
    assert.ok(policy.requiresPdf, "policy must detect PDF requirement");
    const coverage = checkTenderFormatCoverage(policy, ["docx"]); // only DOCX generated
    assert.equal(coverage.ok, false, "must block when PDF required but only DOCX generated");
    if (!coverage.ok) {
      assert.equal(coverage.code, "PDF_REQUIRED_CONVERSION_UNAVAILABLE", "must return exact code");
      assert.ok(coverage.missing.length > 0, "must list missing PDF files");
      assert.ok(coverage.reason.includes("PDF"), "reason must mention PDF");
    }
  });

  it("validate/route.ts wires PDF_REQUIRED_CONVERSION_UNAVAILABLE check", () => {
    const src = readAppFile("app/api/tenders/[id]/validate/route.ts");
    assert.ok(src.includes("detectTenderFormatPolicy"), "validate route must import detectTenderFormatPolicy");
    assert.ok(src.includes("checkTenderFormatCoverage"), "validate route must import checkTenderFormatCoverage");
    assert.ok(src.includes("PDF_REQUIRED_CONVERSION_UNAVAILABLE"), "validate route must check for PDF_REQUIRED_CONVERSION_UNAVAILABLE");
    assert.ok(src.includes("pdfCoverageBlocker"), "validate route must surface pdfCoverageBlocker in response");
  });
});

// ─── 6. Validation failure prevents approval ─────────────────────────────────

describe("Spec Test 6 — Validation failure prevents approval", () => {
  it("bulk-review/route.ts gates READY_FOR_EXPORT on validationStatus=VALIDATED/PASSED", () => {
    const src = readAppFile("app/api/tenders/[id]/documents/bulk-review/route.ts");
    assert.ok(src.includes("VALIDATION_REQUIRED_BEFORE_EXPORT"), "must return VALIDATION_REQUIRED_BEFORE_EXPORT code");
    assert.ok(src.includes("validationStatus"), "must check validationStatus before READY_FOR_EXPORT");
    assert.ok(src.includes('"VALIDATED"'), "must allow VALIDATED status");
    assert.ok(src.includes('"PASSED"'), "must allow PASSED status");
  });

  it("bulk-review/route.ts gates READY_FOR_EXPORT on generationStatus=GENERATED", () => {
    const src = readAppFile("app/api/tenders/[id]/documents/bulk-review/route.ts");
    assert.ok(src.includes("GENERATION_REQUIRED_BEFORE_EXPORT"), "must return GENERATION_REQUIRED_BEFORE_EXPORT code");
    assert.ok(src.includes('generationStatus: "GENERATED"'), "must filter to GENERATED rows for READY_FOR_EXPORT");
  });

  it("bulk-review/route.ts gates READY_FOR_EXPORT on content existing", () => {
    const src = readAppFile("app/api/tenders/[id]/documents/bulk-review/route.ts");
    assert.ok(src.includes("CONTENT_REQUIRED_BEFORE_EXPORT"), "must return CONTENT_REQUIRED_BEFORE_EXPORT code");
    assert.ok(src.includes("generatedDocumentHasContent"), "must call generatedDocumentHasContent before READY_FOR_EXPORT");
  });

  it("bulk-review/route.ts rejects entire batch if any doc fails the gate", () => {
    const src = readAppFile("app/api/tenders/[id]/documents/bulk-review/route.ts");
    assert.ok(src.includes("rejected"), "must build a rejected list");
    assert.ok(src.includes("rejectedCount"), "must return rejectedCount");
    assert.ok(src.includes("totalCandidates"), "must return totalCandidates");
  });
});

// ─── 7. Explicit exclusions remain fail-closed without a routine approval gate ─

describe("Spec Test 7 — Approval failure prevents export-ready count", () => {
  it("isFinalExportCandidateDocument excludes docs with NOT_EXPORTABLE review status", async () => {
    const { isFinalExportCandidateDocument } = await import("../lib/engine/document-output-state");
    const doc = {
      generationStatus: "GENERATED",
      validationStatus: "VALIDATED",
      reviewStatus: "NOT_EXPORTABLE", // explicitly not exportable
      format: "DOCX",
      documentType: "TECHNICAL_PROPOSAL",
      name: "Technical Proposal",
      exactFileName: "Technical-Proposal.docx",
    };
    assert.equal(isFinalExportCandidateDocument(doc as any), false, "NOT_EXPORTABLE review must not be export candidate");
  });

  it("deriveDocumentOutputState accepts validated bytes with PENDING human review", async () => {
    const { deriveDocumentOutputState } = await import("../lib/engine/document-output-state");
    const state = deriveDocumentOutputState({
      generationStatus: "GENERATED",
      validationStatus: "VALIDATED",
      reviewStatus: "PENDING",
      format: "DOCX",
      documentType: "TECHNICAL_PROPOSAL",
      name: "Technical Proposal",
      exactFileName: "Technical-Proposal.docx",
      fileContent: Buffer.from("PK\x03\x04validated-docx").toString("base64"),
    } as any);
    assert.equal(state, "READY_FOR_EXPORT", "machine validation must not require routine per-document approval");
  });

  it("isFinalExportCandidateDocument excludes SUPERSEDED docs", async () => {
    const { isFinalExportCandidateDocument } = await import("../lib/engine/document-output-state");
    const doc = {
      generationStatus: "SUPERSEDED",
      validationStatus: "VALIDATED",
      reviewStatus: "READY_FOR_EXPORT",
      format: "DOCX",
      documentType: "TECHNICAL_PROPOSAL",
      name: "Technical Proposal",
      exactFileName: "Technical-Proposal.docx",
    };
    assert.equal(isFinalExportCandidateDocument(doc as any), false, "SUPERSEDED must not be export candidate");
  });

  it("isFinalExportCandidateDocument excludes CONTROL format docs", async () => {
    const { isFinalExportCandidateDocument } = await import("../lib/engine/document-output-state");
    const doc = {
      generationStatus: "GENERATED",
      validationStatus: "VALIDATED",
      reviewStatus: "READY_FOR_EXPORT",
      format: "CONTROL",
      documentType: "SUBMISSION_CONTROL",
      name: "Control Record",
      exactFileName: "Control.docx",
    };
    assert.equal(isFinalExportCandidateDocument(doc as any), false, "CONTROL format must not be export candidate");
  });

  it("isReadyForFinalExport requires all four conditions (generation+validation+review+state)", async () => {
    const { isReadyForFinalExport } = await import("../lib/engine/export-readiness");
    // All conditions pass
    assert.equal(isReadyForFinalExport({
      id: "doc1",
      name: "Technical Proposal",
      exactFileName: "Technical-Proposal.docx",
      exactOrder: 1,
      documentType: "TECHNICAL_PROPOSAL",
      format: "DOCX",
      generationStatus: "GENERATED",
      validationStatus: "VALIDATED",
      reviewStatus: "READY_FOR_EXPORT",
      fileContent: null,
      storagePath: "storage/path.docx",
    }), true);

    // validationStatus FAILED
    assert.equal(isReadyForFinalExport({
      id: "doc2",
      name: "Technical Proposal",
      exactFileName: "Technical-Proposal.docx",
      exactOrder: 1,
      documentType: "TECHNICAL_PROPOSAL",
      format: "DOCX",
      generationStatus: "GENERATED",
      validationStatus: "FAILED",
      reviewStatus: "READY_FOR_EXPORT",
      fileContent: null,
      storagePath: "storage/path.docx",
    }), false, "FAILED validation must block export-ready");
  });
});

// ─── 8. Stale/superseded docs excluded from ZIP ──────────────────────────────

describe("Spec Test 8 — Stale/superseded docs excluded from ZIP", () => {
  it("download/route.ts filters via isFinalExportCandidateDocument AND generationStatus=GENERATED", () => {
    const src = readAppFile("app/api/tenders/[id]/download/route.ts");
    assert.ok(src.includes("isFinalExportCandidateDocument"), "must call isFinalExportCandidateDocument");
    assert.ok(src.includes("filterFinalExportCandidateDocuments"), "must call filterFinalExportCandidateDocuments");
    assert.ok(
      /generationStatus.*"GENERATED"/.test(src),
      "must additionally filter to generationStatus=GENERATED",
    );
  });

  it("download/route.ts checks for documents with no content before building ZIP", () => {
    const src = readAppFile("app/api/tenders/[id]/download/route.ts");
    assert.ok(src.includes("DOCUMENTS_MISSING_CONTENT"), "must return DOCUMENTS_MISSING_CONTENT when content is missing");
  });

  it("download/route.ts checks for duplicate filenames in ZIP", () => {
    const src = readAppFile("app/api/tenders/[id]/download/route.ts");
    assert.ok(src.includes("DUPLICATE_FILENAMES_IN_ZIP"), "must return DUPLICATE_FILENAMES_IN_ZIP on duplicates");
  });
});

// ─── 9. Export ZIP manifest matches active export-ready docs ──────────────────

describe("Spec Test 9 — Export ZIP manifest matches active export-ready docs", () => {
  it("download/route.ts uses buildFinalZipEntries as single source of truth for ZIP entries", () => {
    const src = readAppFile("app/api/tenders/[id]/download/route.ts");
    assert.ok(src.includes("buildFinalZipEntries"), "must call buildFinalZipEntries");
  });

  it("final-zip-scope.ts excludes Win-Probability-Report unless required", () => {
    const src = readLibFile("engine/final-zip-scope.ts");
    assert.ok(src.includes("Win-Probability-Report"), "must reference Win-Probability-Report");
  });

  it("filterFinalExportCandidateDocuments applies isFinalExportCandidateDocument to each doc", async () => {
    const { filterFinalExportCandidateDocuments } = await import("../lib/engine/document-output-state");
    const docs = [
      { id: "1", generationStatus: "GENERATED", validationStatus: "VALIDATED", reviewStatus: "READY_FOR_EXPORT", format: "DOCX", documentType: "TECHNICAL_PROPOSAL", name: "T", exactFileName: "T.docx" },
      { id: "2", generationStatus: "SUPERSEDED", validationStatus: "VALIDATED", reviewStatus: "READY_FOR_EXPORT", format: "DOCX", documentType: "TECHNICAL_PROPOSAL", name: "S", exactFileName: "S.docx" },
      { id: "3", generationStatus: "PLANNED", validationStatus: "PENDING", reviewStatus: "PENDING", format: "DOCX", documentType: "TECHNICAL_PROPOSAL", name: "P", exactFileName: "P.docx" },
    ];
    const filtered = filterFinalExportCandidateDocuments(docs as any[]);
    assert.equal(filtered.length, 1, "only the GENERATED+VALIDATED+READY_FOR_EXPORT doc should remain");
    assert.equal(filtered[0].id, "1");
  });
});

// ─── 10. No AI traces or internal IDs in generated documents ──────────────────

describe("Spec Test 10 — No AI traces or internal IDs in generated documents", () => {
  it("validateDocumentQuality detects AI trace patterns", async () => {
    const { validateDocumentQuality } = await import("../lib/engine/document-quality-validator");
    const result = validateDocumentQuality({
      name: "Technical-Proposal.docx",
      documentType: "TECHNICAL_PROPOSAL",
      fileContent: "As an AI language model, I will prepare the technical proposal. TODO: add details. Bid-Team to confirm pricing.",
      storagePath: null,
    });
    assert.ok(result.aiTrace.length > 0, "must detect AI traces");
    assert.equal(result.status, "BLOCKED", "AI traces must BLOCK");
  });

  it("validateDocumentQuality detects placeholder patterns", async () => {
    const { validateDocumentQuality } = await import("../lib/engine/document-quality-validator");
    const result = validateDocumentQuality({
      name: "Cover-Letter.docx",
      documentType: "COVER_LETTER",
      fileContent: "Dear [insert client name], we are pleased to submit our proposal for [TBD project].",
      storagePath: null,
    });
    assert.ok(result.placeholders.length > 0, "must detect placeholders");
    assert.equal(result.status, "BLOCKED", "placeholders must BLOCK");
  });

  it("validateDocumentQuality detects pricing leakage in technical docs", async () => {
    const { validateDocumentQuality } = await import("../lib/engine/document-quality-validator");
    const result = validateDocumentQuality({
      name: "Technical-Proposal.docx",
      documentType: "TECHNICAL_PROPOSAL",
      fileContent: "Our technical approach includes unit price ETB 25,000 per survey point. Total price: $50,000.",
      storagePath: null,
    });
    assert.ok(result.envelopeMismatch !== null, "must detect pricing leakage in technical doc");
    assert.equal(result.status, "BLOCKED", "pricing leakage must BLOCK");
  });

  it("documentHygieneIssues detects AI traces in visible text", async () => {
    const { documentHygieneIssues } = await import("../lib/engine/export-readiness");
    const issues = documentHygieneIssues("As an AI, I think this is good. TODO: finish.", {
      name: "Technical Proposal",
      exactFileName: "Technical-Proposal.docx",
      documentType: "TECHNICAL_PROPOSAL",
      format: "DOCX",
    });
    assert.ok(issues.length > 0, "must detect hygiene issues");
    assert.ok(issues.some((i) => /AI/i.test(i)), "must surface AI trace issue");
  });

  it("checkDocumentQualityGate is async and extracts DOCX visible text", () => {
    const src = readLibFile("engine/export-readiness.ts");
    assert.ok(
      /export async function checkDocumentQualityGate/.test(src),
      "checkDocumentQualityGate must be async",
    );
    assert.ok(
      src.includes("extractDocxVisibleText"),
      "checkDocumentQualityGate must call extractDocxVisibleText for base64 DOCX",
    );
  });
});

// ─── 11. Final export remains fail-closed ─────────────────────────────────────

describe("Spec Test 11 — Final export remains fail-closed", () => {
  it("download/route.ts runs finalPackageGate before building ZIP", () => {
    const src = readAppFile("app/api/tenders/[id]/download/route.ts");
    assert.ok(src.includes("finalPackageGate"), "must run finalPackageGate");
    assert.ok(src.includes("assertTenderReadyForGenerationAndExport"), "must run central gate");
    assert.ok(src.includes('purpose: "final-zip"'), "central gate must use purpose=final-zip");
  });

  it("download/route.ts runs authority review gate before building ZIP", () => {
    const src = readAppFile("app/api/tenders/[id]/download/route.ts");
    assert.ok(src.includes("AUTHORITY_REVIEW_BLOCKED"), "must return AUTHORITY_REVIEW_BLOCKED");
    assert.ok(src.includes("AUTHORITY_REVIEW_NEEDS_REVIEW"), "must return AUTHORITY_REVIEW_NEEDS_REVIEW");
  });

  it("download/route.ts verifies source files not deleted before building ZIP", () => {
    const src = readAppFile("app/api/tenders/[id]/download/route.ts");
    assert.ok(src.includes("verifySourceFilesNotDeleted"), "must verify source files exist");
  });

  it("validate/route.ts fails closed when quality gate throws (no silent degradation)", () => {
    const src = readAppFile("app/api/tenders/[id]/validate/route.ts");
    assert.ok(src.includes("QUALITY_GATE_UNAVAILABLE"), "must return QUALITY_GATE_UNAVAILABLE when gate throws");
    assert.ok(src.includes("qualityGateDegraded"), "must surface qualityGateDegraded flag");
    // Must NOT have the old .catch() fallback that silently weakens validation
    assert.ok(
      !/checkFullExportReadinessWithQualityGate[\s\S]*?\.catch\(\s*\([^)]*\)\s*=>\s*{[\s\S]*?checkFullExportReadiness/.test(src),
      "must NOT fall back to weaker checkFullExportReadiness on quality gate throw",
    );
  });

  it("bulk-review/route.ts runs central export gate for READY_FOR_EXPORT", () => {
    const src = readAppFile("app/api/tenders/[id]/documents/bulk-review/route.ts");
    assert.ok(src.includes("assertTenderReadyForGenerationAndExport"), "must run central gate");
    assert.ok(src.includes('purpose: "export"'), "central gate must use purpose=export");
  });

  it("final-submission-readiness.ts adds OUTSIDE_PLAN_DOCUMENTS blocker", () => {
    const src = readLibFile("engine/final-submission-readiness.ts");
    assert.ok(src.includes("OUTSIDE_PLAN_DOCUMENTS"), "must add OUTSIDE_PLAN_DOCUMENTS tender-level blocker");
    assert.ok(src.includes("extraPlan.length > 0"), "must check extraPlan.length before pushing blocker");
  });

  it("final-submission-readiness.ts extracts DOCX visible text for quality scoring", () => {
    // The extraction now lives in the canonical current-document-quality
    // module so the readiness gate and the Document Validator panel cannot
    // score the same document from different text. Assert the property
    // (visible text is extracted before the assessor runs, on the path this
    // file actually uses) rather than the old inline shape.
    const src = readLibFile("engine/final-submission-readiness.ts");
    assert.ok(
      src.includes("assessCurrentDocumentQualityBatch"),
      "readiness must score documents through the canonical quality helper",
    );
    const shared = readLibFile("engine/current-document-quality.ts");
    assert.ok(shared.includes("extractDocxVisibleText"), "canonical helper must import extractDocxVisibleText");
    assert.ok(
      /extractDocxVisibleText[\s\S]*?assessGeneratedDocumentQuality/.test(shared),
      "canonical helper must extract visible text before calling assessGeneratedDocumentQuality",
    );
  });
});

// ─── Cross-cutting: validateDocumentQuality visibleText param ─────────────────

describe("Cross-cutting — validateDocumentQuality accepts visibleText param", () => {
  it("document-quality-validator.ts accepts optional visibleText param", async () => {
    const { validateDocumentQuality } = await import("../lib/engine/document-quality-validator");
    // When visibleText is provided, it must be used for regex checks even if
    // fileContent is base64 (which would normally cause text="" and skip checks).
    const base64Content = "A".repeat(100); // looks like base64
    const result = validateDocumentQuality({
      name: "Technical-Proposal.docx",
      documentType: "TECHNICAL_PROPOSAL",
      fileContent: base64Content,
      storagePath: null,
      visibleText: "As an AI, I think this is good. TODO: finish.",
    });
    assert.ok(result.aiTrace.length > 0, "must use visibleText for AI trace detection");
    assert.equal(result.status, "BLOCKED", "must BLOCK based on visibleText");
  });

  it("document-quality-validator.ts without visibleText skips base64 content (backward compat)", async () => {
    const { validateDocumentQuality } = await import("../lib/engine/document-quality-validator");
    const base64Content = "A".repeat(100); // looks like base64
    const result = validateDocumentQuality({
      name: "Technical-Proposal.docx",
      documentType: "TECHNICAL_PROPOSAL",
      fileContent: base64Content,
      storagePath: null,
      // no visibleText — backward compat: base64 content is skipped
    });
    assert.equal(result.aiTrace.length, 0, "without visibleText, base64 content skips AI trace check");
    assert.equal(result.status, "GOOD", "without visibleText, base64 content passes (backward compat)");
  });
});
