import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import JSZip from "jszip";
import { Packer } from "docx";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { assembleFinalSubmissionZip } from "../lib/engine/final-zip-assembly";
import { computeFileHash } from "../lib/engine/generated-file-integrity";
import {
  buildProfessionalDocument,
  markdownToDocx,
} from "../lib/engine/generate-elite";

const EVIDENCE_DIRECTORY = resolve("acceptance-evidence/generated-files");
const SYNTHETIC_BRAND_LOGO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=",
  "base64",
);

async function buildInspectableDocx(): Promise<Buffer> {
  const document = buildProfessionalDocument({
    tenderTitle: "Synthetic source-grounded tender",
    clientName: "Synthetic Procuring Entity",
    companyName: "Synthetic Evidence Company",
    reference: "SYNTHETIC-RFP-2026-001",
    contactFooter: "Synthetic address | synthetic@example.invalid",
    logo: {
      data: SYNTHETIC_BRAND_LOGO,
      type: "png",
      width: 64,
      height: 64,
    },
    children: markdownToDocx([
      "# Technical Proposal",
      "",
      "## Table of Contents",
      "",
      "## Delivery Methodology",
      "",
      "### Source-grounded approach",
      "This synthetic acceptance document exercises the production DOCX renderer without asserting any real company or tender facts.",
    ].join("\n")),
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
    assert.ok(officePackage.file("word/header1.xml"));
    assert.ok(officePackage.file("word/footer1.xml"));
    const embeddedMedia = Object.keys(officePackage.files).filter((path) => path.startsWith("word/media/"));
    assert.ok(embeddedMedia.length > 0, "production DOCX must contain the supplied synthetic brand asset");
    const documentXml = await officePackage.file("word/document.xml")!.async("string");
    const relationshipsXml = await officePackage.file("word/_rels/document.xml.rels")!.async("string");
    const footerXml = await officePackage.file("word/footer1.xml")!.async("string");
    const settingsXml = await officePackage.file("word/settings.xml")!.async("string");
    assert.match(documentXml, /Technical Proposal/);
    assert.match(documentXml, /Source-grounded approach/);
    assert.match(documentXml, /w:pStyle w:val="Heading1"/);
    assert.match(documentXml, /w:pStyle w:val="Heading2"/);
    assert.match(documentXml, /w:pStyle w:val="Heading3"/);
    assert.match(documentXml, /TOC (?=[^<]*\\h)(?=[^<]*\\o (?:&quot;|")1-3(?:&quot;|"))/);
    assert.match(documentXml, /Company logo/);
    assert.match(relationshipsXml, /relationships\/header/);
    assert.match(relationshipsXml, /relationships\/footer/);
    assert.match(relationshipsXml, /relationships\/image/);
    assert.match(footerXml, /Confidential bid document/);
    assert.match(footerXml, /PAGE/);
    assert.match(settingsXml, /<w:updateFields(?:\s+w:val="true")?\s*\/>/);

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
