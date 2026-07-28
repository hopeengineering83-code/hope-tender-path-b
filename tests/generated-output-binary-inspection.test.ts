import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import JSZip from "jszip";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { assembleFinalSubmissionZip } from "../lib/engine/final-zip-assembly";
import { computeFileHash } from "../lib/engine/generated-file-integrity";

const EVIDENCE_DIRECTORY = resolve("acceptance-evidence/generated-files");

async function buildInspectableDocx(): Promise<Buffer> {
  const document = new Document({
    sections: [{
      children: [
        new Paragraph({
          children: [new TextRun({ text: "Tender Technical Proposal — binary inspection", bold: true })],
        }),
        new Paragraph("This document is generated as a valid Office Open XML package."),
      ],
    }],
  });
  return Buffer.from(await Packer.toBuffer(document));
}

async function buildInspectablePdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("Tender Technical Proposal — PDF binary inspection", {
    x: 48,
    y: 790,
    size: 14,
    font,
  });
  page.drawText("This PDF is structurally opened and inspected before ZIP acceptance.", {
    x: 48,
    y: 760,
    size: 10,
    font,
  });
  return Buffer.from(await pdf.save());
}

describe("generated Word/PDF/ZIP binary inspection", () => {
  it("opens valid Word and PDF files, then verifies every final ZIP entry and manifest digest", async () => {
    const docxBytes = await buildInspectableDocx();
    const pdfBytes = await buildInspectablePdf();

    const officePackage = await JSZip.loadAsync(docxBytes);
    assert.ok(officePackage.file("[Content_Types].xml"));
    assert.ok(officePackage.file("word/document.xml"));
    const documentXml = await officePackage.file("word/document.xml")!.async("string");
    assert.match(documentXml, /Tender Technical Proposal/);
    assert.match(documentXml, /Office Open XML package/);

    const openedPdf = await PDFDocument.load(pdfBytes, { updateMetadata: false });
    assert.equal(openedPdf.getPageCount(), 1);
    const [page] = openedPdf.getPages();
    assert.ok(page.getWidth() > 500 && page.getHeight() > 800);

    const entries = [
      {
        generatedDocId: "docx-1",
        name: "Technical-Proposal.docx",
        source: "GENERATED_DOC" as const,
        order: 1,
        envelope: "TECHNICAL" as const,
        format: "DOCX" as const,
      },
      {
        generatedDocId: "pdf-1",
        name: "Technical-Proposal.pdf",
        source: "GENERATED_DOC" as const,
        order: 2,
        envelope: "TECHNICAL" as const,
        format: "PDF" as const,
      },
    ];
    const finalized = await assembleFinalSubmissionZip(entries, [
      { generatedDocId: "docx-1", bytes: docxBytes },
      { generatedDocId: "pdf-1", bytes: pdfBytes },
    ]);
    assert.deepEqual(finalized.fileList, ["Technical-Proposal.docx", "Technical-Proposal.pdf"]);
    assert.equal(finalized.manifest.length, 2);

    const reopenedZip = await JSZip.loadAsync(finalized.buffer);
    const actualNames = Object.keys(reopenedZip.files).filter((name) => !reopenedZip.files[name].dir).sort();
    assert.deepEqual(actualNames, [...finalized.fileList].sort());

    const sourceBytes = new Map([
      ["Technical-Proposal.docx", docxBytes],
      ["Technical-Proposal.pdf", pdfBytes],
    ]);
    for (const item of finalized.manifest) {
      const expected = sourceBytes.get(item.filename);
      assert.ok(expected, `manifest contains unexpected file ${item.filename}`);
      const entry = reopenedZip.file(item.filename);
      assert.ok(entry, `ZIP entry ${item.filename} must exist`);
      const actual = await entry!.async("nodebuffer");
      assert.deepEqual(actual, expected);
      assert.equal(item.byteLength, actual.length);
      assert.equal(item.sha256, computeFileHash(actual));
      assert.equal(item.envelope, "TECHNICAL");
      assert.match(item.format, /^(DOCX|PDF)$/);
    }

    await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
    await Promise.all([
      writeFile(resolve(EVIDENCE_DIRECTORY, "Technical-Proposal.docx"), docxBytes),
      writeFile(resolve(EVIDENCE_DIRECTORY, "Technical-Proposal.pdf"), pdfBytes),
      writeFile(resolve(EVIDENCE_DIRECTORY, "Final-Submission-Package.zip"), finalized.buffer),
      writeFile(
        resolve(EVIDENCE_DIRECTORY, "manifest.json"),
        JSON.stringify({
          inspectedAt: new Date().toISOString(),
          files: finalized.manifest,
          zipSha256: computeFileHash(finalized.buffer),
          zipByteSize: finalized.buffer.length,
        }, null, 2),
        "utf8",
      ),
    ]);
  });
});
