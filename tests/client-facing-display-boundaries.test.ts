import { test } from "node:test";
import assert from "node:assert/strict";

import { recordTypeForDisplay } from "../lib/engine/vault-prose";
import { withoutProvenanceTags } from "../lib/engine/proposal-labels";
import { buildCertificationsSection } from "../lib/engine/understanding-and-value-added";

// Every value below is one the delivered artifact of hosted run 34052912750
// actually printed to the client.

test("a storage code is respelled for the page, not left as an enum", () => {
  assert.equal(recordTypeForDisplay("SUPPLIER_REGISTRATION"), "Supplier Registration");
  assert.equal(recordTypeForDisplay("TAX_CLEARANCE"), "Tax Clearance");
  assert.equal(recordTypeForDisplay("FINANCIAL_AUDIT"), "Financial Audit");
  assert.equal(recordTypeForDisplay("COMMERCIAL_REGISTRATION"), "Commercial Registration");
  assert.equal(recordTypeForDisplay("BUSINESS_LICENSE"), "Business License");
  assert.equal(recordTypeForDisplay("QUALITY_ASSURANCE"), "Quality Assurance");
});

test("a type already written for a reader is returned exactly as stored", () => {
  assert.equal(recordTypeForDisplay("tax compliance"), "tax compliance");
  assert.equal(recordTypeForDisplay("Certificate of Competence"), "Certificate of Competence");
  assert.equal(recordTypeForDisplay("Quality Management System"), "Quality Management System");
  assert.equal(recordTypeForDisplay(null), "");
  assert.equal(recordTypeForDisplay("  "), "");
});

test("the D.3 table shows no storage codes", () => {
  const section = buildCertificationsSection({
    experts: [],
    companyName: "Hope Urban Planning Architectural and Engineering Consultancy PLC",
    legalRecords: [
      { title: "PPA Supplier Registration Evidence", recordType: "SUPPLIER_REGISTRATION", status: "ACTIVE" },
      { title: "Audited Financial Statements 2020-2025", recordType: "FINANCIAL_AUDIT", referenceNumber: "Mohammed Endris Legass", status: "ACTIVE" },
    ],
    complianceRecords: [
      { title: "Quality Assurance and Review Procedures", complianceType: "QUALITY_ASSURANCE", referenceNumber: "HAEC/052/22", status: "ACTIVE" },
    ],
  });
  assert.match(section, /D\.3 Professional Certifications and Affiliations/);
  assert.doesNotMatch(section, /[A-Z]{3,}_[A-Z]{3,}/);
  assert.match(section, /Supplier Registration/);
  assert.match(section, /Quality Assurance/);
  // The record's own words are untouched.
  assert.match(section, /HAEC\/052\/22/);
});

test("a client-facing requirement line carries no citation apparatus", () => {
  const delivered =
    "Proposal Submission Format — Proposal in PDF format, strictly named 'Technical Proposal.pdf'. " +
    "No financial proposal should be generated or submitted at this stage. [p.4] " +
    '(§ REQUIRED DOCUMENTS / MANDATORY DOCUMENTS) (quote: "Required Documents: Technical Proposal.pdf")';
  const shown = withoutProvenanceTags(delivered);
  assert.doesNotMatch(shown, /\[p\.\d+\]/);
  assert.doesNotMatch(shown, /§/);
  assert.doesNotMatch(shown, /quote:/);
  assert.equal(
    shown,
    "Proposal Submission Format — Proposal in PDF format, strictly named 'Technical Proposal.pdf'. " +
      "No financial proposal should be generated or submitted at this stage.",
  );
});

test("the requirement's own words survive, and an untagged line is unchanged", () => {
  const plain = "Specialized Healthcare Design Experience — include reviewed healthcare project references.";
  assert.equal(withoutProvenanceTags(plain), plain);
  // A half-open tag left by an upstream truncation is removed whole, not partially.
  assert.equal(
    withoutProvenanceTags("Include reviewed healthcare project references. [p.7] (§ QUALIFICATIONS AND APP EXTR…"),
    "Include reviewed healthcare project references.",
  );
});
