// CodeQL findings on the promotion PR (#1308) that were real in shipped code.
//
// Two regexes backtracked exponentially on short inputs a tenant controls: the
// professional-title pattern over the 140 characters before a registration
// number in a CV, and the Title-Case test for a document name of up to 90
// characters in tender text. Both ran inside the analysis worker that drains
// every tenant's queue. Three entity decoders turned "&amp;" into "&" before
// decoding "&lt;", so the text "&lt;" read as "<".

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { Document, Packer, Paragraph, TextRun } from "docx";
import JSZip from "jszip";
import { licencesNamedInCv } from "../lib/engine/cv-grounding";
import { statesDocumentObligation } from "../lib/engine/source-driven-tender-text-parser";
import { extractDocxVisibleText } from "../lib/engine/export-readiness";
import { extractTextFromBuffer } from "../lib/extract-text";

const elapsed = (run: () => unknown) => {
  const start = process.hrtime.bigint();
  run();
  return Number(process.hrtime.bigint() - start) / 1e6;
};

describe("the flagged regexes run in linear time", () => {
  it("a CV title followed by a long run of '()' before a registration number", () => {
    for (const run of ["()", "(()", "(())", "((x)"]) {
      const cv = `Licence: Civil Engineer${run.repeat(Math.floor(110 / run.length))} x EHT/1234`;
      const ms = elapsed(() => licencesNamedInCv(cv));
      assert.ok(ms < 500, `${run}: took ${ms.toFixed(0)} ms`);
    }
  });

  it("the professional title is still read", () => {
    assert.deepEqual(licencesNamedInCv("Professional Engineer (PE) Reg. No. EHT/1234"), ["Professional Engineer (PE), Reg. No. EHT/1234"]);
    assert.deepEqual(licencesNamedInCv("Licensed Civil Engineer (Reg. No. CWA/5678)"), ["Licensed Civil Engineer, Reg. No. CWA/5678"]);
    assert.deepEqual(licencesNamedInCv("Professional Engineer (Grade I (Civil)) Reg No. EHT/1234"), ["Professional Engineer, Reg. No. EHT/1234"], "a nested qualifier");
  });

  it("a long Title-Cased name with doubled whitespace in a tender obligation", () => {
    // "B", not "A": a leading article is stripped before the name is tested.
    const text = `The bidder shall submit B${"\t\tB".repeat(28)}!`;
    const ms = elapsed(() => statesDocumentObligation(text));
    assert.ok(ms < 1000, `took ${ms.toFixed(0)} ms`);
    assert.equal(statesDocumentObligation("The bidder shall submit a Bill of Quantities and a Power of Attorney."), true, "Title-Cased names are still read");
  });
});

describe("entities are decoded once", () => {
  const LITERAL = "Write &lt;b&gt; and AT&amp;T literally";

  it("DOCX visible text (export readiness) and DOCX extraction keep the literal entity text", async () => {
    const doc = new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun(LITERAL)] })] }] });
    const buffer = await Packer.toBuffer(doc);
    const visible = await extractDocxVisibleText(buffer.toString("base64"), "t.docx");
    assert.ok(visible?.includes(LITERAL), visible ?? "null");
    const extracted = await extractTextFromBuffer(buffer, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "t.docx");
    assert.ok(extracted.includes(LITERAL), extracted);
  });

  it("PPTX slide text keeps the literal entity text", async () => {
    const zip = new JSZip();
    zip.file("ppt/slides/slide1.xml", `<p:sld xmlns:a="a" xmlns:p="p"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Write &amp;lt;b&amp;gt; and AT&amp;amp;T literally</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const text = await extractTextFromBuffer(buffer, "application/vnd.openxmlformats-officedocument.presentationml.presentation", "deck.pptx");
    assert.ok(text.includes(LITERAL), text);
  });
});
