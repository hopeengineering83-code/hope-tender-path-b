/**
 * A tender written in Ethiopic must produce a PDF, with its text intact.
 *
 * The renderer embedded only the three standard Helvetica faces. Those are
 * WinAnsi-encoded, so the first Ethiopic character in a real Ethiopian tender
 * ended the export:
 *
 *   pdf-finalizer: WinAnsi cannot encode "ጊ" (0x130a)
 *   → PDF_GENERATION_FAILED → AUTO_FINALIZE_NOT_CONVERGED → ZIP 409
 *
 * A submission package for an Ethiopian procuring entity could never be built.
 *
 * What is pinned here is that the characters SURVIVE. Stripping,
 * transliterating or substituting them would also make the export "pass", and
 * would be the same defect as any other value this application must never
 * invent: a proposal that silently drops the client's name is wrong in a way
 * an evaluator sees.
 *
 * Text is read back out of the produced bytes rather than trusting that
 * generation returned without throwing.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { generateProposalPdf } from "../lib/engine/proposal-pdf";
import { isWinAnsiEncodable } from "../lib/engine/pdf-unicode-fonts";

const ETHIOPIC = "ጊዜ";
const MIXED = `Hope Engineering — ${ETHIOPIC}`;

async function textOf(bytes: Uint8Array): Promise<string> {
  // The installed pdf-parse is v2, which exposes the PDFParse class rather
  // than a callable default — the same shapes lib/extract-text.ts handles.
  const mod = require("pdf-parse");
  if (typeof mod === "function") return String((await mod(Buffer.from(bytes)))?.text ?? "");
  if (typeof mod?.default === "function") return String((await mod.default(Buffer.from(bytes)))?.text ?? "");
  const parser = new mod.PDFParse({ data: Buffer.from(bytes) });
  try {
    const result = await parser.getText();
    if (Array.isArray(result?.pages)) return result.pages.map((page: { text?: string }) => page?.text ?? "").join("\n");
    return String(result?.text ?? "");
  } finally {
    await parser.destroy?.().catch(() => {});
  }
}

function isPdf(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.slice(0, 5)).toString("latin1") === "%PDF-";
}

describe("proposal PDF rendering", () => {
  it("recognises what the standard faces can and cannot encode", () => {
    assert.equal(isWinAnsiEncodable("Hope Engineering Ltd."), true);
    assert.equal(isWinAnsiEncodable("Prix — 20 € café"), true, "Latin-1 and the WinAnsi extras are encodable");
    assert.equal(isWinAnsiEncodable(MIXED), false);
    assert.equal(isWinAnsiEncodable(ETHIOPIC), false);
  });

  it("still renders an ordinary Latin proposal", async () => {
    const bytes = await generateProposalPdf({
      title: "Technical Proposal",
      clientName: "Northern Roads Authority",
      reference: "NRA/RFP/2027/001",
      markdown: [
        "# Technical Proposal",
        "",
        "## Approach",
        "",
        "The Consultant will deliver the assignment in three phases.",
        "",
        "- Inception and mobilisation",
        "- Detailed design review",
        "",
        "| Phase | Deliverable |",
        "| --- | --- |",
        "| 1 | Inception report |",
      ].join("\n"),
    });

    assert.ok(isPdf(bytes), "a PDF file is produced");
    const text = await textOf(bytes);
    assert.match(text, /Technical Proposal/);
    assert.match(text, /Northern Roads Authority/);
    assert.match(text, /Inception report/, "table content survives");
  });

  it("renders mixed Ethiopic and Latin without losing either", async () => {
    const bytes = await generateProposalPdf({
      title: MIXED,
      clientName: `የውሃ ሥራዎች ድርጅት — Water Works Enterprise`,
      reference: "AWWDSE/EOI/2026/0042",
      companyName: MIXED,
      markdown: [
        `# ${MIXED}`,
        "",
        `## ${ETHIOPIC}`,
        "",
        `The assignment covers ${ETHIOPIC} and ordinary Latin prose in one paragraph.`,
        "",
        `- ${ETHIOPIC} bullet item`,
        "",
        `| Item | ${ETHIOPIC} |`,
        "| --- | --- |",
        `| 1 | ${ETHIOPIC} |`,
      ].join("\n"),
    });

    assert.ok(isPdf(bytes), "a PDF file is produced rather than an exception");
    const text = await textOf(bytes);

    assert.ok(text.includes(ETHIOPIC), `the Ethiopic text must survive; got: ${JSON.stringify(text.slice(0, 300))}`);
    assert.ok(text.includes("Hope Engineering"), "the Latin text must survive alongside it");
    // Substitution would also "pass" a naive check, so the absence of the
    // usual replacements is asserted directly.
    assert.ok(!text.includes("??"), "characters must not be replaced with question marks");
  });

  it("keeps Ethiopic in headings, tables and the cover block", async () => {
    const bytes = await generateProposalPdf({
      title: `Cover ${ETHIOPIC}`,
      clientName: `Client ${ETHIOPIC}`,
      reference: `Ref ${ETHIOPIC}`,
      companyName: `Company ${ETHIOPIC}`,
      companyAddress: `Address ${ETHIOPIC}`,
      companyContact: `Contact ${ETHIOPIC}`,
      submissionEmailSubject: `Subject ${ETHIOPIC}`,
      markdown: `# Heading ${ETHIOPIC}\n\n| Col ${ETHIOPIC} |\n| --- |\n| Cell ${ETHIOPIC} |\n`,
    });
    const text = await textOf(bytes);
    for (const label of ["Cover", "Client", "Ref", "Company", "Heading", "Cell"]) {
      assert.ok(text.includes(label), `${label} must be present`);
    }
    assert.ok(text.includes(ETHIOPIC), "Ethiopic survives across cover, heading and table");
  });

  it("produces a larger file only when a Unicode face is actually needed", async () => {
    // The embedded face is 367 KB before subsetting, so an ordinary Latin
    // proposal must not carry it. This also proves the fallback is conditional
    // rather than always-on.
    const latin = await generateProposalPdf({ title: "Plain", markdown: "# Plain\n\nLatin only.\n" });
    const ethiopic = await generateProposalPdf({ title: "Plain", markdown: `# Plain\n\n${ETHIOPIC}\n` });
    assert.ok(
      ethiopic.length > latin.length,
      "the document needing a Unicode face embeds one",
    );
  });

  it("uses whole-document page totals and preserves long wrapped cover metadata", async () => {
    const longAddress = "Bole Road, Addis Ababa, Ethiopia — Engineering and Architectural Consultancy Headquarters";
    const markdown = Array.from({ length: 220 }, (_, i) => `Paragraph ${i + 1}: ${"source-grounded delivery detail ".repeat(8)}`).join("\n\n");
    const bytes = await generateProposalPdf({
      title: "Long proposal",
      companyAddress: longAddress,
      submissionEmailSubject: "Technical Proposal for Pharo Ventures",
      markdown,
    });
    const text = await textOf(bytes);
    const numbers = [...text.matchAll(/Page\s+(\d+)\s+of\s+(\d+)/g)].map((match) => [Number(match[1]), Number(match[2])]);
    assert.ok(numbers.length > 2, "fixture spans several pages");
    assert.deepEqual(numbers.map(([page]) => page), Array.from({ length: numbers.length }, (_, i) => i + 1));
    assert.ok(numbers.every(([, total]) => total === numbers.length));
    assert.match(text, /Engineering and Architectural Consultancy Headquarters/);
  });

  it("keeps running furniture concise instead of visibly truncating it", async () => {
    const bytes = await generateProposalPdf({
      title: "Architectural Consultancy Services for a Very Long Specialty Medical Centre Assignment",
      companyName: "Hope Engineering and Architectural Consultancy",
      companyAddress: "A deliberately long headquarters address that belongs on the cover rather than every page footer",
      companyContact: "info@hope.example | +251 11 000 0000",
      markdown: Array.from({ length: 90 }, (_, i) => `Paragraph ${i + 1}: ${"grounded delivery detail ".repeat(8)}`).join("\n\n"),
    });
    const text = await textOf(bytes);
    assert.match(text, /Hope Engineering and Architectural Consultancy/);
    assert.match(text, /info@hope\.example/);
    assert.doesNotMatch(text, /Specialty Medical Centre Assign\.\.\./);
    assert.doesNotMatch(text, /headquarters address that belongs\.\.\./);
  });
});
