// Release surfaces must judge the same bytes, and the final deliverable is a PDF.
//
// THE CONTRADICTION THIS PINS
// ---------------------------
// On hosted run 33987922811 the same artifact produced two incompatible
// verdicts at the same moment:
//
//   export-readiness:            ok, READY, zero blockers, ZIP exported
//   generated-proposals/audit:   qualityScore 0, DRAFT_ONLY,
//                                readyForExport false, zipEligible false
//
// Not a threshold disagreement — the audit had never read the document. Its
// text reader was extractDocxVisibleText, whose maybeBase64Docx() guard
// returns null for anything that is not an OPC package. The final artifact of
// a completed run is a PDF, so the audit saw nothing, quality came back null,
// and the score defaulted to 0 with status DRAFT_ONLY. Meanwhile
// export-readiness reads PDFs through generatedDocumentVisibleText and
// correctly reported READY.
//
// The fix is that both surfaces read through the one canonical reader. It is
// NOT that the audit trusts metadata or assumes a pass: the second test below
// pins that a genuinely thin PDF still fails, so the contradiction is resolved
// by making the audit see, not by making it agree.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

import { extractDocxVisibleText } from "../lib/engine/export-readiness";
import { generatedDocumentVisibleText } from "../lib/engine/generated-document-text";
import { assessGeneratedDocumentQuality } from "../lib/engine/document-quality-gate";

async function buildPdf(lines: string[]): Promise<string> {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let page = doc.addPage([595, 842]);
  let y = 780;
  for (const line of lines) {
    if (y < 60) {
      page = doc.addPage([595, 842]);
      y = 780;
    }
    page.drawText(line.slice(0, 95), { x: 50, y, size: 10, font });
    y -= 16;
  }
  return Buffer.from(await doc.save()).toString("base64");
}

const PDF_DOC_META = {
  name: "Technical Proposal",
  exactFileName: "Technical Proposal.pdf",
  documentType: "TECHNICAL_PROPOSAL",
  format: "PDF",
} as const;

describe("the generated-proposal audit reads the final PDF, not just DOCX", () => {
  it("recovers visible text from PDF bytes that the DOCX-only reader cannot see", async () => {
    const base64 = await buildPdf([
      "Technical Proposal for Pharo Ventures",
      "Section C: Technical Approach and Methodology",
      "Infection prevention and control zoning is coordinated with the",
      "biomedical equipment schedule before detailed design begins.",
    ]);

    // The old reader is still correct about what it claims to do; it simply
    // cannot answer the question the audit was asking it.
    assert.equal(
      await extractDocxVisibleText(base64, "Technical Proposal.pdf"),
      null,
      "the DOCX reader returns null for a PDF — this is why the audit scored 0",
    );

    const visibleText = await generatedDocumentVisibleText({
      fileContent: base64,
      exactFileName: "Technical Proposal.pdf",
      name: "Technical Proposal",
      contentMimeType: null,
    });

    assert.ok(visibleText, "the canonical reader must open PDF bytes");
    assert.match(visibleText, /Pharo Ventures/);
    assert.match(visibleText, /Technical Approach and Methodology/);
  });

  it("still fails a thin PDF — seeing the document is not the same as passing it", async () => {
    const thin = await buildPdf(["Technical Proposal", "TBD"]);
    const visibleText = await generatedDocumentVisibleText({
      fileContent: thin,
      exactFileName: "Technical Proposal.pdf",
      name: "Technical Proposal",
      contentMimeType: null,
    });
    assert.ok(visibleText, "the reader opens it");

    const quality = assessGeneratedDocumentQuality({
      doc: PDF_DOC_META as never,
      visibleText,
      rawFileContent: thin,
      hasStoragePath: false,
    });

    assert.ok(quality.score < 60, `a two-line PDF must not pass quality (got ${quality.score})`);
    assert.notEqual(quality.recommendedStatus, "PASSED");
  });

  it("keeps both audit surfaces on the one canonical reader", () => {
    // A future edit that reintroduces the DOCX-only reader on either surface
    // silently restores the contradiction, because a PDF simply reads as
    // "no text" rather than as an error.
    for (const path of [
      "app/api/admin/generated-proposals/audit/route.ts",
      "lib/engine/storage-backed-document-audit.ts",
    ]) {
      const source = readFileSync(path, "utf8");
      assert.match(
        source,
        /generatedDocumentVisibleText/,
        `${path} must read artifact text through the canonical reader`,
      );
      assert.doesNotMatch(
        source.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n"),
        /\bextractDocxVisibleText\s*\(/,
        `${path} must not read the final artifact with the DOCX-only reader`,
      );
    }
  });
});
