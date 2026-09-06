/**
 * Build a real .docx Financial Proposal to attach as the "original" for the
 * planned 02-Financial-Proposal.docx. The app deliberately refuses to invent
 * priced offers, so the operator supplies this file; the harness does the same.
 * Development/diagnostic harness, not production code.
 */
import { Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell, TextRun, WidthType } from "docx";

const row = (cells, bold = false) => new TableRow({
  children: cells.map((c) => new TableCell({
    width: { size: 25, type: WidthType.PERCENTAGE },
    children: [new Paragraph({ children: [new TextRun({ text: String(c), bold })] })],
  })),
});

export async function buildFinancialProposalDocx() {
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: "Financial Proposal", heading: HeadingLevel.HEADING_1 }),
        new Paragraph("Hope Urban Planning Architectural and Engineering Consultancy"),
        new Paragraph("Tender reference: MOWE/CS/RWS/2026/0117"),
        new Paragraph("Client: Ministry of Water and Energy"),
        new Paragraph("Assignment: Consultancy Services for Detailed Design and Construction Supervision of Rural Water Supply Schemes in Amhara Region"),
        new Paragraph({ text: "Summary of Costs", heading: HeadingLevel.HEADING_2 }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            row(["Item", "Description", "Unit", "Amount (ETB)"], true),
            row(["1", "Remuneration — key experts", "Lump sum", "4,820,000"]),
            row(["2", "Remuneration — support staff", "Lump sum", "1,240,000"]),
            row(["3", "Field survey and hydrogeological investigation", "Lump sum", "1,960,000"]),
            row(["4", "Transport and per diem", "Lump sum", "870,000"]),
            row(["5", "Reporting, reproduction and communications", "Lump sum", "310,000"]),
            row(["", "Subtotal", "", "9,200,000"]),
            row(["", "VAT at 15 percent", "", "1,380,000"]),
            row(["", "Total contract price", "", "10,580,000"], true),
          ],
        }),
        new Paragraph({ text: "Validity", heading: HeadingLevel.HEADING_2 }),
        new Paragraph("This financial proposal remains valid for 90 days from the submission deadline of 30 November 2026."),
        new Paragraph({ text: "Declaration", heading: HeadingLevel.HEADING_2 }),
        new Paragraph("We confirm that the prices quoted above are fixed for the duration of the assignment and include all taxes, duties and levies payable under the laws of the Federal Democratic Republic of Ethiopia."),
        new Paragraph("Signed: Eng. Abebe Tesfaye, General Manager"),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}
