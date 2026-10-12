import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { extractTextFromBuffer } from "../lib/extract-text";
import { generateProposalPdf } from "../lib/engine/proposal-pdf";

// ─── What this file proves ───────────────────────────────────────────────────
//
// Reproduced on this checkout: parse one generated proposal PDF, then parse a
// second, structurally similar one (same page count, same layout, one paragraph
// different) in the same process, and pdf2json returns the FIRST document's
// text for the second — every time, sequentially or concurrently, with a fresh
// `new PDFParser()` per call and even after deleting the module from
// require.cache. Giving each PDF a unique trailer /ID did not change it.
//
// It was not a scoring problem: the selection picks the highest-quality
// non-corrupted text, and another document's text is clean and well-formed, so
// it wins. A validator then judges a regenerated proposal against the bytes of
// the previous version — a source-grounding failure, not a cosmetic one. Two
// obviously different PDFs never collided, which is why it stayed invisible:
// the case it breaks on is exactly this app's own regenerated proposals.
//
// pdf2json is now consulted only when both trustworthy engines return nothing
// usable, so the bleed is unreachable on the normal path while the engine stays
// available for the awkward PDFs it was added for.

const EXTRACT_SOURCE = readFileSync(path.join(process.cwd(), "lib/extract-text.ts"), "utf8");

async function proposalPdf(body: string): Promise<Buffer> {
  const bytes = await generateProposalPdf({
    title: "Technical Proposal",
    clientName: "Test Client",
    markdown: `# Technical Proposal\n\n${body}\n`,
    companyName: "Test Consultancy",
  });
  return Buffer.from(bytes);
}

describe("PDF extraction returns the document it was given", () => {
  it("reads each of two structurally similar proposals as itself", async () => {
    const alpha = await proposalPdf("ALPHASENTINEL content belonging to the first document.");
    const bravo = await proposalPdf("BRAVOSENTINEL content belonging to the second document.");

    // Repeated because the defect needed a prior parse in the same process:
    // the first read was always right, the second was not.
    for (let round = 0; round < 3; round += 1) {
      const alphaText = await extractTextFromBuffer(alpha, "application/pdf", "Technical Proposal.pdf");
      const bravoText = await extractTextFromBuffer(bravo, "application/pdf", "Technical Proposal.pdf");

      assert.match(alphaText, /ALPHASENTINEL/, `round ${round}: the first document did not read as itself`);
      assert.doesNotMatch(alphaText, /BRAVOSENTINEL/, `round ${round}: the first document was read as the second`);
      assert.match(bravoText, /BRAVOSENTINEL/, `round ${round}: the second document did not read as itself`);
      assert.doesNotMatch(bravoText, /ALPHASENTINEL/, `round ${round}: the second document was read as the first`);
    }
  });

  it("keeps pdf2json out of the primary extractor set", async () => {
    // Pinned in the source as well as in behaviour: the behavioural test above
    // only fails when pdf2json happens to win the race, so on its own it could
    // pass a regression by luck.
    const primary = EXTRACT_SOURCE.match(/const primaryExtractors = \[[\s\S]*?\];/)?.[0] ?? "";
    const lastResort = EXTRACT_SOURCE.match(/const lastResortExtractors = \[[\s\S]*?\];/)?.[0] ?? "";
    assert.ok(primary.length > 0, "the primary extractor set is gone");
    assert.ok(lastResort.length > 0, "the last-resort extractor set is gone");
    assert.doesNotMatch(primary, /pdf2json/, "pdf2json was promoted back into the primary extractors");
    assert.match(lastResort, /pdf2json/, "pdf2json is no longer available as a last resort");
    assert.match(primary, /pdf-parse/);
    assert.match(primary, /pdfjs/);
  });

  it("still falls back to the last-resort engine only when the primaries read nothing", () => {
    assert.match(
      EXTRACT_SOURCE,
      /const primaryUsable = results\.some\(\(r\) => r\.text && r\.text\.length >= 20\);\s*\n\s*if \(!primaryUsable\) await runExtractors\(lastResortExtractors\);/,
      "the last-resort engine is no longer gated on the primaries producing nothing",
    );
  });
});

describe("a generated proposal PDF carries a document identity", () => {
  it("gives different proposals different trailer /ID values", async () => {
    const first = await proposalPdf("First proposal body.");
    const second = await proposalPdf("Second proposal body.");
    const idOf = (buf: Buffer) => (buf.toString("latin1").match(/\/ID\s*\[([^\]]*)\]/) ?? [])[1]?.trim() ?? "";

    assert.ok(idOf(first).length > 0, "the generated PDF carries no trailer /ID at all");
    assert.notEqual(idOf(first), idOf(second), "two different proposals share one document identity");
  });

  it("gives identical content the same identity", async () => {
    const a = await proposalPdf("Stable body text.");
    const b = await proposalPdf("Stable body text.");
    const idOf = (buf: Buffer) => (buf.toString("latin1").match(/\/ID\s*\[([^\]]*)\]/) ?? [])[1]?.trim() ?? "";
    assert.equal(idOf(a), idOf(b), "identical content produced two different identities");
  });
});
