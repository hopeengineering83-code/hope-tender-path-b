// Tender metadata auto-extraction tests (PR XX-METADATA).

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { inferTenderMetadata } from "../lib/engine/tender-metadata";

const FULL_TENDER = `
REQUEST FOR PROPOSALS

RFP No. 2026-024
Project Title: Architectural Consultancy Services for Pharo Health Ethiopia Specialty Medical Center

Procuring Entity: Pharo Ventures
Address: Near Bole Flamingo, Mina ye Office Park, 12th Floor, Addis Ababa, Ethiopia
Contact Person: Edessa Legassa
Procurement Officer

Tel: +251 911 169 930
Email: edessalegn@pharoventures.com

Country: Ethiopia
Category: Healthcare

Budget: ETB 27,500,000

Deadline: 25 March 2026, 5:00 PM Addis Ababa time
Submission Method: Email
Submission Address: edessalegn@pharoventures.com

Proposal validity: 90 calendar days
Bid bond: USD 50,000
Pre-bid meeting: 10 March 2026 at Pharo Ventures office
Mandatory site visit is required.

Submit original plus 2 copies of the proposal.
Page limit: 60 pages excluding annexes.

Evaluation: Technical 80% / Financial 20%.

Scope: The consultant shall design a specialty medical center with biomedical
equipment coordination, clinical workflow optimization, and infection control
infrastructure. The team must include a Lead Architect, MEP engineers, and a
biomedical specialist. Construction supervision is included.
`;

describe("inferTenderMetadata — rich extraction", () => {
  it("extracts the title via Project Title label", () => {
    const m = inferTenderMetadata(FULL_TENDER, "rfp-2026-024.pdf");
    assert.match(m.title, /architectural\s+consultancy\s+services/i);
  });

  it("extracts the RFP reference number", () => {
    const m = inferTenderMetadata(FULL_TENDER, "rfp.pdf");
    assert.equal(m.reference, "2026-024");
  });

  it("extracts the client name (procuring entity)", () => {
    const m = inferTenderMetadata(FULL_TENDER, "rfp.pdf");
    assert.ok(m.clientName?.toLowerCase().includes("pharo"), `expected Pharo in client, got: ${m.clientName}`);
  });

  it("extracts the client contact name", () => {
    const m = inferTenderMetadata(FULL_TENDER, "rfp.pdf");
    assert.ok(m.clientContactName?.toLowerCase().includes("edessa"), `expected Edessa in contact name, got: ${m.clientContactName}`);
  });

  it("extracts the client email", () => {
    const m = inferTenderMetadata(FULL_TENDER, "rfp.pdf");
    assert.equal(m.clientContactEmail, "edessalegn@pharoventures.com");
  });

  it("extracts the client phone", () => {
    const m = inferTenderMetadata(FULL_TENDER, "rfp.pdf");
    assert.ok(m.clientContactPhone?.includes("+251"), `expected +251 in phone, got: ${m.clientContactPhone}`);
  });

  it("extracts the country", () => {
    const m = inferTenderMetadata(FULL_TENDER, "rfp.pdf");
    assert.equal(m.country, "Ethiopia");
  });

  it("extracts the category as Healthcare", () => {
    const m = inferTenderMetadata(FULL_TENDER, "rfp.pdf");
    assert.equal(m.category, "Healthcare");
  });

  it("extracts the budget amount and currency", () => {
    const m = inferTenderMetadata(FULL_TENDER, "rfp.pdf");
    assert.equal(m.budget, 27_500_000);
    assert.equal(m.currency, "ETB");
  });

  it("extracts the deadline", () => {
    const m = inferTenderMetadata(FULL_TENDER, "rfp.pdf");
    assert.ok(m.deadline !== null);
    assert.equal(m.deadline?.getFullYear(), 2026);
    assert.equal(m.deadline?.getMonth(), 2); // March = 2
    assert.equal(m.deadline?.getDate(), 25);
  });

  it("extracts the submission method", () => {
    const m = inferTenderMetadata(FULL_TENDER, "rfp.pdf");
    assert.equal(m.submissionMethod, "Email");
  });

  it("extracts the validity period in days", () => {
    const m = inferTenderMetadata(FULL_TENDER, "rfp.pdf");
    assert.equal(m.validityDays, 90);
  });

  it("extracts the bid bond amount and currency", () => {
    const m = inferTenderMetadata(FULL_TENDER, "rfp.pdf");
    assert.equal(m.bidBondAmount, 50_000);
    assert.equal(m.bidBondCurrency, "USD");
  });

  it("flags mandatory site visit", () => {
    const m = inferTenderMetadata(FULL_TENDER, "rfp.pdf");
    assert.equal(m.mandatorySiteVisit, true);
  });

  it("extracts the number of copies required", () => {
    const m = inferTenderMetadata(FULL_TENDER, "rfp.pdf");
    assert.equal(m.numberOfCopiesRequired, 2);
  });

  it("extracts the page limit", () => {
    const m = inferTenderMetadata(FULL_TENDER, "rfp.pdf");
    assert.equal(m.pageLimit, 60);
  });

  it("extracts evaluation weights (technical / financial)", () => {
    const m = inferTenderMetadata(FULL_TENDER, "rfp.pdf");
    assert.equal(m.technicalWeight, 80);
    assert.equal(m.financialWeight, 20);
  });

  it("returns [REVIEW NEEDED] when text is < 500 chars", () => {
    const short = "Tender short text only.";
    const m = inferTenderMetadata(short, "scanned.pdf");
    assert.match(m.title, /\[REVIEW NEEDED\]/);
    assert.equal(m.clientName, null);
    assert.equal(m.deadline, null);
  });
});

describe("inferTenderMetadata — alternative client labels", () => {
  const NAME_OF_PROCURING_ENTITY_TENDER = `
REQUEST FOR PROPOSALS

RFP Reference: WB-2026-ETH-001

Name of Procuring Entity: Ministry of Health Ethiopia

Country: Ethiopia
Category: Healthcare

Deadline: 30 April 2026, 12:00 noon

The Ministry of Health Ethiopia invites qualified consultants to submit
proposals for health system strengthening services. Consultants must
demonstrate experience in public health, health information systems,
and capacity building programs for government agencies.

This tender is open to firms with at least 5 years of experience working
with Ministries of Health or similar public sector health authorities.
Key requirements include provision of at least 3 senior health experts
and documentation of at least 5 relevant projects completed within the
last 7 years.
  `.repeat(3);

  it("extracts client name from 'Name of Procuring Entity' label", () => {
    const m = inferTenderMetadata(NAME_OF_PROCURING_ENTITY_TENDER, "rfp.pdf");
    assert.ok(
      m.clientName?.toLowerCase().includes("ministry of health"),
      `expected Ministry of Health in clientName, got: ${m.clientName}`,
    );
  });

  it("extracts reference from 'RFP Reference' label", () => {
    const m = inferTenderMetadata(NAME_OF_PROCURING_ENTITY_TENDER, "rfp.pdf");
    assert.ok(m.reference, `expected a reference number, got: ${m.reference}`);
  });
});

describe("inferTenderMetadata — organization-name header fallback", () => {
  const ORG_HEADER_TENDER = `
Federal Ministry of Water and Energy

Invitation for Bids

IFB No. FMWE-2026-015
Project: Rural Water Supply Infrastructure Development

Country: Ethiopia
Category: Water & Infrastructure

Deadline: 15 May 2026

Bidders are invited to submit sealed bids for construction and installation
of rural water supply systems across three regions. The project involves
drilling boreholes, installing pumping systems, and constructing water
distribution networks serving approximately 50,000 beneficiaries.

Minimum Requirements:
- Company registration certificate
- 3 similar completed projects in the last 5 years
- Lead Engineer with 10 years minimum experience
- Financial statement for last 3 years
  `.repeat(3);

  it("extracts client name from a standalone organization-name header when explicit labels are absent", () => {
    const m = inferTenderMetadata(ORG_HEADER_TENDER, "ifb.pdf");
    assert.ok(
      m.clientName?.toLowerCase().includes("ministry of water"),
      `expected Ministry of Water in clientName, got: ${m.clientName}`,
    );
  });
});

describe("inferTenderMetadata — flattened single-line pages", () => {
  // Mirrors how pdf2json / pdfjs flatten a page: all fields on one line with
  // no newlines between them. The client-name and deadline extractors must
  // not bleed past their values into the following fields.
  const FLATTENED = (
    "[Page 1] REQUEST FOR PROPOSAL Procuring Entity: Nairobi Water and Sewerage Authority " +
    "Reference: RFP-2026-014 Project: Construction Supervision Services for Bulk Water Supply Country: Kenya. " +
    "The procuring entity invites sealed proposals from qualified and experienced consulting firms for the " +
    "supervision of construction works under this assignment described throughout this document. " +
    "[Page 2] SUBMISSION INSTRUCTIONS Proposals must be submitted by email to tenders@nairobiwater.go.ke " +
    "no later than 30 March 2026 at 15:00 East Africa Time. The email subject line must read RFP-2026-014. " +
    "Contact person Eng. Jane Mwangi, Procurement Officer. Background and scope follow in later sections here. " +
    "[Page 3] EVALUATION CRITERIA Technical proposal weight eighty percent and financial proposal weight twenty percent."
  );

  it("extracts a clean procuring-entity name (cut at the next field label)", () => {
    const m = inferTenderMetadata(FLATTENED, "rfp.pdf");
    assert.equal(m.clientName, "Nairobi Water and Sewerage Authority");
  });

  it("extracts a 'no later than <date>' deadline that earlier patterns miss", () => {
    const m = inferTenderMetadata(FLATTENED, "rfp.pdf");
    assert.ok(m.deadline !== null, "deadline should be parsed from 'no later than 30 March 2026'");
    assert.equal(m.deadline?.getFullYear(), 2026);
    assert.equal(m.deadline?.getMonth(), 2); // March
    assert.equal(m.deadline?.getDate(), 30);
  });
});
