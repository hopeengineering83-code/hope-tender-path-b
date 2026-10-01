/**
 * The stage that actually failed must survive Ethiopic.
 *
 * The live failure was not in the markdown renderer in isolation — it was the
 * required-format conversion inside AUTO_FINALIZE:
 *
 *   pdf-finalizer: WinAnsi cannot encode "ጊ" (0x130a)
 *   → PDF_GENERATION_FAILED → AUTO_FINALIZE_NOT_CONVERGED → ZIP 409
 *
 * So the proof has to run through finalizeRequiredPdf with a real DOCX whose
 * visible text contains Ethiopic, not just through generateProposalPdf. The
 * tender fields are exercised too, because the cover page draws the client
 * name and an Ethiopian procuring entity is exactly where the character
 * arrives.
 *
 * What is pinned is that the text SURVIVES the conversion. Dropping or
 * substituting it would also make the stage "succeed", and would put a
 * proposal in front of an evaluator with the client's name mangled.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { finalizeRequiredPdf } from "../lib/engine/workflow/pdf-finalizer";

const ETHIOPIC = "ጊዜ";
const CLIENT = `የውሃ ሥራዎች ድርጅት — Awash Water Works Enterprise`;

async function docxWith(lines: string[]): Promise<string> {
  const buffer = await Packer.toBuffer(new Document({
    sections: [{
      children: lines.map((line) => new Paragraph({ children: [new TextRun(line)] })),
    }],
  }));
  return buffer.toString("base64");
}

async function pdfText(bytes: Uint8Array | Buffer): Promise<string> {
  const mod = require("pdf-parse");
  const data = Buffer.from(bytes);
  if (typeof mod === "function") return String((await mod(data))?.text ?? "");
  if (typeof mod?.default === "function") return String((await mod.default(data))?.text ?? "");
  const parser = new mod.PDFParse({ data });
  try {
    const result = await parser.getText();
    if (Array.isArray(result?.pages)) return result.pages.map((page: { text?: string }) => page?.text ?? "").join("\n");
    return String(result?.text ?? "");
  } finally {
    await parser.destroy?.().catch(() => {});
  }
}

describe("required-PDF conversion with Ethiopic content", () => {
  it("converts a DOCX containing Ethiopic instead of failing the stage", async () => {
    const fileContent = await docxWith([
      `Technical Proposal — ${ETHIOPIC}`,
      "",
      `The Consultant shall demonstrate ${ETHIOPIC} experience in design review`,
      "and technical audit of rural water supply schemes.",
      "",
      "Ordinary Latin paragraph so both scripts are exercised in one document.",
    ]);

    const result = await finalizeRequiredPdf({
      requiredFileName: "Technical-Proposal.pdf",
      tender: {
        title: `${ETHIOPIC} Rural Water Supply Design Review`,
        clientName: CLIENT,
        reference: "AWWDSE/RFP/2026/0117",
        submissionEmailSubject: `AWWDSE/RFP/2026/0117 - Technical Proposal ${ETHIOPIC}`,
      },
      company: { name: `Hope Engineering — ${ETHIOPIC}`, address: "Bole, Addis Ababa", email: "bids@example.test" },
      sourceDocument: {
        id: "src-1",
        name: "Technical Proposal",
        exactFileName: "Technical-Proposal.docx",
        documentType: "TECHNICAL_PROPOSAL",
        format: "DOCX",
        generationStatus: "GENERATED",
        validationStatus: "VALIDATED",
        reviewStatus: "READY_FOR_EXPORT",
        fileContent,
      },
    });

    assert.equal(
      result.ok,
      true,
      `conversion must succeed; got ${JSON.stringify({ code: (result as { code?: string }).code, message: (result as { message?: string }).message })}`,
    );

    assert.ok(result.ok);
    const bytes = Buffer.from(result.bytes);

    assert.equal(bytes.slice(0, 5).toString("latin1"), "%PDF-", "real PDF bytes are produced");

    const text = await pdfText(bytes);
    assert.ok(text.includes(ETHIOPIC), `Ethiopic must survive conversion; got ${JSON.stringify(text.slice(0, 400))}`);
    assert.ok(text.includes("Consultant"), "the Latin body text survives beside it");
    assert.ok(!text.includes("??"), "characters must not be replaced with question marks");
  });

  it("still converts an ordinary Latin DOCX", async () => {
    const fileContent = await docxWith([
      "Technical Proposal",
      "",
      "The Consultant will deliver the assignment in three phases.",
    ]);

    const result = await finalizeRequiredPdf({
      requiredFileName: "Technical-Proposal.pdf",
      tender: { title: "Technical Proposal", clientName: "Northern Roads Authority", reference: "NRA/RFP/2027/001" },
      sourceDocument: {
        id: "src-2",
        name: "Technical Proposal",
        exactFileName: "Technical-Proposal.docx",
        documentType: "TECHNICAL_PROPOSAL",
        format: "DOCX",
        generationStatus: "GENERATED",
        validationStatus: "VALIDATED",
        reviewStatus: "READY_FOR_EXPORT",
        fileContent,
      },
    });

    assert.equal(result.ok, true, `Latin conversion must keep working; got ${JSON.stringify((result as { code?: string }).code)}`);
    assert.ok(result.ok);
    const bytes = Buffer.from(result.bytes);
    const text = await pdfText(bytes);
    assert.match(text, /Northern Roads Authority/);
    assert.match(text, /three phases/);
  });
});
