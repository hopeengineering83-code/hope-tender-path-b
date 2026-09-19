// The certifications section must exist when the firm has certifications.
//
// THE DELIVERED DEFECT
// --------------------
// Every hosted run in this session delivered a proposal with no "D.3
// Professional Certifications and Affiliations" section. The run log says why:
//
//   Structure seal dropped 3 heading(s) left with no content: … ;
//   D.3 Professional Certifications and Affiliations.
//
// No reviewed expert record carries a certifications list, so the builder
// emitted the heading over an internal note — "Source-evidence action: ensure
// each reviewed expert record carries the full list of professional
// certifications, licenses, and registrations before final submission." The
// internal-content stripper removed the note, correctly, and the structure seal
// then dropped the heading with nothing under it.
//
// The firm does hold certifications. A.3 Evidence of Compliance in the same
// delivered PDF lists PPA Supplier Registration, Tax Clearance, Consultancy
// Competency Certificate Grade 1, Audited Financial Statements, a Quality
// Management System Manual (HAEC/034/23) and Quality Assurance and Review
// Procedures (HAEC/052/22) — all reviewed company records. D.3 is where an
// evaluator scoring compliance looks for them.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { buildCertificationsSection } from "../lib/engine/understanding-and-value-added";
import type { ExpertRecord } from "../lib/engine/benchmark-tables";

const NO_CERT_EXPERTS = [
  { fullName: "Ahmed Kebede Tekaw", certifications: JSON.stringify([]) },
  { fullName: "Daniel Getachew Tadesse", certifications: JSON.stringify([]) },
] as unknown as ExpertRecord[];

// The records the delivered A.3 actually printed.
const COMPANY_RECORDS = [
  { title: "PPA Supplier Registration Evidence", recordType: "SUPPLIER_REGISTRATION", status: "ACTIVE" },
  { title: "Consultancy Competency Certificate - Grade 1 / Category 1", recordType: "CERTIFICATE OF COMPETENCE", status: "ACTIVE" },
];
const COMPLIANCE_RECORDS = [
  { title: "Quality Management System Manual", complianceType: "QUALITY MANAGEMENT SYSTEM", referenceNumber: "HAEC/034/23", status: "ACTIVE" },
  { title: "Quality Assurance and Review Procedures", complianceType: "QUALITY_ASSURANCE", referenceNumber: "HAEC/052/22", status: "ACTIVE" },
];

describe("D.3 is built from the firm's own records when the experts carry none", () => {
  it("produces the section instead of an internal note", () => {
    const section = buildCertificationsSection({
      experts: NO_CERT_EXPERTS,
      companyName: "Hope Urban Planning Architectural and Engineering Consultancy PLC",
      legalRecords: COMPANY_RECORDS,
      complianceRecords: COMPLIANCE_RECORDS,
    });
    assert.match(section, /## D\.3 Professional Certifications and Affiliations/);
    assert.ok(!/Source-evidence action/i.test(section), `no internal instruction: ${section}`);
    assert.ok(!/knowledge vault/i.test(section));
  });

  it("names each reviewed record with the reference it carries", () => {
    const section = buildCertificationsSection({
      experts: NO_CERT_EXPERTS,
      companyName: "Hope Engineering",
      legalRecords: COMPANY_RECORDS,
      complianceRecords: COMPLIANCE_RECORDS,
    });
    assert.match(section, /PPA Supplier Registration Evidence/);
    assert.match(section, /Consultancy Competency Certificate - Grade 1 \/ Category 1/);
    assert.match(section, /HAEC\/034\/23/);
    assert.match(section, /HAEC\/052\/22/);
  });

  it("invents nothing when the firm has no records either", () => {
    assert.equal(
      buildCertificationsSection({ experts: NO_CERT_EXPERTS, companyName: "Hope Engineering" }),
      "",
      "an absent section is right when there is nothing to put in it",
    );
  });

  it("still prefers the experts' own certifications when they have them", () => {
    const section = buildCertificationsSection({
      experts: [{ fullName: "A", certifications: JSON.stringify(["PhD Structural Engineering", "ECSA Registered"]) }] as unknown as ExpertRecord[],
      companyName: "Hope Engineering",
      legalRecords: COMPANY_RECORDS,
      complianceRecords: COMPLIANCE_RECORDS,
    });
    assert.match(section, /ECSA Registered/);
    assert.match(section, /PhD Structural Engineering/);
    assert.ok(!/HAEC\/034\/23/.test(section), "the expert list is the section when it exists");
  });
});
