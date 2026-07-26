import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Packer } from "docx";
import JSZip from "jszip";
import { buildProfessionalDocument, markdownToDocx } from "../lib/engine/generate-elite";

describe("final DOCX dynamic table of contents", () => {
  it("writes an updating Word TOC field and removes the static markdown list", async () => {
    const children = markdownToDocx([
      "# Technical Proposal",
      "",
      "# Table of Contents",
      "1. **Technical Proposal**",
      "    - Delivery Methodology",
      "",
      "# Delivery Methodology",
      "",
      "## Mobilisation",
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

    assert.match(documentXml ?? "", /TOC (?=[^<]*\\h)(?=[^<]*\\o (?:&quot;|")1-3(?:&quot;|"))/, "DOCX must contain a hyperlinking Word TOC field over Heading 1–3");
    assert.equal(documentXml?.match(/>Delivery Methodology<\/w:t>/g)?.length, 1, "static markdown TOC entries must not be emitted alongside the field");
    assert.match(settingsXml ?? "", /<w:updateFields(?:\s+w:val="true")?\s*\/>/, "Word must refresh fields on open");
  });
});
