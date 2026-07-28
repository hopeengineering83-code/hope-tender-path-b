// Tests for lib/engine/workflow/pdf-finalizer.ts and its wiring —
// required-PDF finalization must be fail-closed: real conversion capability,
// real extracted content, quality-gated, %PDF-validated bytes, exact required
// filenames, and structured safe public errors (never raw String(err)).

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  checkPdfConversionCapability,
  finalizeRequiredPdf,
  internalArtifactIssues,
  isBase64PdfContent,
  normalizeFileBaseName,
  resolveRequiredPdfFileName,
  validatePdfBytes,
} from "../lib/engine/workflow/pdf-finalizer";
import { assembleFinalSubmissionZip } from "../lib/engine/final-zip-assembly";

async function makeDocxBase64(bodyText: string): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${bodyText}</w:t></w:r></w:p></w:body></w:document>`,
  );
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  return buffer.toString("base64");
}

const GOOD_TEXT =
  "Our methodology delivers water and sanitation infrastructure across three districts. " +
  "The implementation plan covers mobilization, drilling supervision, community training, and handover over twelve months. " +
  "Quality assurance follows the national standards and the supervising engineer signs off each milestone before the next phase begins.";

function sourceDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: "doc-1",
    name: "Technical Proposal",
    exactFileName: "Technical Proposal.docx",
    documentType: "TECHNICAL_PROPOSAL",
    format: "DOCX",
    generationStatus: "GENERATED",
    validationStatus: "VALIDATED",
    reviewStatus: "READY_FOR_EXPORT",
    fileContent: null as string | null,
    storagePath: null as string | null,
    ...overrides,
  };
}

const TENDER = { title: "Water Supply Works", clientName: "Ministry of Water", reference: "MoW/2026/17" };

describe("pdf-finalizer — fail-closed required-PDF finalization", () => {
  describe("stub regression — the old fake-success patterns are gone", () => {
    it("module no longer simulates conversion availability, uses placeholder body, or leaks String(err)", () => {
      const src = readFileSync(resolve(process.cwd(), "lib/engine/workflow/pdf-finalizer.ts"), "utf8");
      assert.ok(!src.includes("conversionAvailable"), "simulated conversionAvailable flag must be gone");
      assert.ok(!src.includes("Empty Proposal Content"), "placeholder PDF body must be gone");
      assert.ok(!src.includes("String(err"), "raw String(err) must never be returned");
      assert.ok(!src.includes("contentSummary ||"), "contentSummary fallback body must be gone");
      assert.ok(!/error\.message|err\.message/.test(src), "raw error.message must never be returned");
      assert.ok(!/\bmetadata\b/i.test(src), "no user-facing 'metadata' wording");
    });
  });

  describe("conversion capability is a real deterministic check", () => {
    it("rejects a source with no content bytes", () => {
      const cap = checkPdfConversionCapability(sourceDoc({ fileContent: null }));
      assert.equal(cap.ok, false);
      if (!cap.ok) assert.equal(cap.code, "PDF_REQUIRED_CONVERSION_UNAVAILABLE");
    });

    it("rejects non-DOCX content (plain text pretending to be a DOCX)", () => {
      const cap = checkPdfConversionCapability(sourceDoc({ fileContent: "just some plain text, not a zip archive at all" }));
      assert.equal(cap.ok, false);
      if (!cap.ok) assert.equal(cap.code, "PDF_REQUIRED_CONVERSION_UNAVAILABLE");
    });

    it("rejects unsupported source types (xlsx)", async () => {
      const base64 = await makeDocxBase64(GOOD_TEXT); // PK bytes but .xlsx name
      const cap = checkPdfConversionCapability(sourceDoc({ exactFileName: "Rates.xlsx", name: "Rates", fileContent: base64 }));
      assert.equal(cap.ok, false);
      if (!cap.ok) assert.equal(cap.code, "PDF_REQUIRED_CONVERSION_UNAVAILABLE");
    });

    it("accepts a real base64 DOCX", async () => {
      const cap = checkPdfConversionCapability(sourceDoc({ fileContent: await makeDocxBase64(GOOD_TEXT) }));
      assert.equal(cap.ok, true);
    });
  });

  describe("happy path — real content in, valid PDF out with the exact required filename", () => {
    it("extracts DOCX text, renders a %PDF, and uses the exact required filename", async () => {
      const result = await finalizeRequiredPdf({
        requiredFileName: "Technical Proposal.pdf",
        tender: TENDER,
        sourceDocument: sourceDoc({ fileContent: await makeDocxBase64(GOOD_TEXT) }),
      });
      assert.equal(result.ok, true, JSON.stringify(result));
      if (result.ok) {
        assert.equal(result.fileName, "Technical Proposal.pdf", "must use the exact required filename");
        assert.ok(result.bytes.length > 0, "PDF bytes must be non-empty");
        assert.equal(result.bytes.subarray(0, 4).toString("latin1"), "%PDF", "bytes must start with %PDF");
        assert.ok(result.extractedCharCount > 100, "must report real extracted text length");
        assert.equal(result.sourceDocumentId, "doc-1");
      }
    });
  });

  describe("source eligibility — validation/approval/current-revision are enforced", () => {
    it("rejects a superseded source", async () => {
      const result = await finalizeRequiredPdf({
        requiredFileName: "Technical Proposal.pdf",
        tender: TENDER,
        sourceDocument: sourceDoc({ generationStatus: "SUPERSEDED", fileContent: await makeDocxBase64(GOOD_TEXT) }),
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "PDF_SOURCE_NOT_ELIGIBLE");
    });

    it("rejects an unvalidated source", async () => {
      const result = await finalizeRequiredPdf({
        requiredFileName: "Technical Proposal.pdf",
        tender: TENDER,
        sourceDocument: sourceDoc({ validationStatus: "PENDING", fileContent: await makeDocxBase64(GOOD_TEXT) }),
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "PDF_SOURCE_NOT_VALIDATED");
    });

    it("rejects a validated-but-unapproved source", async () => {
      const result = await finalizeRequiredPdf({
        requiredFileName: "Technical Proposal.pdf",
        tender: TENDER,
        sourceDocument: sourceDoc({ reviewStatus: "PENDING", fileContent: await makeDocxBase64(GOOD_TEXT) }),
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "PDF_SOURCE_NOT_APPROVED");
    });

    it("rejects a PLANNED source", async () => {
      const result = await finalizeRequiredPdf({
        requiredFileName: "Technical Proposal.pdf",
        tender: TENDER,
        sourceDocument: sourceDoc({ generationStatus: "PLANNED", fileContent: await makeDocxBase64(GOOD_TEXT) }),
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "PDF_SOURCE_NOT_ELIGIBLE");
    });
  });

  describe("content safety — empty/placeholder/AI-trace/leakage/internal artifacts are rejected", () => {
    it("rejects an empty-bodied DOCX", async () => {
      const result = await finalizeRequiredPdf({
        requiredFileName: "Technical Proposal.pdf",
        tender: TENDER,
        sourceDocument: sourceDoc({ fileContent: await makeDocxBase64("") }),
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "PDF_SOURCE_TEXT_EMPTY");
    });

    it("rejects the legacy placeholder body text", async () => {
      const result = await finalizeRequiredPdf({
        requiredFileName: "Technical Proposal.pdf",
        tender: TENDER,
        sourceDocument: sourceDoc({ fileContent: await makeDocxBase64("Empty Proposal Content") }),
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "PDF_SOURCE_TEXT_EMPTY");
    });

    it("rejects placeholder drafting instructions", async () => {
      const text = "[INSERT COMPANY NAME] will deliver the methodology and approach across all districts with a strong implementation plan and dedicated supervision staff.";
      const result = await finalizeRequiredPdf({
        requiredFileName: "Technical Proposal.pdf",
        tender: TENDER,
        sourceDocument: sourceDoc({ fileContent: await makeDocxBase64(text) }),
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "PDF_QUALITY_BLOCKED");
    });

    it("rejects AI trace text", async () => {
      const text = "As an AI language model, I have prepared this methodology section describing the technical approach in detail for the client and the supervising engineer.";
      const result = await finalizeRequiredPdf({
        requiredFileName: "Technical Proposal.pdf",
        tender: TENDER,
        sourceDocument: sourceDoc({ fileContent: await makeDocxBase64(text) }),
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "PDF_QUALITY_BLOCKED");
    });

    it("rejects financial/pricing leakage in a technical document", async () => {
      const text = "Our approach to implementation is robust and well supervised. The total price is 450,000 USD for the full scope of work delivered across all districts.";
      const result = await finalizeRequiredPdf({
        requiredFileName: "Technical Proposal.pdf",
        tender: TENDER,
        sourceDocument: sourceDoc({ fileContent: await makeDocxBase64(text) }),
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "PDF_QUALITY_BLOCKED");
    });

    it("rejects raw internal JSON / record identifiers", async () => {
      const text = 'The export record contains "tenderId": "abc12345-6789-4abc-8def-123456789abc" along with several other internal fields describing the submission state in raw form.';
      const result = await finalizeRequiredPdf({
        requiredFileName: "Technical Proposal.pdf",
        tender: TENDER,
        sourceDocument: sourceDoc({ fileContent: await makeDocxBase64(text) }),
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "PDF_QUALITY_BLOCKED");
    });

    it("internalArtifactIssues flags stack traces and SQL, passes clean prose", () => {
      assert.ok(internalArtifactIssues("Error at handler (/app/lib/engine/x.ts:10)  at run (node:internal/foo)").length > 0);
      assert.ok(internalArtifactIssues('SELECT id, name FROM "GeneratedDocument" WHERE x = 1').length > 0);
      assert.equal(internalArtifactIssues(GOOD_TEXT).length, 0);
    });
  });

  describe("required filename handling", () => {
    it("rejects non-.pdf and path-traversal required filenames", async () => {
      for (const bad of ["Technical Proposal.docx", "../evil.pdf", "a/b.pdf", ""]) {
        const result = await finalizeRequiredPdf({
          requiredFileName: bad,
          tender: TENDER,
          sourceDocument: sourceDoc({ fileContent: await makeDocxBase64(GOOD_TEXT) }),
        });
        assert.equal(result.ok, false, `must reject "${bad}"`);
        if (!result.ok) assert.equal(result.code, "PDF_INVALID_REQUIRED_FILENAME");
      }
    });

    it("resolveRequiredPdfFileName maps a DOCX source to the tender-required PDF name by base name", () => {
      const policy = { perFile: [{ exactFileName: "Technical Proposal.pdf", format: "pdf" as const }] };
      assert.equal(resolveRequiredPdfFileName(policy, { exactFileName: "Technical Proposal.docx" }), "Technical Proposal.pdf");
      assert.equal(resolveRequiredPdfFileName(policy, { exactFileName: "technical_proposal.docx" }), "Technical Proposal.pdf");
      assert.equal(resolveRequiredPdfFileName(policy, { exactFileName: "Financial Proposal.docx" }), null, "must NOT claim an unrelated required PDF name");
    });

    it("normalizeFileBaseName treats separators and case as equivalent", () => {
      assert.equal(normalizeFileBaseName("Technical Proposal.pdf"), normalizeFileBaseName("technical_proposal.DOCX"));
    });
  });

  describe("PDF byte validation", () => {
    it("rejects empty bytes and non-%PDF bytes; accepts real PDF header", () => {
      assert.equal(validatePdfBytes(Buffer.alloc(0)).ok, false);
      assert.equal(validatePdfBytes(null).ok, false);
      assert.equal(validatePdfBytes(Buffer.from("PKnot a pdf")).ok, false);
      assert.equal(validatePdfBytes(Buffer.from("%PDF-1.7\n…")).ok, true);
    });
  });

  describe("ZIP manifest — the required PDF entry round-trips exactly", () => {
    it("assembleFinalSubmissionZip lists the exact PDF filename and the manifest matches the archive", async () => {
      const pdfBytes = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF");
      const result = await assembleFinalSubmissionZip(
        [{
          name: "Technical Proposal.pdf",
          source: "GENERATED_DOC",
          generatedDocId: "d1",
          order: 1,
          envelope: "TECHNICAL",
          format: "PDF",
        }],
        [{ generatedDocId: "d1", bytes: pdfBytes }],
      );
      assert.deepEqual(result.fileList, ["Technical Proposal.pdf"]);
      const JSZip = (await import("jszip")).default;
      const reopened = await JSZip.loadAsync(result.buffer);
      const names = Object.values(reopened.files).filter((f) => !f.dir).map((f) => f.name);
      assert.deepEqual(names, ["Technical Proposal.pdf"], "actual ZIP entries must exactly match the manifest");
      const roundTripped = await reopened.file("Technical Proposal.pdf")!.async("nodebuffer");
      assert.equal(roundTripped.subarray(0, 4).toString("latin1"), "%PDF");
    });
  });

  describe("route wiring — hard gates exist and are fail-closed", () => {
    const downloadSrc = readFileSync(resolve(process.cwd(), "app/api/tenders/[id]/download/route.ts"), "utf8");
    const finalizeSrc = readFileSync(resolve(process.cwd(), "app/api/tenders/[id]/finalize-pdf/route.ts"), "utf8");

    it("zipPackage enforces required-format coverage (PDF-required tender with only DOCX blocks)", () => {
      assert.ok(downloadSrc.includes("checkTenderFormatCoverage"), "download route must run checkTenderFormatCoverage");
      assert.ok(downloadSrc.includes("formatCoverage.code"), "coverage failure must surface its structured code");
    });

    it("zip loop revalidates every entry's bytes (file signature) before serving", () => {
      assert.ok(downloadSrc.includes("validateFileSignature(content.filename, content.base64)"), "ZIP loop must revalidate bytes per entry");
    });

    it("type=pdf goes through finalizeRequiredPdf with the tender-required exact filename", () => {
      assert.ok(downloadSrc.includes("finalizeRequiredPdf({"));
      assert.ok(downloadSrc.includes("resolveRequiredPdfFileName"));
      assert.ok(!downloadSrc.includes("mammoth"), "contentSummary-fallback mammoth path must be gone");
    });

    it("type=pdf serves an already-finalized PDF only when validated + approved, with byte revalidation", () => {
      assert.ok(downloadSrc.includes("PDF_DOC_NOT_EXPORT_READY"), "unready PDF doc must fail closed with a precise blocker");
      const servePath = downloadSrc.slice(downloadSrc.indexOf("PDF_DOC_NOT_EXPORT_READY"));
      assert.ok(
        servePath.indexOf("validateFileSignature(pdfContent.content.filename") < servePath.indexOf('"Content-Type": "application/pdf"'),
        "served PDF bytes must be signature-revalidated before the response",
      );
    });

    it("Finalize Required PDF is wired as a recovery action for the blocker code", async () => {
      const { getRecoveryCommandActionSpec, isMutationAction } = await import("../lib/recovery-command-actions");
      const spec = getRecoveryCommandActionSpec("PDF_REQUIRED_CONVERSION_UNAVAILABLE");
      assert.ok(spec, "blocker code must resolve to a recovery action");
      assert.equal(spec!.kind, "api");
      assert.equal(spec!.method, "POST");
      assert.equal(spec!.path, "/api/tenders/{tenderId}/finalize-pdf");
      assert.equal(getRecoveryCommandActionSpec("TENDER_REQUIRES_PDF")?.path, "/api/tenders/{tenderId}/finalize-pdf");
      assert.equal(isMutationAction("FINALIZE_REQUIRED_PDF"), true, "must be classified as a mutation (hidden from REVIEWER)");
    });

    it("readiness panel renders an executable, role-gated Finalize Required PDF control", () => {
      const panelSrc = readFileSync(resolve(process.cwd(), "components/generation-readiness-panel.tsx"), "utf8");
      const buttonSrc = readFileSync(resolve(process.cwd(), "components/finalize-required-pdf-button.tsx"), "utf8");
      assert.ok(panelSrc.includes("FinalizeRequiredPdfButton"), "panel must render the execute control");
      assert.ok(panelSrc.includes("canMutate &&"), "execute control must be hidden for non-mutating roles");
      assert.ok(panelSrc.includes("canMutateTender"), "role gating must use the shared capability helper");
      assert.ok(buttonSrc.includes("/finalize-pdf"), "button must POST the finalize-pdf route");
      assert.ok(buttonSrc.includes('method: "POST"'), "button must POST, not navigate");
      assert.ok(!buttonSrc.includes("String(err"), "button must not surface raw errors");
    });

    it("finalize-pdf gate uses the missing-plan-file purpose, not the final-zip completeness check", () => {
      assert.ok(
        finalizeSrc.includes('purpose: "generate-missing-plan-files"'),
        "final-zip purpose would require the PDF this route creates to already exist (always CONFIRMED_PLAN_DOCUMENTS_INCOMPLETE)",
      );
      assert.ok(!finalizeSrc.includes('purpose: "final-zip"'), "final-zip purpose must be gone from finalize-pdf");
    });

    it("finalize-pdf treats only real %PDF bytes as satisfying a required PDF — inline AND storage-backed", () => {
      assert.ok(finalizeSrc.includes("isBase64PdfContent"), "satisfaction check must verify the %PDF signature via the shared helper");
      const satisfactionBlock = finalizeSrc.slice(finalizeSrc.indexOf("satisfiedNames"), finalizeSrc.indexOf("let targets"));
      assert.ok(satisfactionBlock.includes("readGeneratedDocumentContent"), "storage-backed rows must have their real bytes loaded and signature-checked");
      assert.ok(!finalizeSrc.includes("Boolean(d.storagePath)"), "storage-backed rows must not be trusted blindly");
    });

    it("isBase64PdfContent behaves correctly on real byte fixtures", async () => {
      assert.equal(isBase64PdfContent(Buffer.from("%PDF-1.7\nbody").toString("base64")), true, "real PDF base64 must pass");
      assert.equal(isBase64PdfContent(await makeDocxBase64(GOOD_TEXT)), false, "DOCX base64 must fail");
      assert.equal(isBase64PdfContent("not-base64-pdf-at-all"), false, "junk must fail");
      assert.equal(isBase64PdfContent(""), false);
      assert.equal(isBase64PdfContent(null), false);
    });

    it("finalize-pdf resolves a concurrent-create race with a structured conflict, not a 500", () => {
      assert.ok(finalizeSrc.includes('"P2002"'), "must recognize the unique-violation code");
      assert.ok(finalizeSrc.includes("PDF_FINALIZE_CONFLICT"), "must surface a structured conflict code");
      assert.ok(finalizeSrc.includes("finalized by another request"), "conflict message must be safe and specific");
    });

    it("finalize-pdf rejects an explicit source whose name does not match the required PDF", () => {
      assert.ok(finalizeSrc.includes("PDF_SOURCE_NAME_MISMATCH"), "explicit docId must enforce the same base-name match as the automatic lookup");
    });

    it("finalize-pdf route persists the PDF as PENDING (no validation/approval bypass) behind the central gate", () => {
      assert.ok(finalizeSrc.includes("assertTenderReadyForGenerationAndExport"), "central gate must run first");
      assert.ok(finalizeSrc.includes('validationStatus: "PENDING"'), "finalized PDF must NOT be auto-validated");
      assert.ok(finalizeSrc.includes('reviewStatus: "PENDING"'), "finalized PDF must NOT be auto-approved");
      assert.ok(finalizeSrc.includes("PDF_REQUIRED_CONVERSION_UNAVAILABLE"), "missing source must produce the structured blocker");
      assert.ok(!finalizeSrc.includes("String(err"), "no raw String(err) in public responses");
      assert.ok(!/\bmetadata\b/i.test(finalizeSrc), "no user-facing 'metadata' wording");
    });
  });
});
