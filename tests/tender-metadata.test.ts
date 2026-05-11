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
