// The opening polish may only restate the Cover Letter and Executive Summary,
// and a heading marker with no heading text is never printed.
//
// A hosted proposal delivered a Cover Letter that broke off mid-sentence
// ("... stresses healthcare design experience, and mandates"). After the
// structure repair, `humanizeOpeningSections` sent the first 5000 characters
// of the Cover Letter and Executive Summary to a model and pasted back
// whatever came back under each heading, with no check that the rewrite was
// whole. The same PDF printed a literal "##" under a model-written A.1
// paragraph: both renderers drew a bare heading marker as body text.
// Fixtures are generic.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { Packer } from "docx";
import JSZip from "jszip";

import { polishedOpeningProblem } from "../lib/engine/humanize";
import { buildProfessionalDocument, markdownToDocx } from "../lib/engine/generate-elite";
import { generateProposalPdf } from "../lib/engine/proposal-pdf";

const ORIGINAL = [
  "# Cover Letter",
  "",
  "Example Consulting submits this technical proposal for Clinic Design. The team of 5 experts has delivered 12 comparable projects since 2014.",
  "",
  "Sincerely,",
  "**A. Principal**, Reg. No. PE/1234",
].join("\n");

describe("an opening polish only restates the section", () => {
  it("accepts a rewrite that keeps every number and ends whole", () => {
    const rewrite = ORIGINAL.replace("submits this technical proposal for", "is pleased to submit its technical proposal for");
    assert.equal(polishedOpeningProblem(ORIGINAL, rewrite), null);
  });

  it("rejects a rewrite that stops mid-sentence", () => {
    const cut = "# Cover Letter\n\nExample Consulting submits this technical proposal for Clinic Design. The team of 5 experts has delivered 12 comparable projects since 2014, and mandates";
    assert.match(polishedOpeningProblem(ORIGINAL, cut) ?? "", /mid-sentence/);
  });

  it("rejects a rewrite that drops content or a number", () => {
    assert.match(polishedOpeningProblem(ORIGINAL, "# Cover Letter\n\nExample Consulting submits this proposal.\n\nSincerely,\n**A. Principal**") ?? "", /shorter|drops/);
    assert.match(polishedOpeningProblem(ORIGINAL, ORIGINAL.replace("12 comparable", "several comparable")) ?? "", /drops 12/);
  });

  it("rejects a rewrite that adds a number", () => {
    assert.match(polishedOpeningProblem(ORIGINAL, ORIGINAL.replace("5 experts", "5 experts with 120 years of combined practice")) ?? "", /adds 120/);
  });

  it("never sends a cut input and checks each rewrite before using it", () => {
    const src = readFileSync("lib/engine/humanize.ts", "utf8");
    const fn = src.slice(src.indexOf("export async function humanizeOpeningSections"));
    assert.doesNotMatch(fn, /combined\.slice\(/);
    assert.match(fn, /combined\.length > OPENING_POLISH_INPUT_LIMIT\) return markdown/);
    assert.match(fn, /polishedOpeningProblem\(original\.text, rewrite\.text\)/);
  });
});

describe("a heading marker with no heading text is not printed", () => {
  const markdown = "# Section A\n\nThe firm operates from its head office.\n\n##\n\n## \n\n## A.2 Team\n\nTeam text.\n";

  it("PDF", async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: await generateProposalPdf({ title: "Tender", markdown }), useSystemFonts: true }).promise;
    let text = "";
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      text += content.items.map((item) => ("str" in item ? item.str : "")).join(" ") + "\n";
    }
    assert.match(text, /A\.2 Team/);
    assert.doesNotMatch(text, /#/);
  });

  it("DOCX", async () => {
    const bytes = await Packer.toBuffer(buildProfessionalDocument({
      tenderTitle: "Clinic Design",
      clientName: "County Office",
      companyName: "Example Consulting",
      children: markdownToDocx(markdown),
    }));
    const xml = (await (await JSZip.loadAsync(bytes)).file("word/document.xml")?.async("string")) ?? "";
    assert.match(xml, />A\.2 Team</);
    assert.doesNotMatch(xml, /<w:t[^>]*>#+<\/w:t>/);
  });
});
