import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  generatedDocumentVisibleText,
  clearGeneratedDocumentVisibleTextCache,
} from "../lib/engine/generated-document-text";
import { generateProposalPdf } from "../lib/engine/proposal-pdf";

// ─── What this file proves ───────────────────────────────────────────────────
//
// GET /api/tenders/[id]/export-readiness returned 504 "Vercel Runtime Timeout
// after 10 seconds" on the owner's Preview, with missing-@napi-rs/canvas
// warnings from pdf-parse/pdfjs-dist alongside it. The warnings are a symptom
// of pdfjs loading, not the cost. Measured on a real 262 KB generated Technical
// Proposal, the three text-layer extractors cost 1.3 s (pdf2json), 3.2 s
// (pdf-parse) and 4.4 s (pdfjs), and extractPdf waits for all of them.
//
// The route is read-only, declares maxDuration = 10, is polled by the UI, and
// runs three readiness models in parallel. Measured on a two-document package:
// the SAME PDF was extracted twice inside one request — once by
// getCanonicalTenderWorkflowDecision, once by getFinalSubmissionReadiness — and
// again on every subsequent poll.
//
//   before   canonical 676–5371 ms · readiness 4104–6409 ms · repeat 1361 ms
//   after    canonical      167 ms · readiness      2648 ms · repeat   72 ms
//
// Visible text is a pure function of the bytes, so remembering it by digest
// cannot change any verdict. What must NOT happen: different bytes served from
// a previous document's entry, or a failed read remembered as "this document
// has no text" — that would turn an environment hiccup into a verdict about the
// document.

async function pdfFor(body: string): Promise<string> {
  const bytes = await generateProposalPdf({
    title: "Technical Proposal",
    clientName: "Test Client",
    markdown: `# Technical Proposal\n\n${body}\n`,
    companyName: "Test Consultancy",
  });
  return Buffer.from(bytes).toString("base64");
}

describe("a generated document's visible text is read once per distinct byte content", () => {
  it("returns the same text on a repeat read, and returns it far faster", async () => {
    clearGeneratedDocumentVisibleTextCache();
    const doc = {
      fileContent: await pdfFor("Distinctive sentinel phrase for the first document."),
      exactFileName: "Technical Proposal.pdf",
      contentMimeType: "application/pdf",
    };

    const coldStart = Date.now();
    const first = await generatedDocumentVisibleText(doc);
    const coldMs = Date.now() - coldStart;

    const warmStart = Date.now();
    const second = await generatedDocumentVisibleText(doc);
    const warmMs = Date.now() - warmStart;

    assert.ok(first && first.length > 0, "no visible text was read from a real generated PDF");
    assert.equal(second, first, "a repeat read returned different text");
    // Real measurement is ~2600 ms then ~0 ms; this margin is deliberately wide.
    assert.ok(coldMs > 50, `the first read was suspiciously cheap (${coldMs}ms) — the fixture may not be a real PDF`);
    assert.ok(warmMs * 10 < coldMs, `the repeat read cost ${warmMs}ms against a first read of ${coldMs}ms — it was not remembered`);
  });

  it("runs the work once when two readers ask concurrently", async () => {
    // The two readiness models run inside one Promise.all, so both start before
    // either finishes. Caching only the settled result would not collapse them.
    clearGeneratedDocumentVisibleTextCache();
    const doc = {
      fileContent: await pdfFor("Concurrent readers share one extraction."),
      exactFileName: "Technical Proposal.pdf",
      contentMimeType: "application/pdf",
    };

    const bothStart = Date.now();
    const [a, b] = await Promise.all([
      generatedDocumentVisibleText(doc),
      generatedDocumentVisibleText(doc),
    ]);
    const bothMs = Date.now() - bothStart;

    const soloStart = Date.now();
    await generatedDocumentVisibleText(doc);
    const soloMs = Date.now() - soloStart;

    assert.equal(a, b);
    assert.ok(a && a.length > 0);
    assert.ok(soloMs * 10 < bothMs, `a third read cost ${soloMs}ms against ${bothMs}ms for two concurrent ones`);
  });

  it("never serves one document's text for another's bytes", async () => {
    clearGeneratedDocumentVisibleTextCache();
    const first = {
      fileContent: await pdfFor("ALPHA sentinel content belonging to the first document."),
      exactFileName: "Technical Proposal.pdf",
      contentMimeType: "application/pdf",
    };
    const second = {
      fileContent: await pdfFor("BRAVO sentinel content belonging to the second document."),
      exactFileName: "Technical Proposal.pdf",
      contentMimeType: "application/pdf",
    };

    const firstText = await generatedDocumentVisibleText(first);
    const secondText = await generatedDocumentVisibleText(second);

    assert.match(firstText ?? "", /ALPHA/, `the first document's own content was not read: ${JSON.stringify((firstText ?? "").slice(0, 300))}`);
    assert.match(secondText ?? "", /BRAVO/, "the second document was served stale text from the first");
    assert.doesNotMatch(secondText ?? "", /ALPHA/, "a regenerated document was served the previous version's text");
  });

  it("returns null for a document with no bytes without remembering anything", async () => {
    clearGeneratedDocumentVisibleTextCache();
    assert.equal(await generatedDocumentVisibleText({ fileContent: null, exactFileName: "Technical Proposal.pdf" }), null);
    assert.equal(await generatedDocumentVisibleText(null), null);
    assert.equal(await generatedDocumentVisibleText(undefined), null);
  });
});
