// A letterhead that applies to nothing must say why.
//
// Reproduced defect (live Preview, tender 08e250af, inspects 34515490681 /
// 34588881212 / 34589272707). Every PROPOSAL_GENERATION run across two days
// recorded:
//
//   step proposal.letterhead [RUNNING]: Applying active Company Vault letterhead branding
//   step proposal.complete  [SUCCEEDED]: Generated 3 document(s)
//      (TECHNICAL_PROPOSAL, PDF, COMPANY_PROFILE); letterhead applied to 0 file(s)
//
// with an active, valid Word letterhead (LetterHead_repaired.docx, 126,100
// bytes), no branding prohibition in the tender, branding permitted in
// settings, and — from the audit — storage-backed=0, inline-only=33 of 33.
//
// Five candidate causes had to be ruled out one at a time against live data,
// each costing a hosted run, because the only thing any surface reported was
// the number zero. The owner sees strictly less than that: branding is simply
// missing from their documents, with no statement anywhere that anything was
// skipped or why.
//
// The defect being fixed is the silence, not the skipping. Every skip here is
// still a skip; the difference is that the count now arrives with its reason.
// Nothing is forced: a tender that prohibits branding still gets none, and an
// asset merely existing is still not an instruction to apply it.
//
// Generic: nothing here keys on a sector, a document type, or a tender.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import JSZip from "jszip";

import { applyUploadedDocxLetterheadTemplateWithReason } from "../lib/engine/docx-letterhead-template";

/** A minimal .docx whose branding sits in the BODY, with no header/footer. */
async function docxWithoutHeaderOrFooter(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types></Types>");
  zip.file("word/document.xml", "<w:document><w:body><w:p>ACME LTD — 1 High Street</w:p></w:body></w:document>");
  zip.file("word/_rels/document.xml.rels", "<Relationships></Relationships>");
  return zip.generateAsync({ type: "nodebuffer" });
}

/** A .docx that does reference a default header, and carries that part. */
async function docxWithHeader(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types></Types>");
  zip.file(
    "word/document.xml",
    '<w:document><w:body><w:sectPr><w:headerReference w:type="default" r:id="rId7"/></w:sectPr></w:body></w:document>',
  );
  zip.file(
    "word/_rels/document.xml.rels",
    '<Relationships><Relationship Id="rId7" Target="header3.xml"/></Relationships>',
  );
  zip.file("word/header3.xml", "<w:hdr>ACME LTD</w:hdr>");
  return zip.generateAsync({ type: "nodebuffer" });
}

/** A generated document with a header part to overwrite. */
async function generatedDocx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types></Types>");
  zip.file("word/document.xml", "<w:document><w:body><w:p>Proposal</w:p></w:body></w:document>");
  zip.file("word/_rels/document.xml.rels", "<Relationships></Relationships>");
  zip.file("word/header1.xml", "<w:hdr>placeholder</w:hdr>");
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("a letterhead that applies to nothing says why", () => {
  it("body-only letterhead: unchanged bytes, and the reason names header/footer", async () => {
    // The case most likely to be live, and the one an owner cannot guess:
    // the file is a valid .docx and looks right in Word, but Word only
    // repeats letterhead per page from the header/footer area.
    const generated = await generatedDocx();
    const outcome = await applyUploadedDocxLetterheadTemplateWithReason(generated, await docxWithoutHeaderOrFooter());

    assert.equal(outcome.applied, false);
    assert.ok(outcome.buffer.equals(generated), "the document must come back untouched");
    assert.ok(outcome.reason, "a zero must never be silent");
    assert.match(outcome.reason!, /header/i);
    assert.match(outcome.reason!, /footer/i);
    // Actionable, not just descriptive.
    assert.match(outcome.reason!, /upload/i);
  });

  it("a real header letterhead still applies, and reports no reason", async () => {
    // Guard the premise: if branding stopped working, the assertions above
    // would pass while the feature was broken.
    const generated = await generatedDocx();
    const outcome = await applyUploadedDocxLetterheadTemplateWithReason(generated, await docxWithHeader());

    assert.equal(outcome.applied, true, "a header-bearing letterhead must still be applied");
    assert.equal(outcome.reason, null, "a success must not carry a skip reason");
    assert.ok(!outcome.buffer.equals(generated), "the branded document must differ from the input");
  });

  it("bytes that are not a Word package are named as such, not silently dropped", async () => {
    const generated = await generatedDocx();
    const outcome = await applyUploadedDocxLetterheadTemplateWithReason(generated, Buffer.from("%PDF-1.7 not a docx"));

    assert.equal(outcome.applied, false);
    assert.ok(outcome.buffer.equals(generated));
    assert.ok(outcome.reason, "an unreadable template must explain itself");
  });

  it("no template at all is still explained", async () => {
    const generated = await generatedDocx();
    const outcome = await applyUploadedDocxLetterheadTemplateWithReason(generated, undefined);

    assert.equal(outcome.applied, false);
    assert.ok(outcome.buffer.equals(generated));
    assert.ok(outcome.reason);
  });

  it("the legacy buffer-returning wrapper is unchanged for its callers", async () => {
    // The wrapper exists so this fix stays additive. If it started returning
    // something else, callers that only want bytes would break silently.
    const { applyUploadedDocxLetterheadTemplate } = await import("../lib/engine/docx-letterhead-template");
    const generated = await generatedDocx();
    const bytes = await applyUploadedDocxLetterheadTemplate(generated, await docxWithoutHeaderOrFooter());
    assert.ok(Buffer.isBuffer(bytes));
    assert.ok(bytes.equals(generated));
  });

  it("every caller reads .applied rather than the result object", async () => {
    // The typechecker caught only two of the five call sites: the other three
    // put the value into a metadata field or discarded it, where an object
    // where a number belongs type-checks fine and ships wrong. Assert the
    // wiring the compiler cannot.
    const { readFileSync } = await import("node:fs");
    const callers = [
      "app/api/tenders/[id]/generate/route.ts",
      "app/api/tenders/[id]/repair-export-gaps/route.ts",
      "app/api/tenders/[id]/auto-finalize/route.ts",
      "lib/engine/export-gap-repair.ts",
      "lib/ai-job-handlers-legacy.ts",
    ];
    for (const file of callers) {
      const src = readFileSync(file, "utf8");
      const at = src.indexOf("applyActiveUploadedLetterheadToTenderDocuments(");
      assert.ok(at > -1, `${file} no longer calls the letterhead applier`);
      const call = src.slice(at, at + 500);
      assert.match(
        call,
        /\.applied|letterheadOutcome/,
        `${file} uses the applier result without unwrapping .applied`,
      );
    }
  });
});
