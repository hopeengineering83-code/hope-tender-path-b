import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Packer } from "docx";
import JSZip from "jszip";

import { buildProfessionalDocument, markdownToDocx } from "../lib/engine/generate-elite";
import { extractDocxProposalParts } from "../lib/engine/export-readiness";
import { generateProposalPdf, planTableOfContents, tableColumnWidths } from "../lib/engine/proposal-pdf";

/**
 * The delivered proposal PDF is rendered from markdown re-extracted out of
 * the generated DOCX. Rendered page by page, a full proposal showed:
 *
 *   - every heading ("SECTION A: COMPANY PROFILE", "A.1 Company Overview")
 *     drawn as body text — the extractor read runs, never paragraph styles;
 *   - every table with a navy header band and no labels in it — the DOCX
 *     header cells were built from TextRun instances whose text a spread does
 *     not copy;
 *   - the contents listed twice in the DOCX and once in the PDF as a plain
 *     list with no page numbers;
 *   - the DOCX cover block printed again at the top of page 2, under the PDF's
 *     own cover;
 *   - equal-width columns (a "#" column as wide as the responsibilities
 *     column), short tables split with one row alone on the next page, and
 *     headings stranded at the foot of a page above the table they introduce.
 *
 * These tests hold each of those at the builder or renderer that caused it.
 */

async function docxFor(markdown: string, coverVault?: Parameters<typeof buildProfessionalDocument>[0]["coverVault"]) {
  const bytes = await Packer.toBuffer(buildProfessionalDocument({
    tenderTitle: "Consultancy Services for a Regional Clinic",
    clientName: "Procuring Entity",
    companyName: "Evidence Company",
    children: markdownToDocx(markdown),
    coverVault,
  }));
  const zip = await JSZip.loadAsync(bytes);
  return { base64: bytes.toString("base64"), xml: (await zip.file("word/document.xml")?.async("string")) ?? "" };
}

async function pdfPages(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" ").replace(/\s+/g, " "));
  }
  return pages;
}

const PROPOSAL = [
  "# Table of Contents",
  "",
  "Cover Letter",
  " Company Overview",
  "Technical Approach",
  "",
  "# Cover Letter",
  "",
  "Dear Evaluation Committee,",
  "",
  "# Section A: Company Profile",
  "",
  "## A.1 Company Overview",
  "",
  "- Registered consultancy",
  "- Two branch offices",
  "",
  "| # | Expert & Position | Role on This Assignment |",
  "|---|---|---|",
  "| 1 | Jane Doe — Team Leader | Leads design review and coordination of every discipline across all phases |",
  "",
  "# Section C: Technical Approach",
  "",
  "Method text.",
].join("\n");

describe("the DOCX keeps the structure the PDF is rendered from", () => {
  it("table header cells carry their labels", async () => {
    const { xml } = await docxFor(PROPOSAL);
    assert.match(xml, />Expert &amp; Position<\/w:t>/);
    assert.match(xml, />Role on This Assignment<\/w:t>/);
    assert.match(xml, /<w:tblHeader\/>|<w:tblHeader w:val="true"\/>/, "the header row repeats on every page");
  });

  it("lists the contents once, as the Word field, not again as static lines", async () => {
    const { xml } = await docxFor(PROPOSAL);
    assert.equal(xml.match(/>Company Overview<\/w:t>/g)?.length ?? 0, 0, "the static entry ' Company Overview' is dropped");
    assert.equal(xml.match(/>A\.1 Company Overview<\/w:t>/g)?.length, 1);
    assert.match(xml, /<w:pStyle w:val="TOCHeading"\/>/);
  });

  it("the cover is its own page and the first section after the contents opens a page", async () => {
    const { xml } = await docxFor(PROPOSAL);
    assert.match(xml, /<w:pStyle w:val="ProposalCover"\/>[\s\S]*?<w:br w:type="page"\/>/);
    const coverLetter = xml.indexOf(">Cover Letter</w:t>");
    const paragraph = xml.slice(xml.lastIndexOf("<w:p>", coverLetter), coverLetter);
    assert.match(paragraph, /<w:pageBreakBefore\/>/);
  });
});

describe("the markdown extracted for the PDF keeps headings, lists, contents and cover apart", () => {
  it("maps paragraph styles back to markdown", async () => {
    const { base64 } = await docxFor(PROPOSAL, { tin: "0012345", gmName: "Jane Doe", gmTitle: "General Manager" });
    const parts = await extractDocxProposalParts(base64, "Technical Proposal.docx");
    assert.ok(parts);
    const md = parts.markdown;
    assert.match(md, /^# Table of Contents$/m);
    assert.match(md, /^# Section A: Company Profile$/m);
    assert.match(md, /^## A\.1 Company Overview$/m);
    assert.match(md, /^- Registered consultancy$/m);
    assert.match(md, /^\| \*\*#\*\* \| \*\*Expert & Position\*\* \| \*\*Role on This Assignment\*\* \|$/m);
    // The DOCX cover is not repeated as body text; its record facts go to the PDF cover.
    assert.doesNotMatch(md, /TECHNICAL PROPOSAL|Submitted to:/);
    assert.ok(parts.coverDetails.some((line) => /TIN: 0012345/.test(line)), parts.coverDetails.join(" | "));
    assert.ok(parts.coverDetails.some((line) => /Jane Doe, General Manager/.test(line)));
  });
});

describe("the PDF lays the proposal out as a proposal", () => {
  it("opens each top-level section on its own page and lists it in the contents with that page", async () => {
    const markdown = [
      "# Table of Contents",
      "",
      "# Cover Letter",
      "",
      "Dear Evaluation Committee,",
      "",
      "# Section A: Company Profile",
      "",
      "## A.1 Company Overview",
      "",
      "Company text.",
      "",
      "# Declaration",
      "",
      "We confirm.",
      "",
      "Signature: ________   Stamp: ________   Date: ________",
    ].join("\n");
    const pages = await pdfPages(await generateProposalPdf({ title: "Tender", markdown, companyName: "Evidence Company" }));
    // cover, contents, cover letter, section A, declaration
    assert.equal(pages.length, 5, pages.join("\n---\n"));
    assert.match(pages[1], /Table of Contents Cover Letter Section A: Company Profile A\.1 Company Overview Declaration/);
    // Page numbers are filled in once every heading has been placed, so they
    // follow the entries in the text layer — in entry order.
    const numbers = pages[1].split("Declaration")[1].replace(/Page \d+ of \d+/, "").match(/\b\d+\b/g)?.map(Number);
    assert.deepEqual(numbers, [3, 4, 4, 5]);
    assert.match(pages[2], /^.*Cover Letter/);
    assert.match(pages[4], /Declaration/);
    // The declaration's rule is drawn as signing lines, not printed as underscores.
    assert.match(pages[4], /Signature/);
    assert.doesNotMatch(pages[4], /_{3,}/);
    // The cover carries no running header or page number.
    assert.doesNotMatch(pages[0], /Page 1 of/);
    assert.match(pages[2], /Page 3 of 5/);
  });

  it("keeps numbered list items numbered", async () => {
    const pages = await pdfPages(await generateProposalPdf({ title: "Tender", markdown: "# Approach\n\n1. Inception\n2. Design\n" }));
    assert.match(pages.join(" "), /1\. Inception 2\. Design/);
  });

  it("keeps a short table whole instead of stranding its last row", async () => {
    const filler = Array.from({ length: 44 }, (_, i) => `Line ${i + 1} of running text that fills the page.`).join("\n\n");
    const table = ["| Element | Proposed delivery |", "|---|---|", ...Array.from({ length: 7 }, (_, i) => `| Row ${i + 1} | Delivery detail ${i + 1} |`)].join("\n");
    const pages = await pdfPages(await generateProposalPdf({ title: "Tender", markdown: `# Plan\n\n${filler}\n\n${table}\n` }));
    const withRows = pages.filter((p) => /Row \d/.test(p));
    assert.equal(withRows.length, 1, "all seven rows are on one page");
    assert.match(withRows[0], /Row 1[\s\S]*Row 7/);
  });

  it("sizes columns from their content", () => {
    const rows = [
      ["#", "Expert & Position", "Role on This Assignment"],
      ["1", "Jane Doe — Team Leader", "Leads design review and the coordination of every discipline across all phases of the assignment"],
    ];
    const widths = tableColumnWidths(rows, (text) => text.length * 5, 480, 6);
    assert.equal(Math.round(widths.reduce((a, b) => a + b, 0)), 480);
    assert.ok(widths[0] < 60, `the "#" column is narrow (${widths[0]})`);
    assert.ok(widths[2] > widths[1], "the longest column gets the most room");
  });

  it("builds the contents from the document's own section and subsection headings", () => {
    const plan = planTableOfContents([
      { type: "h1", text: "Table of Contents" },
      { type: "body", text: "Cover Letter" },
      { type: "h1", text: "Cover Letter" },
      { type: "h2", text: "A.1 Company Overview" },
      { type: "h3", text: "Jane Doe" },
    ]);
    assert.ok(plan);
    assert.deepEqual(plan.entries.map((e) => [e.level, e.text]), [[1, "Cover Letter"], [2, "A.1 Company Overview"]]);
  });
});
