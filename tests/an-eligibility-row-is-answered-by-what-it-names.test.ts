// An eligibility requirement is answered by what it names, not by its
// category.
//
// The Pharo tender (hosted runs 2026-10-08 and 2026-10-10) lists five rows
// under "Eligibility": a valid business licence, healthcare design experience,
// understanding of healthcare regulations, a multidisciplinary team and a
// healthcare design portfolio. Both evidence producers matched every one of
// them to the firm's registration record, and the proposal's compliance matrix
// printed "Multidisciplinary Team — from legal/registration record (PPA
// Supplier Registration Evidence) — FULLY MET".

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { eligibilitySubjectOf } from "../lib/engine/eligibility-subject";
import { inferAutomaticEvidenceKinds } from "../lib/engine/automatic-requirement-coverage";
import { buildCompliance } from "../lib/engine/compliance";

const ROWS = [
  { id: "licence", title: "Valid Business License", description: "Proof of a valid business license and registration in Ethiopia." },
  { id: "experience", title: "Healthcare Design Experience", description: "Proven experience in designing healthcare facilities." },
  { id: "regulations", title: "Healthcare Regulations Understanding", description: "Strong understanding of healthcare regulations and compliance requirements." },
  { id: "team", title: "Multidisciplinary Team", description: "Availability of a multidisciplinary professional team including architects, engineers, biomedical engineers, MEP experts, and other relevant specialists." },
  { id: "portfolio", title: "Healthcare Design Portfolio", description: "Relevant healthcare design portfolio and client references." },
];

describe("the subject of an eligibility row", () => {
  for (const [id, subject] of [["licence", "REGISTRATION"], ["experience", "EXPERIENCE"], ["regulations", "UNDERSTANDING"], ["team", "TEAM"], ["portfolio", "EXPERIENCE"]] as const) {
    it(`${id} → ${subject}`, () => {
      const row = ROWS.find((r) => r.id === id)!;
      assert.equal(eligibilitySubjectOf(`${row.title} ${row.description}`), subject);
    });
  }

  it("a row naming a registration stays a registration row whatever else it says", () => {
    assert.equal(eligibilitySubjectOf("The team leader shall hold a valid professional registration certificate."), "REGISTRATION");
    assert.equal(eligibilitySubjectOf("Eligibility of the bidder."), "REGISTRATION");
  });
});

describe("automatic coverage looks for the evidence the row names", () => {
  const kinds = (id: string) => inferAutomaticEvidenceKinds({ ...ROWS.find((r) => r.id === id)!, requirementType: "ELIGIBILITY", restrictions: null, exactFileName: null });
  it("a team row is answered by CVs, not by a registration", () => {
    assert.ok(kinds("team").includes("EXPERT_CV"));
    assert.ok(!kinds("team").includes("LEGAL_REGISTRATION"));
  });
  it("an experience or portfolio row by project references", () => {
    for (const id of ["experience", "portfolio"]) {
      assert.ok(kinds(id).includes("PROJECT_REFERENCE"), id);
      assert.ok(!kinds(id).includes("LEGAL_REGISTRATION"), id);
    }
  });
  it("an understanding row by the proposal's own text", () => {
    assert.deepEqual(kinds("regulations"), ["METHODOLOGY_NARRATIVE"]);
  });
  it("a licence row still by the registration record", () => {
    assert.ok(kinds("licence").includes("LEGAL_REGISTRATION"));
  });
});

describe("the engine cites the evidence the row names", () => {
  const result = buildCompliance(
    ROWS.map((r) => ({ id: r.id, requirement: { ...r, requirementType: "ELIGIBILITY", priority: "MANDATORY" } })) as never,
    {
      companyId: "c", documents: [], financialRecords: [], complianceRecords: [],
      legalRecords: [{ id: "l1", recordType: "REGISTRATION", title: "PPA Supplier Registration Evidence", referenceNumber: null }],
      experts: [{ id: "e1", fullName: "A. Architect" }], projects: [{ id: "p1", name: "Regional Hospital" }],
    } as never,
    { expertMatches: [{ expertId: "e1", score: 0.9, isSelected: true }], projectMatches: [{ projectId: "p1", score: 0.9, isSelected: true }] } as never,
  );
  const row = (id: string) => result.matrices.find((m) => m.requirementId === id)!;

  it("team → the selected expert; experience and portfolio → the project; licence → the registration", () => {
    assert.equal(row("team").evidenceType, "EXPERT");
    assert.equal(row("team").evidenceReference, "A. Architect");
    for (const id of ["experience", "portfolio"]) {
      assert.equal(row(id).evidenceType, "PROJECT", id);
      assert.equal(row(id).evidenceReference, "Regional Hospital", id);
    }
    assert.equal(row("licence").evidenceType, "LEGAL_RECORD");
    assert.equal(row("licence").evidenceReference, "PPA Supplier Registration Evidence");
  });

  it("understanding is answered in the proposal, and no row cites the registration for a team or a track record", () => {
    assert.equal(row("regulations").evidenceType, "PROPOSAL_RESPONSE");
    for (const id of ["team", "experience", "regulations", "portfolio"]) {
      assert.notEqual(row(id).evidenceReference, "PPA Supplier Registration Evidence", id);
    }
    assert.equal(result.gaps.filter((g) => g.severity === "CRITICAL").length, 0, JSON.stringify(result.gaps));
  });
});
