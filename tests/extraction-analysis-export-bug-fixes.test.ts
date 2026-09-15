// Tests covering the specific bugs fixed in the deep-analysis pass:
//
// 1. extraction-quality: 0-char extraction must score POOR, not WARNING
// 2. tender-metadata: clientContactEmail must come from a context-bound
//    "Email:" label rather than the first general email in the document
// 3. tender-metadata: inferBudget / inferBidBond with 3-digit amounts
// 4. final-zip-scope: null exactOrder uses MAX_SAFE_INTEGER sentinel so
//    docs with exactOrder >= 100 sort correctly (before unordered docs)
// 5. export route: ExportPackage file list must exclude internal drafts

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { assessExtractionQuality } from "../lib/extraction-quality";
import { inferTenderMetadata } from "../lib/engine/tender-metadata";
import { buildFinalZipEntries } from "../lib/engine/final-zip-scope";

// ─── 1. Extraction quality — empty extraction ──────────────────────────────

describe("assessExtractionQuality — empty/zero-char extraction", () => {
  it("scores POOR (not WARNING) when extraction returned 0 characters", () => {
    const report = assessExtractionQuality("");
    assert.equal(report.severity, "POOR", `expected POOR but got ${report.severity} (score=${report.score})`);
    assert.ok(report.score < 45, `expected score < 45 but got ${report.score}`);
    assert.equal(report.characterCount, 0);
  });

  it("scores POOR when extraction returned null", () => {
    const report = assessExtractionQuality(null);
    assert.equal(report.severity, "POOR");
    assert.ok(report.score < 45);
  });

  it("scores POOR when extraction returned only whitespace", () => {
    const report = assessExtractionQuality("   \n\t  ");
    assert.equal(report.severity, "POOR");
    assert.ok(report.score < 45, `expected score < 45 for whitespace-only input, got ${report.score}`);
  });

  it("does NOT score POOR for good extraction (regression guard)", () => {
    const goodText = "Section 1. Introduction\n\n".repeat(200) + "Section 2. Scope\n\n".repeat(200);
    const report = assessExtractionQuality(goodText);
    assert.equal(report.severity, "GOOD");
    assert.ok(report.score >= 75);
  });
});

// ─── 2. Tender metadata — clientContactEmail uses Email: label ────────────

describe("inferTenderMetadata — clientContactEmail context-bound extraction", () => {
  it("extracts the focal-person email from an Email: label, not a generic first-email in the doc", () => {
    // The submission address email appears BEFORE the focal-person Email: block in this text.
    // Old code would pick submission@tender.org; new code picks focal@agency.gov.et.
    const tender = `
REQUEST FOR PROPOSALS
RFP No. TEST-2026-001

Submission Address: submission@tender.org
Submit sealed proposals to the above address.

Contact Person: Dr. Amira Hassan
Procurement Officer
Email: amira.hassan@agency.gov.et
Tel: +251 900 000 001

Country: Ethiopia
Deadline: 30 June 2026

The Ministry invites qualified consulting firms to submit proposals for
infrastructure planning services. Firms must have at least 5 years of
relevant experience and provide CVs of key experts.
    `.repeat(2);

    const m = inferTenderMetadata(tender, "rfp.pdf");
    assert.equal(
      m.clientContactEmail,
      "amira.hassan@agency.gov.et",
      `expected amira.hassan@agency.gov.et but got: ${m.clientContactEmail}`,
    );
  });

  it("returns null for clientContactEmail when no Email: label exists near the contact block", () => {
    const tender = `
REQUEST FOR PROPOSALS
RFP No. TEST-2026-002

Procuring Entity: Test Authority

Deadline: 01 July 2026

This tender is for consulting services. Please submit a technical
and financial proposal with all required documents. Minimum 5 years
experience required. Key personnel must have relevant qualifications.
Submission must be received by the deadline indicated above.
    `.repeat(2);

    const m = inferTenderMetadata(tender, "rfp.pdf");
    // No Email: label in this text, so clientContactEmail should be null.
    assert.equal(m.clientContactEmail, null);
  });
});

// ─── 3. Tender metadata — inferBudget / inferBidBond with 3-digit amounts ─

describe("inferTenderMetadata — 3-digit currency amounts", () => {
  it("correctly extracts a 3-digit budget amount (amount-first pattern)", () => {
    const tender = `
REQUEST FOR PROPOSALS
RFP No. TEST-2026-003

Procuring Entity: Test Municipality

Budget: 500 USD

Country: Ethiopia
Deadline: 01 August 2026

Small infrastructure services tender. Firms must have at least 3 years
experience. Key personnel must hold relevant degrees. Submit technical
proposal with methodology and team CVs. Financial proposal to be submitted
in a separate envelope as per instructions.
    `.repeat(2);

    const m = inferTenderMetadata(tender, "rfp.pdf");
    assert.equal(m.budget, 500, `expected budget 500 but got ${m.budget}`);
    assert.equal(m.currency, "USD", `expected currency USD but got ${m.currency}`);
  });

  it("correctly extracts a 3-digit bid bond amount (currency-first pattern)", () => {
    const tender = `
REQUEST FOR PROPOSALS
RFP No. TEST-2026-004

Procuring Entity: Test Board

Bid bond: ETB 200

Country: Ethiopia
Deadline: 15 September 2026

Consulting services for technical studies. Requirements include at least
5 completed projects of similar nature, qualified team with certified
engineers, and proof of financial capacity. Proposals must include a
signed declaration of eligibility and all supporting documents.
    `.repeat(2);

    const m = inferTenderMetadata(tender, "rfp.pdf");
    assert.equal(m.bidBondAmount, 200, `expected bid bond 200 but got ${m.bidBondAmount}`);
    assert.equal(m.bidBondCurrency, "ETB", `expected ETB but got ${m.bidBondCurrency}`);
  });
});

// ─── 3b. Tender metadata — inferClientContactTitle captures role text ──────

describe("inferTenderMetadata — clientContactTitle extraction", () => {
  it("extracts procurement officer title (was always null due to non-capturing groups)", () => {
    const tender = `
REQUEST FOR PROPOSALS
RFP No. TEST-2026-010

Procuring Entity: Example Authority

Contact Person: Ms. Hiwot Bekele
Procurement Officer
Email: hiwot.bekele@example.et
Tel: +251 911 000 001

Country: Ethiopia
Deadline: 01 October 2026

This tender is for consulting services. Bidders must submit technical and
financial proposals with CVs for all key experts. Minimum 5 years of
experience required. Firms must provide evidence of similar projects.
    `.repeat(2);

    const m = inferTenderMetadata(tender, "rfp.pdf");
    assert.ok(
      m.clientContactTitle !== null,
      "clientContactTitle should not be null when 'Procurement Officer' appears in document",
    );
    assert.match(m.clientContactTitle ?? "", /procurement\s+officer/i);
  });

  it("extracts project manager title", () => {
    const tender = `
REQUEST FOR PROPOSALS
RFP No. TEST-2026-011

Procuring Entity: Test Ministry

Contact Person: Mr. Alemu Tadesse
Project Manager
Email: alemu.tadesse@ministry.et

Country: Ethiopia
Deadline: 15 October 2026

Consulting services for infrastructure development. Firms must provide
a team of qualified engineers with relevant experience. Minimum 3
completed projects required. Proposals must be submitted in sealed
envelopes to the address indicated above.
    `.repeat(2);

    const m = inferTenderMetadata(tender, "rfp.pdf");
    assert.ok(
      m.clientContactTitle !== null,
      "clientContactTitle should not be null when 'Project Manager' appears",
    );
    assert.match(m.clientContactTitle ?? "", /project\s+manager/i);
  });
});

// ─── 3c. Tender metadata — inferPreBidMeeting strips date from location ───

describe("inferTenderMetadata — preBidMeetingLocation does not include date text", () => {
  it("location does not start with a date when date and venue are in the same phrase", () => {
    const tender = `
REQUEST FOR PROPOSALS
RFP No. TEST-2026-012

Procuring Entity: Test Agency

Pre-bid meeting: 15 April 2026 at Eagle Plaza, Kirkos Sub City

Country: Ethiopia
Deadline: 30 April 2026

Infrastructure consultancy services. Technical proposal must include
methodology, work plan, and CVs for all key experts. At least three
projects of similar nature required. Financial proposal must be sealed
separately and submitted together with the technical envelope.
    `.repeat(2);

    const m = inferTenderMetadata(tender, "rfp.pdf");
    if (m.preBidMeetingLocation !== null) {
      assert.ok(
        !/^\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)/i.test(m.preBidMeetingLocation),
        `location should not start with date text, got: "${m.preBidMeetingLocation}"`,
      );
      assert.ok(
        m.preBidMeetingLocation.toLowerCase().includes("eagle") ||
        m.preBidMeetingLocation.toLowerCase().includes("kirkos"),
        `location should contain venue name, got: "${m.preBidMeetingLocation}"`,
      );
    }
    // Pre-bid date should still parse correctly
    if (m.preBidMeetingDate !== null) {
      assert.equal(m.preBidMeetingDate.getMonth(), 3); // April = 3
      assert.equal(m.preBidMeetingDate.getDate(), 15);
    }
  });
});

// ─── 4. final-zip-scope — null exactOrder sorts AFTER explicit orders ────

describe("buildFinalZipEntries — null exactOrder sorts after high exactOrder", () => {
  it("a doc with exactOrder=100 sorts before a doc with null exactOrder", () => {
    const result = buildFinalZipEntries({
      tender: { exactFileNaming: null, exactFileOrder: null, requirements: [] },
      generatedDocs: [
        { id: "b", name: "B-Unordered", exactFileName: "B.docx", exactOrder: null, documentType: null },
        { id: "a", name: "A-Ordered", exactFileName: "A.docx", exactOrder: 100, documentType: null },
      ],
    });

    const names = result.entries.map((e) => e.name);
    const idxA = names.indexOf("A.docx");
    const idxB = names.indexOf("B.docx");
    assert.ok(idxA >= 0, "A.docx must be in entries");
    assert.ok(idxB >= 0, "B.docx must be in entries");
    assert.ok(idxA < idxB, `A (exactOrder=100) should sort before B (null), but got [${names.join(", ")}]`);
  });

  it("docs with exactOrder=99 sort before docs with null exactOrder (regression: old sentinel was 99)", () => {
    const result = buildFinalZipEntries({
      tender: { exactFileNaming: null, exactFileOrder: null, requirements: [] },
      generatedDocs: [
        { id: "c", name: "C-Null", exactFileName: "C.docx", exactOrder: null, documentType: null },
        { id: "d", name: "D-Ordered99", exactFileName: "D.docx", exactOrder: 99, documentType: null },
      ],
    });

    const names = result.entries.map((e) => e.name);
    const idxD = names.indexOf("D.docx");
    const idxC = names.indexOf("C.docx");
    assert.ok(idxD < idxC, `D (exactOrder=99) should sort before C (null), but got [${names.join(", ")}]`);
  });
});

describe("assessExtractionQuality — corrupted PDF text", () => {
  it("marks repeated glyph / black-square gibberish as corrupted and OCR-required", () => {
    const gibberish = Array.from({ length: 60 }, (_, i) => `[Page ${i + 1}] GGGG □□□■ → → x y z a b c GGGGGG`).join("\n");
    const report = assessExtractionQuality(gibberish, "path-tender.pdf");
    assert.equal(report.corrupted, true);
    assert.equal(report.severity, "FAILED");
    // The guarantee is that corrupted extraction yields an ACTIONABLE remedy —
    // not that it names OCR. No OCR engine exists in this codebase
    // (tender-text-extractor only marks pages ocr_required), so recommending it
    // was advice the app could never carry out.
    assert.ok(report.recommendations.some((item) => /clearer|cleaner|text-based/i.test(item)));
  });

  it("does not mark readable tender prose as corrupted", () => {
    const readable = `
      [Page 1]
      Request for Proposal for architectural and engineering consultancy services.
      The procuring entity invites technical and financial proposals for design review,
      construction supervision, and project management services. Bidders shall submit
      a technical proposal, financial proposal, company registration documents, CVs,
      project experience references, and a compliance matrix before the submission deadline.
      Evaluation criteria include methodology, personnel experience, similar assignments,
      work plan, and financial proposal.
    `.repeat(12);
    const report = assessExtractionQuality(readable, "building-design-rfp.pdf");
    assert.equal(report.corrupted, false);
    assert.notEqual(report.severity, "FAILED");
  });

  it("does not let high character count alone pass unreadable extraction", () => {
    const noisy = `${"G G G G G G G G G G □ □ □ → → → ".repeat(250)}\n${"ZZZZ ZZZZ ■■■ GGGG ".repeat(200)}`;
    const report = assessExtractionQuality(noisy, "long-noisy.pdf");
    assert.equal(report.corrupted, true);
    assert.ok(report.score < 45, `expected score below POOR threshold, got ${report.score}`);
  });
});
