/**
 * A cover page behind a letterhead is still a cover page.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * A real owner run scored the Technical Proposal PDF 68/100 and QUALITY_FAILED
 * with MISSING_TITLE_OR_COVER — on a document whose cover page WAS being
 * injected.
 *
 * The detector scanned only text.slice(0, 600) for a title line. That assumes
 * the title is the first thing on the page, but applying the Company Vault
 * letterhead is a normal automatic stage, and a real letterhead — legal name,
 * address, PO box, phone, email, trade licence, TIN, VAT, registration and
 * membership lines — consumes more than 600 characters by itself. Measured on
 * a realistic letterhead the title began at character 614: fourteen characters
 * past the window.
 *
 * The failure mode matters more than the number. A validator that cannot see a
 * legitimate cover invites exactly the wrong repair — injecting a second cover
 * page to satisfy it — so these tests pin both directions: a real cover behind
 * a letterhead must PASS, and a document with no cover at all must still FAIL.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { assessGeneratedDocumentQuality } from "../lib/engine/document-quality-gate";

const LETTERHEAD = `HOPE URBAN PLANNING ARCHITECTURAL AND ENGINEERING CONSULTANCY PLC
Bole Sub City, Woreda 03, House No. 234, Addis Ababa, Ethiopia
P.O. Box 12345 | Tel: +251 11 552 8899 | Fax: +251 11 552 8890
Email: info@example.test | Web: www.example.test
Trade Licence No. MT/AA/3/0004521/2009 | TIN 0012345678 | VAT 00098765
Consulting Licence Grade 1 — Architectural and Engineering Consultancy
Registered with the Ministry of Urban Development and Infrastructure
Member, Association of Ethiopian Architects and Engineers
Branch Offices: Adama, Hawassa, Bahir Dar and Mekelle, Ethiopia
Banking: Commercial Bank of Ethiopia, Bole Branch, Account 1000123456789
`;

/** Enough body text to clear the detector's 200-word minimum. */
const BODY = `Our approach to the assignment is set out below. `
  + `The team will deliver clinical brief review, infection prevention design, and supervision. `.repeat(40);

function assess(text: string) {
  return assessGeneratedDocumentQuality({
    doc: {
      id: "d1",
      name: "Technical Proposal",
      exactFileName: "01-Technical-Proposal.pdf",
      documentType: "TECHNICAL_PROPOSAL",
      format: "PDF",
    },
    visibleText: text,
    rawFileContent: null,
    hasStoragePath: true,
    requirements: [],
  });
}

const hasCoverIssue = (text: string) =>
  assess(text).issues.some((i) => i.code === "MISSING_TITLE_OR_COVER");

describe("a title behind a letterhead is found", () => {
  it("accepts a cover whose title sits past the old 600-character window", () => {
    // No "Submitted to" line here on purpose: the ONLY cover signal is the
    // title itself, placed past the old window. Otherwise this would pass on
    // the addressee pattern and prove nothing about the window.
    const text = `${LETTERHEAD}\nTechnical Proposal\nfor the Design and Construction Supervision works\n\n${BODY}`;
    assert.ok(text.indexOf("Technical Proposal") > 600, "precondition: the title must be past the old window");
    assert.equal(hasCoverIssue(text), false, "a real cover behind a letterhead must not be reported missing");
  });

  it("still accepts a title on the very first line", () => {
    // The previous behaviour must keep working.
    assert.equal(hasCoverIssue(`Technical Proposal\n\n${BODY}`), false);
  });

  it("accepts an addressed cover that names its recipient", () => {
    const text = `${LETTERHEAD}\nSubmitted to: Pharo Ventures PLC\n\n${BODY}`;
    assert.equal(hasCoverIssue(text), false);
  });
});

describe("a document with no cover at all is still caught", () => {
  it("flags a proposal that starts straight into body prose", () => {
    // This is the case the check exists for; widening the window must not
    // silence it.
    assert.equal(hasCoverIssue(BODY), true);
  });

  it("flags a letterhead with no title and no addressee", () => {
    // A letterhead alone is branding, not a cover page.
    assert.equal(hasCoverIssue(`${LETTERHEAD}\n${BODY}`), true);
  });

  it("does not treat a title buried deep in the body as a cover", () => {
    // Far past the first page: mentioning the words later is not a cover.
    const filler = "The supervision team reports monthly to the client. ".repeat(120);
    assert.ok(filler.length > 2_500);
    assert.equal(hasCoverIssue(`${filler}\nTechnical Proposal\n${BODY}`), true);
  });
});
