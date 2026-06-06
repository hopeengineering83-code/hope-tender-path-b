// Multi-field deterministic source extractor — pure unit tests across
// realistic tender prose styles. Each extractor never invents content and
// always returns a verbatim sourceQuote when found.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractReference,
  extractDeadline,
  extractSubmissionEmails,
  extractSubmissionMethod,
  extractPageLimit,
  extractValidityDays,
  extractBidBondAmount,
  extractNumberOfCopies,
  extractMandatorySiteVisit,
  SUPPORTED_EXTRACTORS,
  runExtractorByField,
} from "../lib/engine/tender-field-extractors";

describe("extractReference", () => {
  it("HIGH on 'Tender Reference: PHARO-2026-001'", () => {
    const r = extractReference({ files: [{ fileName: "rfp.pdf", extractedText: "Tender Reference: PHARO-2026-001 — health-sector consultancy. ".repeat(3) }] });
    assert.equal(r.found, true);
    if (r.found) { assert.equal(r.value, "PHARO-2026-001"); assert.equal(r.confidence, "HIGH"); }
  });
  it("HIGH on 'Reference No.: ABC/123/2026'", () => {
    const r = extractReference({ files: [{ fileName: "f.pdf", extractedText: "Reference No.: ABC/123/2026\nThis tender invites proposals for the provision of consultancy services and related deliverables in the health sector." }] });
    assert.equal(r.found, true);
    if (r.found) assert.equal(r.value, "ABC/123/2026");
  });
  it("missing when no reference pattern appears", () => {
    const r = extractReference({ files: [{ fileName: "f.pdf", extractedText: "Scope of work covers a clinical needs assessment and supervisory visits during Q3 2026. Senior clinical leads required." }] });
    assert.equal(r.found, false);
  });
});

describe("extractDeadline", () => {
  it("matches 'Submission deadline: 12 September 2026, 14:00'", () => {
    const r = extractDeadline({ files: [{ fileName: "f.pdf", extractedText: "Submission deadline: 12 September 2026, at 14:00 hrs. Bidders must submit their full technical and financial proposals before this date." }] });
    assert.equal(r.found, true);
    if (r.found) {
      assert.equal(r.value.getUTCFullYear(), 2026);
      assert.equal(r.value.getUTCMonth(), 8);
      assert.equal(r.value.getUTCDate(), 12);
    }
  });
  it("matches 'Closing date: 2026-12-31 12:00'", () => {
    const r = extractDeadline({ files: [{ fileName: "f.pdf", extractedText: "Closing date: 2026-12-31 12:00. All proposals received after this time will be rejected as non-responsive." }] });
    assert.equal(r.found, true);
    if (r.found) { assert.equal(r.value.getUTCFullYear(), 2026); assert.equal(r.value.getUTCMonth(), 11); }
  });
  it("missing when source has no deadline keyword", () => {
    assert.equal(extractDeadline({ files: [{ fileName: "f.pdf", extractedText: "This document describes the scope of work and required deliverables for the assignment in detail." }] }).found, false);
  });
});

describe("extractSubmissionEmails", () => {
  it("captures emails near a submission context", () => {
    const r = extractSubmissionEmails({ files: [{ fileName: "f.pdf", extractedText: "Submission instructions: send sealed bids to procurement@pharo.org with copy to tenders@pharo.org. Late submissions will be rejected after closing." }] });
    assert.equal(r.found, true);
    if (r.found) assert.match(r.value, /procurement@pharo\.org/);
  });
  it("ignores emails in unrelated contexts", () => {
    // No "submit/send/email/tender to" near the email — should not match.
    const r = extractSubmissionEmails({ files: [{ fileName: "f.pdf", extractedText: "For project background, see the previous study report by John Smith (john@example.com). Section 3 covers methodology." }] });
    assert.equal(r.found, false);
  });
});

describe("extractSubmissionMethod", () => {
  it("HIGH on 'electronic submission' (PORTAL)", () => {
    const r = extractSubmissionMethod({ files: [{ fileName: "f.pdf", extractedText: "All bids must be uploaded via the e-procurement portal. Electronic submission is the only accepted route." }] });
    assert.equal(r.found, true);
    if (r.found) { assert.equal(r.value, "PORTAL"); assert.equal(r.confidence, "HIGH"); }
  });
  it("HIGH on 'sealed envelope'", () => {
    const r = extractSubmissionMethod({ files: [{ fileName: "f.pdf", extractedText: "Submit your bid in a sealed envelope marked 'Confidential — Tender Submission'. Late envelopes will not be opened." }] });
    assert.equal(r.found, true);
    if (r.found) assert.equal(r.value, "SEALED_ENVELOPE");
  });
});

describe("extractPageLimit", () => {
  it("matches 'not exceed 30 pages'", () => {
    const r = extractPageLimit({ files: [{ fileName: "f.pdf", extractedText: "The technical proposal shall not exceed 30 pages excluding annexes. Annexes are not subject to a page limit." }] });
    assert.equal(r.found, true);
    if (r.found) assert.equal(r.value, 30);
  });
  it("matches 'page limit: 25'", () => {
    const r = extractPageLimit({ files: [{ fileName: "f.pdf", extractedText: "Page limit: 25\nBidders must respect this restriction. Submissions exceeding the limit will be deemed non-responsive at evaluation." }] });
    assert.equal(r.found, true);
    if (r.found) assert.equal(r.value, 25);
  });
});

describe("extractValidityDays", () => {
  it("matches '90 days' validity", () => {
    const r = extractValidityDays({ files: [{ fileName: "f.pdf", extractedText: "The proposal shall remain valid for 90 days from the submission deadline. Bidders unable to confirm this validity are not eligible." }] });
    assert.equal(r.found, true);
    if (r.found) assert.equal(r.value, 90);
  });
  it("converts months → days", () => {
    const r = extractValidityDays({ files: [{ fileName: "f.pdf", extractedText: "Proposal validity period: 3 months. After this period the offers may lapse unless extended by mutual agreement." }] });
    assert.equal(r.found, true);
    if (r.found) assert.equal(r.value, 90); // 3 * 30
  });
});

describe("extractBidBondAmount", () => {
  it("captures absolute amount + currency", () => {
    const r = extractBidBondAmount({ files: [{ fileName: "f.pdf", extractedText: "Bid security in the amount of USD 50,000 must accompany the proposal. The bond shall be valid for 30 days beyond the proposal validity." }] });
    assert.equal(r.found, true);
    if (r.found) { assert.equal(r.value.amount, 50000); assert.equal(r.value.currency, "USD"); }
  });
  it("captures percent bond as MEDIUM (cannot resolve absolute amount)", () => {
    const r = extractBidBondAmount({ files: [{ fileName: "f.pdf", extractedText: "Bid bond of 1.5% of the proposed bid amount is required and must be submitted in the form of a bank guarantee or cashier's cheque." }] });
    assert.equal(r.found, true);
    if (r.found) { assert.equal(r.value.amount, 0); assert.equal(r.value.currency, "PERCENT"); assert.equal(r.confidence, "MEDIUM"); }
  });
});

describe("extractNumberOfCopies", () => {
  it("matches 'one original plus 5 copies'", () => {
    const r = extractNumberOfCopies({ files: [{ fileName: "f.pdf", extractedText: "Bidders shall submit one original plus 5 copies of the technical proposal. All envelopes shall be sealed and labelled accordingly." }] });
    assert.equal(r.found, true);
    if (r.found) assert.equal(r.value, 5);
  });
  it("matches '3 hard copies'", () => {
    const r = extractNumberOfCopies({ files: [{ fileName: "f.pdf", extractedText: "Submit 3 hard copies of the technical and financial proposals in separate sealed envelopes. Labels must be clearly visible." }] });
    assert.equal(r.found, true);
    if (r.found) assert.equal(r.value, 3);
  });
});

describe("extractMandatorySiteVisit", () => {
  it("HIGH on 'mandatory site visit'", () => {
    const r = extractMandatorySiteVisit({ files: [{ fileName: "f.pdf", extractedText: "A mandatory site visit will be conducted on 5 August 2026 at 09:00. Failure to attend disqualifies the bid from further consideration." }] });
    assert.equal(r.found, true);
    if (r.found) { assert.equal(r.value, true); assert.equal(r.confidence, "HIGH"); }
  });
  it("HIGH on 'optional site visit' ⇒ false", () => {
    const r = extractMandatorySiteVisit({ files: [{ fileName: "f.pdf", extractedText: "An optional site visit is recommended on 5 August 2026. Bidders unable to attend may submit questions in writing through the procurement portal." }] });
    assert.equal(r.found, true);
    if (r.found) { assert.equal(r.value, false); assert.equal(r.confidence, "HIGH"); }
  });
});

describe("Hard safety — extractors never invent on missing source", () => {
  for (const field of SUPPORTED_EXTRACTORS) {
    it(`${field} returns {found:false} on irrelevant tender text`, () => {
      const r = runExtractorByField(field, { files: [{ fileName: "scope-only.pdf", extractedText: "Scope: clinical leadership coaching for primary-care managers across three regions for a period of twelve months." }] });
      assert.equal(r.found, false, `${field} must not invent`);
    });
  }
});

describe("Hard safety — sourceQuote is always present on found:true", () => {
  for (const field of SUPPORTED_EXTRACTORS) {
    it(`${field}: when found, returns a non-empty sourceQuote`, () => {
      const inputs: Record<string, string> = {
        reference: "Tender Reference: TEST-001 — health-sector consultancy across multiple regions for capability building",
        deadline: "Submission deadline: 12 September 2026 at 14:00. Late entries will be rejected. Closing instructions follow.",
        submissionEmails: "Submit your bid to procurement@test.org with cc to tenders@test.org before the stated closing date.",
        submissionMethod: "Electronic submission via the e-procurement portal is required for all bids. Hand-delivery is not accepted.",
        pageLimit: "The technical proposal shall not exceed 25 pages excluding annexes and shall be in font size 11 or larger.",
        validityDays: "The proposal shall remain valid for 90 days from the deadline. After expiry the bid lapses unless extended.",
        bidBondAmount: "Bid security in the amount of USD 25,000 is required and shall be valid for 30 days beyond proposal validity.",
        numberOfCopiesRequired: "Submit 3 hard copies of the proposal in separate sealed envelopes. Labels must be clearly visible and dated.",
        mandatorySiteVisit: "A mandatory site visit will be held on 5 Aug 2026. Failure to attend disqualifies the bid from evaluation.",
        clientName: "Procuring Entity: Federal Ministry of Health and Sanitation, Procurement Directorate, Addis Ababa, Ethiopia. Reference RFP-MOH-2026-014.",
        submissionAddress: "Submission address: Room 412, Ministry of Health Building, Churchill Avenue, Addis Ababa, Ethiopia. Open Mon-Fri 08:00-17:00.",
      };
      const text = inputs[field];
      const r = runExtractorByField(field as typeof SUPPORTED_EXTRACTORS[number], { files: [{ fileName: "rfp.pdf", extractedText: text }] });
      assert.equal(r.found, true, `${field} should match its tailored fixture`);
      if (r.found) {
        assert.ok(r.sourceQuote.length > 0, `${field}: sourceQuote must be non-empty`);
        assert.ok(r.sourceQuote.length <= 200, `${field}: sourceQuote must be ≤200 chars`);
        assert.equal(r.sourceFile, "rfp.pdf");
      }
    });
  }
});
