// Tests for lib/engine/tender-form-completion-gate.ts (Gap 1).
//
// The gate inspects reused tender-issued form bytes for unfilled mandatory
// fields. It must:
//
//   - detect bracketed [INSERT ...] placeholders as MANDATORY
//   - detect <TO BE COMPLETED> markers as MANDATORY
//   - detect long underscore fill-in lines as MANDATORY
//   - detect empty PDF AcroForm fields (best-effort regex)
//   - detect empty DOCX content controls (best-effort regex)
//   - return complete=true when no mandatory issues are found
//   - return complete=false when any mandatory issue is found
//   - isTenderFormLike detects tender-form filenames and the reuse provenance marker

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  detectFormCompletionIssues,
  isTenderFormLike,
  populateCompanyFieldsSafely,
} from "../lib/engine/tender-form-completion-gate";

function makeTextForm(text: string): Buffer {
  return Buffer.from(text, "utf8");
}

describe("tender-form-completion-gate — detectFormCompletionIssues", () => {
  it("returns complete=true for a form with no placeholder patterns", () => {
    const bytes = makeTextForm("Bidder Name: Acme Construction\nDate: 2026-08-03\nSignature: J. Smith");
    const report = detectFormCompletionIssues({
      documentId: "doc-1",
      fileName: "Bid-Form.txt",
      mimeType: "text/plain",
      bytes,
    });
    assert.equal(report.complete, true);
    assert.equal(report.missingMandatory.length, 0);
  });

  it("flags [INSERT BIDDER NAME] as MANDATORY", () => {
    const bytes = makeTextForm("Bidder Name: [INSERT BIDDER NAME]\nDate: 2026-08-03");
    const report = detectFormCompletionIssues({
      documentId: "doc-2",
      fileName: "Bid-Form.txt",
      mimeType: "text/plain",
      bytes,
    });
    assert.equal(report.complete, false);
    assert.ok(report.missingMandatory.length >= 1);
    assert.ok(report.missingMandatory.some((i) => i.type === "PLACEHOLDER_TEXT" && /INSERT/.test(i.label)));
  });

  it("flags <TO BE COMPLETED> as MANDATORY", () => {
    const bytes = makeTextForm("Bidder Name: <TO BE COMPLETED>\nDate: 2026-08-03");
    const report = detectFormCompletionIssues({
      documentId: "doc-3",
      fileName: "Bid-Form.txt",
      mimeType: "text/plain",
      bytes,
    });
    assert.equal(report.complete, false);
    assert.ok(report.missingMandatory.some((i) => /TO BE COMPLETED/.test(i.label)));
  });

  it("flags a long underscore fill-in line as MANDATORY", () => {
    const bytes = makeTextForm("Bidder Name: ________________________\nDate: 2026-08-03");
    const report = detectFormCompletionIssues({
      documentId: "doc-4",
      fileName: "Bid-Form.txt",
      mimeType: "text/plain",
      bytes,
    });
    assert.equal(report.complete, false);
    assert.ok(report.missingMandatory.some((i) => i.type === "PLACEHOLDER_TEXT"));
  });

  it("does NOT flag a short underscore (3 chars) as a fill-in line", () => {
    // Short underscores are common in normal text (e.g., file_naming); only
    // long underscores (6+) indicate a fill-in line.
    const bytes = makeTextForm("File name: my_doc\nDate: 2026-08-03");
    const report = detectFormCompletionIssues({
      documentId: "doc-5",
      fileName: "Bid-Form.txt",
      mimeType: "text/plain",
      bytes,
    });
    // No underscore fill-in line — should not be flagged for that pattern.
    assert.ok(!report.missingMandatory.some((i) => i.key === "placeholder:underscore-line"));
  });

  it("flags 'Bidder Name:' with empty value as MANDATORY TEXT field", () => {
    const bytes = makeTextForm("Bidder Name: \nDate: 2026-08-03");
    const report = detectFormCompletionIssues({
      documentId: "doc-6",
      fileName: "Bid-Form.txt",
      mimeType: "text/plain",
      bytes,
    });
    assert.equal(report.complete, false);
    assert.ok(report.missingMandatory.some((i) => i.type === "TEXT" && /bidder/i.test(i.label)));
  });

  it("flags 'Signature:' with empty value as MANDATORY SIGNATURE field", () => {
    const bytes = makeTextForm("Bidder Name: Acme\nSignature: \nDate: 2026-08-03");
    const report = detectFormCompletionIssues({
      documentId: "doc-7",
      fileName: "Bid-Form.txt",
      mimeType: "text/plain",
      bytes,
    });
    assert.equal(report.complete, false);
    assert.ok(report.missingMandatory.some((i) => i.type === "SIGNATURE"));
  });

  it("deduplicates issues by key — one [INSERT] pattern produces one issue", () => {
    const bytes = makeTextForm("[INSERT NAME] [INSERT NAME] [INSERT NAME]");
    const report = detectFormCompletionIssues({
      documentId: "doc-8",
      fileName: "Bid-Form.txt",
      mimeType: "text/plain",
      bytes,
    });
    const insertIssues = report.missingMandatory.filter((i) => i.key === "placeholder:insert-bracket");
    assert.equal(insertIssues.length, 1);
  });

  it("caps the number of PDF AcroForm fields inspected (200 max)", () => {
    // Construct a synthetic PDF byte stream with 250 /T(...) field markers.
    // The gate should cap at 200 inspections. Use mandatory-looking names
    // ("bidder_name_X") so they're classified as MANDATORY.
    let s = "%PDF-1.7\n";
    for (let i = 0; i < 250; i++) {
      s += `/T(bidder_name_${i}) /V()\n`;
    }
    const bytes = Buffer.from(s, "latin1");
    const report = detectFormCompletionIssues({
      documentId: "doc-9",
      fileName: "Bid-Form.pdf",
      mimeType: "application/pdf",
      bytes,
    });
    // Should have inspected up to 200 fields (the cap). Each empty /V() is one issue.
    assert.ok(report.missingMandatory.length <= 200);
    assert.ok(report.missingMandatory.length > 100); // at least the first 100 mandatory-named fields
  });

  it("handles a real-looking PDF with one empty AcroForm field", () => {
    // Minimal synthetic PDF with one AcroForm field "BidderName" and no /V.
    const pdf = `%PDF-1.7
1 0 obj << /Type /Catalog /AcroForm << /Fields [2 0 R] >> >>
endobj
2 0 obj << /T (BidderName) /FT /Tx /V () >>
endobj
trailer << /Root 1 0 R >>
%%EOF`;
    const bytes = Buffer.from(pdf, "latin1");
    const report = detectFormCompletionIssues({
      documentId: "doc-10",
      fileName: "Bid-Form.pdf",
      mimeType: "application/pdf",
      bytes,
    });
    // BidderName contains "name" → mandatory. Empty /V() → flagged.
    assert.ok(report.missingMandatory.some((i) => /BidderName/.test(i.label)));
  });

  it("handles a DOCX with an empty content control", () => {
    // Minimal synthetic DOCX: just the document.xml part with one <w:sdt>
    // block whose <w:sdtContent> is empty.
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:sdt>
      <w:sdtPr>
        <w:alias w:val="BidderName"/>
        <w:tag w:val="bidder_name"/>
      </w:sdtPr>
      <w:sdtContent>
        <w:p/>
      </w:sdtContent>
    </w:sdt>
  </w:body>
</w:document>`;
    // Construct a minimal valid ZIP-like structure for the gate's regex extractor.
    // The gate scans for the local file header signature + name "word/document.xml".
    const name = "word/document.xml";
    const nameBytes = Buffer.from(name, "utf8");
    const payload = Buffer.from(xml, "utf8");
    // Use method=0 (stored) so we don't need to compress.
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(0, 8); // method = 0 (stored)
    localHeader.writeUInt16LE(0, 10); // time
    localHeader.writeUInt16LE(0, 12); // date
    localHeader.writeUInt32LE(0, 14); // crc32 (we don't check)
    localHeader.writeUInt32LE(payload.length, 18); // compressed size
    localHeader.writeUInt32LE(payload.length, 22); // uncompressed size
    localHeader.writeUInt16LE(nameBytes.length, 26); // name length
    localHeader.writeUInt16LE(0, 28); // extra length
    const bytes = Buffer.concat([localHeader, nameBytes, payload]);

    const report = detectFormCompletionIssues({
      documentId: "doc-11",
      fileName: "Bid-Form.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes,
    });
    // The content control "BidderName" is empty (only <w:p/>) → flagged.
    assert.ok(
      report.missingMandatory.some((i) => /BidderName/.test(i.label)),
      `Expected BidderName issue, got: ${JSON.stringify(report.missingMandatory)}`,
    );
  });

  it("returns complete=true when visibleText is provided and clean", () => {
    const bytes = makeTextForm("");
    const report = detectFormCompletionIssues({
      documentId: "doc-12",
      fileName: "Bid-Form.pdf",
      mimeType: "application/pdf",
      bytes,
      visibleText: "Bidder Name: Acme\nDate: 2026-08-03\nSignature: J. Smith",
    });
    assert.equal(report.complete, true);
  });

  it("never throws on a malformed PDF — returns empty issues", () => {
    const bytes = Buffer.from("not actually a pdf", "utf8");
    const report = detectFormCompletionIssues({
      documentId: "doc-13",
      fileName: "Bid-Form.pdf",
      mimeType: "application/pdf",
      bytes,
    });
    assert.ok(Array.isArray(report.missingMandatory));
    // No fields detected → complete=true (the gate cannot prove anything is
    // missing, so it fails OPEN for the field-detection layer. The export
    // gate still requires READY_FOR_EXPORT — the gate's job is to surface
    // detected missing fields, not to block on inability to scan).
    assert.equal(report.complete, true);
  });
});

describe("tender-form-completion-gate — isTenderFormLike", () => {
  it("returns true for 'Bid-Form.pdf'", () => {
    assert.equal(isTenderFormLike({ fileName: "Bid-Form.pdf" }), true);
  });

  it("returns true for 'Tender-Form.docx'", () => {
    assert.equal(isTenderFormLike({ fileName: "Tender-Form.docx" }), true);
  });

  it("returns true for 'Annex-A.pdf'", () => {
    assert.equal(isTenderFormLike({ fileName: "Annex-A.pdf" }), true);
  });

  it("returns true for 'Declaration-of-Compliance.docx'", () => {
    assert.equal(isTenderFormLike({ fileName: "Declaration-of-Compliance.docx" }), true);
  });

  it("returns true for 'Bid-Bond.pdf'", () => {
    assert.equal(isTenderFormLike({ fileName: "Bid-Bond.pdf" }), true);
  });

  it("returns true for 'Tax-Clearance.pdf'", () => {
    assert.equal(isTenderFormLike({ fileName: "Tax-Clearance.pdf" }), true);
  });

  it("returns true when contentSummary carries the reuse marker", () => {
    assert.equal(
      isTenderFormLike({
        fileName: "any-file.pdf",
        reviewNotes: "machine:tender-issued-form-reuse — bytes copied unchanged",
      }),
      true,
    );
  });

  it("returns false for a technical proposal filename", () => {
    assert.equal(isTenderFormLike({ fileName: "Technical-Proposal.docx" }), false);
  });

  it("returns false for a methodology document", () => {
    assert.equal(isTenderFormLike({ fileName: "Methodology.docx" }), false);
  });

  it("returns true for FORM_TEMPLATE_TO_COMPLETE document type", () => {
    assert.equal(isTenderFormLike({ fileName: "any.docx", documentType: "FORM_TEMPLATE_TO_COMPLETE" }), true);
  });
});

describe("tender-form-completion-gate — populateCompanyFieldsSafely", () => {
  it("returns null when no fields match", async () => {
    const result = await populateCompanyFieldsSafely({
      documentId: "doc-1",
      fileName: "Bid-Form.txt",
      mimeType: "text/plain",
      bytes: makeTextForm("Hello world, no fields here."),
      company: { name: "Acme Construction" },
    });
    assert.equal(result, null);
  });

  it("populates a [INSERT BIDDER NAME] placeholder", async () => {
    const result = await populateCompanyFieldsSafely({
      documentId: "doc-2",
      fileName: "Bid-Form.txt",
      mimeType: "text/plain",
      bytes: makeTextForm("Bidder Name: [INSERT BIDDER NAME]\nDate: 2026-08-03"),
      company: { name: "Acme Construction" },
    });
    assert.ok(result !== null);
    assert.ok(result.populated.some((p) => p.value === "Acme Construction"));
    assert.ok(result.bytes.toString("utf8").includes("Acme Construction"));
    assert.ok(!result.bytes.toString("utf8").includes("[INSERT BIDDER NAME]"));
    assert.match(result.sha256, /^[a-f0-9]{64}$/);
    assert.ok(result.byteLength > 0);
  });

  it("skips company attributes that are not set", async () => {
    const result = await populateCompanyFieldsSafely({
      documentId: "doc-3",
      fileName: "Bid-Form.txt",
      mimeType: "text/plain",
      bytes: makeTextForm("Bidder Name: [INSERT BIDDER NAME]\nTIN: [INSERT TIN NUMBER]"),
      company: { name: "Acme Construction", tinNumber: null },
    });
    assert.ok(result !== null);
    // name was populated, tinNumber was skipped (null)
    assert.ok(result.populated.some((p) => p.key === "company:name"));
    assert.ok(result.skipped.some((s) => s.key === "company:tinNumber"));
  });

  it("does not modify the original buffer", async () => {
    const originalText = "Bidder Name: [INSERT BIDDER NAME]";
    const originalBytes = makeTextForm(originalText);
    await populateCompanyFieldsSafely({
      documentId: "doc-4",
      fileName: "Bid-Form.txt",
      mimeType: "text/plain",
      bytes: originalBytes,
      company: { name: "Acme Construction" },
    });
    // The original buffer must be unchanged.
    assert.equal(originalBytes.toString("utf8"), originalText);
  });

  it("returns a different sha256 than the input when populated", async () => {
    const originalBytes = makeTextForm("Bidder Name: [INSERT BIDDER NAME]");
    const result = await populateCompanyFieldsSafely({
      documentId: "doc-5",
      fileName: "Bid-Form.txt",
      mimeType: "text/plain",
      bytes: originalBytes,
      company: { name: "Acme Construction" },
    });
    assert.ok(result !== null);
    // Compute the original sha256 and compare.
    const crypto = await import("node:crypto");
    const originalSha = crypto.createHash("sha256").update(originalBytes).digest("hex");
    assert.notEqual(result.sha256, originalSha);
  });
});
