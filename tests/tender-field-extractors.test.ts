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
      assert.equal(r.value.getFullYear(), 2026);
      assert.equal(r.value.getMonth(), 8);
      assert.equal(r.value.getDate(), 12);
    }
  });
  it("matches 'Closing date: 2026-12-31 12:00'", () => {
    const r = extractDeadline({ files: [{ fileName: "f.pdf", extractedText: "Closing date: 2026-12-31 12:00. All proposals received after this time will be rejected as non-responsive." }] });
    assert.equal(r.found, true);
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
        submissionAddress: "Submission address: Room 412, Ministry of Health Building, Churchill Avenue, Addis Ababa, Ethiopia. Open Mon-Fri 08:00-17:00.",
        pageLimit: "The technical proposal shall not exceed 25 pages excluding annexes and shall be in font size 11 or larger.",
        validityDays: "The proposal shall remain valid for 90 days from the deadline. After expiry the bid lapses unless extended.",
        bidBondAmount: "Bid security in the amount of USD 25,000 is required and shall be valid for 30 days beyond proposal validity.",
        numberOfCopiesRequired: "Submit 3 hard copies of the proposal in separate sealed envelopes. Labels must be clearly visible and dated.",
        mandatorySiteVisit: "A mandatory site visit will be held on 5 Aug 2026. Failure to attend disqualifies the bid from evaluation.",
        clientName: "Procuring Entity: Federal Ministry of Health and Sanitation, Procurement Directorate, Addis Ababa, Ethiopia. Reference RFP-MOH-2026-014.",
        clientContactEmail: "For inquiries, contact the procurement officer. Contact e-mail: procurement.officer@ministry.gov.et. Clarifications must be submitted in writing.",
        preBidMeetingDate: "Pre-bid meeting date: 15 July 2026 at 10:00 at the Ministry boardroom. Attendance is encouraged.",
        donorAgency: "This project is funded by the World Bank's IDA financing window. Donor agency: International Development Association (World Bank Group).",
        implementingAgency: "Implementing agency: National Health Institute, Ministry of Health. All activities will be supervised by the designated project management unit.",
        legalClientName: "Full legal name of client: Federal Democratic Republic of Ethiopia - Ministry of Health and Family Planning. Registered office address available upon request.",
        clientContactName: "Contact person: Dr. Abebe Kebede, Senior Procurement Officer. Direct phone available during office hours for procurement inquiries.",
        clientContactTitle: "Title: Senior Procurement Officer, Procurement and Contracts Division of the Ministry of Health. Designated authority for tender clarifications.",
        clientContactPhone: "Phone: +251-11-552-1234, Mobile contact for urgent issues: +251-911-234567. Available Mon-Fri 08:00-17:00 local time.",
        clientAddress: "Client address: Ministry of Health Building, Churchill Avenue, P.O. Box 1234, Addis Ababa, Ethiopia. Reception desk at main lobby.",
        country: "Country: Ethiopia. The project will be implemented across multiple regions within Ethiopia following the established administration boundaries.",
        clientCity: "City location: Addis Ababa. Specific implementation site: Kirkos Sub-City with satellite offices in three major zones within the city.",
        clientWebsite: "Website: https://www.moh.gov.et/procurement. Visit the portal for latest updates. Additional contact: info@moh.gov.et for general inquiries.",
        projectTitle: "Project Title: Consultancy Services for the Design and Supervision of the National Health Laboratory Expansion Project. RFP-MOH-2026-045.",
        submissionEmailSubject: "Email Subject: RFP-MOH-2026-045 - Technical Proposal for National Health Laboratory Expansion. Submission from ABC Consulting.",
        contactChannel: "Clarification channel: All queries must be submitted via the procurement portal or to the focal person via email.",
        authorizedOfficer: "Authorized representative: Mr. Samuel Tadesse, Director of Infrastructure, Ministry of Health. Designated for all contract matters.",

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
