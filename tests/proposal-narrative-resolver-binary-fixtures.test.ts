// Regression test for the evaluator-simulation binary-as-Markdown bug.
//
// EVALUATOR_SIM (lib/ai-job-handlers.ts) used to base64-decode a stored
// GeneratedDocument's fileContent straight to UTF-8 and pass it to the
// evaluator panel as "proposalMarkdown" — correct only when the document
// was actually Markdown. Once automatic generation started producing real
// DOCX (lib/engine/generate-elite.ts), decoding a DOCX's binary bytes as
// UTF-8 produced mojibake that the evaluator would score as if it were the
// genuine proposal narrative.
//
// The fix (lib/engine/proposal-narrative-resolver.ts) is format-aware: only
// format === "MARKDOWN" is decoded directly; everything else goes through
// the same extractTextFromBuffer() extractor every other ingestion path
// uses. This test proves it against REAL binary fixtures (an actual DOCX
// built with the `docx` package, an actual PDF built with `pdf-lib`) — not
// just a source-regex check that the right function is imported.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { resolveProposalNarrativeText } from "../lib/engine/proposal-narrative-resolver";

const VISIBLE_MARKER = "SIMULATION-VISIBLE-NARRATIVE-MARKER-8f2c1a";

async function buildRealDocx(): Promise<Buffer> {
  const document = new Document({
    sections: [{
      children: [
        new Paragraph({ children: [new TextRun({ text: "Technical Proposal", bold: true })] }),
        new Paragraph(VISIBLE_MARKER),
        new Paragraph("This is the genuine client-visible proposal narrative the evaluator must see."),
      ],
    }],
  });
  return Buffer.from(await Packer.toBuffer(document));
}

async function buildRealPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText(VISIBLE_MARKER, { x: 48, y: 790, size: 14, font });
  page.drawText("Genuine client-visible proposal narrative.", { x: 48, y: 760, size: 12, font });
  return Buffer.from(await pdf.save());
}

describe("resolveProposalNarrativeText — format-aware, not base64-as-UTF8", () => {
  it("decodes MARKDOWN documents directly (no extractor needed)", async () => {
    const markdown = "# Technical Proposal\n\n" + VISIBLE_MARKER;
    const result = await resolveProposalNarrativeText({
      fileContent: Buffer.from(markdown, "utf8").toString("base64"),
      format: "MARKDOWN",
      contentMimeType: "text/markdown",
      exactFileName: "proposal.md",
      name: "Technical Proposal",
    });
    assert.equal(result, markdown);
  });

  it("extracts the real visible narrative from a genuine DOCX — never mojibake", async () => {
    const docxBuffer = await buildRealDocx();
    const result = await resolveProposalNarrativeText({
      fileContent: docxBuffer.toString("base64"),
      format: "DOCX",
      contentMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      exactFileName: "Technical-Proposal.docx",
      name: "Client-Ready Benchmark Technical Proposal",
    });
    assert.match(result, new RegExp(VISIBLE_MARKER));
    assert.match(result, /genuine client-visible proposal narrative/i);

    // Proving the fix actually changed behavior: the old code decoded the
    // base64 bytes straight to UTF-8, which is NOT what this resolver returns.
    const naiveUtf8Decode = docxBuffer.toString("utf8");
    assert.notEqual(result, naiveUtf8Decode, "must not be the raw base64-as-UTF8 mojibake the old code produced");
  });

  it("extracts the real visible narrative from a genuine PDF — never mojibake", async () => {
    const pdfBuffer = await buildRealPdf();
    const result = await resolveProposalNarrativeText({
      fileContent: pdfBuffer.toString("base64"),
      format: "PDF",
      contentMimeType: "application/pdf",
      exactFileName: "Technical-Proposal.pdf",
      name: "Approved Technical Proposal",
    });
    assert.match(result, new RegExp(VISIBLE_MARKER));
    const naiveUtf8Decode = pdfBuffer.toString("utf8");
    assert.notEqual(result, naiveUtf8Decode, "must not be the raw base64-as-UTF8 mojibake the old code produced");
  });

  it("an explicit override always wins over the stored document", async () => {
    const docxBuffer = await buildRealDocx();
    const result = await resolveProposalNarrativeText(
      { fileContent: docxBuffer.toString("base64"), format: "DOCX", contentMimeType: null, exactFileName: null, name: null },
      "explicit override text",
    );
    assert.equal(result, "explicit override text");
  });

  it("returns empty string when there is no stored document and no override", async () => {
    const result = await resolveProposalNarrativeText(null);
    assert.equal(result, "");
    const result2 = await resolveProposalNarrativeText({ fileContent: null, format: "DOCX", contentMimeType: null, exactFileName: null, name: null });
    assert.equal(result2, "");
  });
});
