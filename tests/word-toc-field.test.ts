import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Packer } from "docx";
import JSZip from "jszip";
import { buildProfessionalDocument, markdownToDocx } from "../lib/engine/generate-elite";

describe("final DOCX dynamic table of contents", () => {
  async function renderAndInspect(tocHeading: "#" | "##") {
    const children = markdownToDocx([
      "# Technical Proposal",
      "",
      `${tocHeading} Table of Contents`,
      "1. **Technical Proposal**",
      "    - Delivery Methodology",
      "### Nested static TOC entry",
      "",
      `${tocHeading} Delivery Methodology`,
      "",
      "### Mobilisation",
      "Grounded delivery content.",
    ].join("\n"));
    const bytes = await Packer.toBuffer(buildProfessionalDocument({
      tenderTitle: "Grounded Tender",
      clientName: "Procuring Entity",
      companyName: "Evidence Company",
      children,
      suppressCoverBlock: true,
      suppressBrandedHeader: true,
    }));

    assert.equal(bytes.subarray(0, 2).toString("latin1"), "PK");
    const zip = await JSZip.loadAsync(bytes);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    const settingsXml = await zip.file("word/settings.xml")?.async("string");

    return { documentXml: documentXml ?? "", settingsXml: settingsXml ?? "" };
  }

  for (const tocHeading of ["#", "##"] as const) {
    it(`writes an updating Word TOC field for a ${tocHeading.length === 1 ? "level-1" : "level-2"} markdown TOC`, async () => {
      const { documentXml, settingsXml } = await renderAndInspect(tocHeading);

      assert.match(documentXml, /TOC (?=[^<]*\\h)(?=[^<]*\\o (?:&quot;|")1-3(?:&quot;|"))/, "DOCX must contain a hyperlinking Word TOC field over Heading 1–3");
      assert.equal(documentXml.match(/>Delivery Methodology<\/w:t>/g)?.length, 1, "static markdown TOC entries must not be emitted alongside the field");
      assert.ok(!documentXml.includes(">Nested static TOC entry</w:t>"), "nested static markdown TOC entries must be removed");
      assert.match(settingsXml, /<w:updateFields(?:\s+w:val="true")?\s*\/>/, "Word must refresh fields on open");
    });
  }

  it("does not apply a Word heading style to the TOC title, preventing self-inclusion", async () => {
    const { documentXml } = await renderAndInspect("#");
    const titleIndex = documentXml.indexOf(">Table of Contents</w:t>");
    assert.ok(titleIndex > 0);
    const titleParagraph = documentXml.slice(documentXml.lastIndexOf("<w:p>", titleIndex), documentXml.indexOf("</w:p>", titleIndex));
    assert.doesNotMatch(titleParagraph, /<w:pStyle w:val="Heading[123]"\/>/);
  });
});
