/**
 * generatedDocumentVisibleText must not fuse adjacent table cells.
 *
 * WHY THIS FILE EXISTS
 * ---------------------
 * A real pipeline drive against the live export/validate path failed a clean
 * technical proposal with GENERATED_DOCUMENT_QUALITY_FAILED:
 * "Financial pricing content detected in a TECHNICAL document" /
 * "Possible financial/pricing language appears in a technical document".
 *
 * The document had no price anywhere. The cause was
 * lib/engine/generated-document-text.ts's generatedDocumentVisibleText(),
 * which joined every <w:t> run across an entire DOCX part with a single
 * space and no paragraph/table-row/table-cell boundary awareness. A
 * compliance-matrix table row with one cell naming the required
 * "...Technical and Financial Proposal..." subject line and an adjacent,
 * unrelated cell reading "3 selected expert(s), and 1 selected project
 * reference(s) may support drafting" fused into one run-on pseudo-sentence.
 * containsPricingLeakage's isSafeNoPriceSentence() exemption for a sentence
 * that merely NAMES a separate financial envelope requires that sentence to
 * carry no priced-looking content — the fused fragment's incidental digits
 * ("3", "1") defeated that exemption.
 *
 * lib/engine/export-readiness.ts's sibling extractor (visibleXmlText) was
 * already fixed for this exact bug class — it ends every </w:p>, </w:tr> and
 * </w:tc> with a newline — but generatedDocumentVisibleText, the extractor
 * actually used by the live document-quality-gate.ts/validate.ts/export
 * path, was never given the same fix. This pins the fix at the real-bytes
 * level: build an actual DOCX table with the same cell shape and confirm the
 * document reads as clean.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell } from "docx";
import { generatedDocumentVisibleText } from "../lib/engine/generated-document-text";
import { containsPricingLeakage } from "../lib/engine/pricing-hygiene";
import { documentHygieneIssues } from "../lib/engine/export-readiness";

const TECHNICAL_DOC = {
  name: "Client-Ready Benchmark Technical Proposal",
  exactFileName: "Technical-Proposal.docx",
  documentType: "TECHNICAL_PROPOSAL",
  format: "DOCX",
} as never;

function cell(text: string): TableCell {
  return new TableCell({ children: [new Paragraph({ children: [new TextRun(text)] })] });
}

async function docxWithComplianceRow(): Promise<string> {
  const buffer = await Packer.toBuffer(new Document({
    sections: [{
      children: [
        new Paragraph({ children: [new TextRun("Compliance Matrix")] }),
        new Table({
          rows: [
            new TableRow({
              children: [
                cell(`Required email subject line: "...Technical and Financial Proposal..."`),
                cell("One relevant Company Vault document, 3 selected expert(s), and 1 selected project reference(s) may support drafting."),
              ],
            }),
          ],
        }),
        new Paragraph({ children: [new TextRun("The technical envelope carries no contract values, fees or rates.")] }),
      ],
    }],
  }));
  return buffer.toString("base64");
}

describe("generatedDocumentVisibleText preserves table-cell boundaries", () => {
  it("does not fuse an adjacent cell's digits into a financial-envelope reference", async () => {
    const fileContent = await docxWithComplianceRow();
    const doc = { fileContent, name: "Client-Ready Benchmark Technical Proposal", exactFileName: "Technical-Proposal.docx", contentMimeType: null };

    const text = await generatedDocumentVisibleText(doc);
    assert.ok(text, "extractor must return text for a valid DOCX");
    assert.ok(text!.includes("\n"), "table cells must be separated by real boundaries, not fused into one line");

    assert.equal(
      containsPricingLeakage(text ?? "", TECHNICAL_DOC),
      false,
      "no cell in this table carries a price; adjacent cells must not combine into one",
    );
    assert.deepEqual(documentHygieneIssues(text, TECHNICAL_DOC), []);
  });

  it("still catches a genuine price fused across the same boundaries (fail-closed is preserved)", async () => {
    const buffer = await Packer.toBuffer(new Document({
      sections: [{
        children: [
          new Table({
            rows: [
              new TableRow({
                children: [cell("Our total price for the assignment is"), cell("12,400,000 ETB including all reimbursable costs.")],
              }),
            ],
          }),
        ],
      }],
    }));
    const doc = { fileContent: buffer.toString("base64"), name: "Client-Ready Benchmark Technical Proposal", exactFileName: "Technical-Proposal.docx", contentMimeType: null };
    const text = await generatedDocumentVisibleText(doc);
    assert.equal(containsPricingLeakage(text ?? "", TECHNICAL_DOC), true, "a genuine price split across cells must still be flagged");
  });
});
