import { describe, it } from "node:test";
import assert from "node:assert/strict";

import JSZip from "jszip";

import { cleanDocxHygieneIssues } from "../lib/engine/export-gap-repair";

/**
 * THE DEFECT, READ OUT OF A DELIVERED CLIENT PDF.
 * -----------------------------------------------
 * A green acceptance run (34769880487, head 619b26f7) produced a proposal whose
 * Section B project cards read, verbatim:
 *
 *   Duration                      2015-2018
 *   Construction Value of Works   1M
 *
 * "1M" is not a figure. The delivered document made a meaningless claim about
 * the scale of a past project, and every gate passed over it: readiness
 * reported zero blockers, the audit agreed, the ZIP built, and the layout check
 * was satisfied. An absent number breaks no rule and a nonsense one breaks
 * none either.
 *
 * WHERE THE CHARACTERS WENT
 * -------------------------
 * `safeParagraphText` split the cell into "sentences" with
 * /[^.!?]+(?:[.!?]+|$)/g -- no guard for a decimal point. So
 *
 *   "ETB 550.1M"  ->  ["ETB 550.", "1M"]
 *
 * The half carrying the amount was classified as pricing risk and dropped; the
 * orphan tail was written back into the client's document. All three cards show
 * the same signature: ETB 550.1M -> "1M", ETB 125.0M -> "0M", USD 18.9M -> "9M"
 * -- in each case exactly the text after the decimal point.
 *
 * THREE RULES ARE PINNED HERE
 * ---------------------------
 * 1. A number is not a sentence boundary. Splitting must not cut inside one.
 * 2. A cleaned paragraph never emits a fragment that asserts nothing. If
 *    isolating the risk is not possible, the cell is emptied -- fail closed --
 *    rather than left holding debris.
 * 3. A table cell is judged with its ROW, because the label in the next cell is
 *    what makes the amount a historical fact rather than a price. Judged alone,
 *    "ETB 550.1M" is a bare amount and reads as leakage; judged beside
 *    "Construction Value of Works" it is track record, and nothing is removed.
 */

const DOC = {
  id: "d1",
  name: "Technical Proposal",
  exactFileName: "Technical Proposal.docx",
  exactOrder: 1,
  documentType: "TECHNICAL_PROPOSAL",
  format: "DOCX",
  generationStatus: "GENERATED",
  validationStatus: "PENDING",
  reviewStatus: "PENDING",
} as Parameters<typeof cleanDocxHygieneIssues>[1];

/** Builds a .docx whose document.xml contains the given body XML. */
async function docxWith(bodyXml: string): Promise<string> {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`
      + `<w:body>${bodyXml}</w:body></w:document>`,
  );
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return buf.toString("base64");
}

const para = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const cell = (text: string) => `<w:tc>${para(text)}</w:tc>`;
const row = (...cells: string[]) => `<w:tr>${cells.map(cell).join("")}</w:tr>`;

async function visibleTextOf(base64: string | null): Promise<string | null> {
  if (base64 === null) return null;
  const zip = await JSZip.loadAsync(Buffer.from(base64, "base64"));
  const xml = await zip.file("word/document.xml")!.async("string");
  return xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

describe("a cleaned cell never becomes a number with no meaning", () => {
  it("does not cut a decimal amount in half and keep the tail", async () => {
    // The exact delivered card, as a Word table row.
    const docx = await docxWith(
      `<w:tbl>${row("Duration", "2015-2018")}${row("Construction Value of Works", "ETB 550.1M")}</w:tbl>`,
    );
    const cleaned = await visibleTextOf(await cleanDocxHygieneIssues(docx, DOC));

    if (cleaned !== null) {
      assert.doesNotMatch(cleaned, /(^|\s)1M(\s|$)/, 'the orphan tail "1M" must never be written back');
      assert.doesNotMatch(cleaned, /ETB 550\.\s/, "nor the severed head");
    }
  });

  it("keeps a labelled delivered-work value intact, because the row gives it meaning", async () => {
    const docx = await docxWith(
      `<w:tbl>${row("Construction Value of Works", "ETB 550.1M")}</w:tbl>`,
    );
    const result = await cleanDocxHygieneIssues(docx, DOC);
    // null means "nothing needed changing", which is the correct outcome here.
    if (result !== null) {
      const cleaned = await visibleTextOf(result);
      assert.match(cleaned!, /ETB 550\.1M/, "a labelled historical value is track record, not a price");
    }
  });

  it("still removes a real price, and leaves no debris behind when it does", async () => {
    const docx = await docxWith(
      `<w:tbl>${row("Our Fee", "The total price for this assignment is ETB 1,250,000.")}</w:tbl>`,
    );
    const cleaned = await visibleTextOf(await cleanDocxHygieneIssues(docx, DOC));
    assert.ok(cleaned !== null, "a genuine price must still be cleaned");
    assert.doesNotMatch(cleaned!, /1,250,000/, "the price is gone");
    // Fail closed: whatever remains must not be a bare numeric fragment.
    for (const token of cleaned!.split(/\s+/)) {
      assert.doesNotMatch(token, /^[\d.,]+[KkMmBb]?$/, `left behind a meaningless fragment: "${token}"`);
    }
  });

  it("removes a price in ordinary prose without disturbing the sentences around it", async () => {
    const docx = await docxWith(
      [
        para("Our approach sequences survey, design and supervision over 18 months."),
        para("The total price for this assignment is ETB 1,250,000."),
        para("Quality assurance is led by the Project Director."),
      ].join(""),
    );
    const cleaned = await visibleTextOf(await cleanDocxHygieneIssues(docx, DOC));
    assert.ok(cleaned !== null);
    assert.match(cleaned!, /survey, design and supervision over 18 months/);
    assert.match(cleaned!, /Quality assurance is led by the Project Director/);
    assert.doesNotMatch(cleaned!, /1,250,000/);
  });

  it("does not mistake a decimal inside ordinary prose for a sentence end", async () => {
    const docx = await docxWith(
      para("The site covers 12.5 hectares and the design achieves a 3.2 metre floor-to-floor height."),
    );
    const result = await cleanDocxHygieneIssues(docx, DOC);
    if (result !== null) {
      const cleaned = await visibleTextOf(result);
      assert.match(cleaned!, /12\.5 hectares/);
      assert.match(cleaned!, /3\.2 metre/);
    }
  });
});
