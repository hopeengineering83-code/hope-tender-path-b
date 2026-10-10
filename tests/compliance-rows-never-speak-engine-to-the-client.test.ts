// The engine's own vocabulary must not reach the evaluator.
//
// WHY THIS FILE EXISTS
// --------------------
// generate-elite builds `complianceLines` as WRITER CONTEXT — what the
// generator is told exists — and the writer copied a row of it verbatim into
// Section E of a real client-facing Technical Proposal:
//
//   PARTIAL: Annexes for Supporting Documents | PROPOSAL_RESPONSE from
//   Company evidence available for drafting | ref: Key-Experts-1.txt — One
//   relevant Company Vault document, 3 selected expert(s)…
//
// Everything after the requirement name is the engine talking to itself.
// `PROPOSAL_RESPONSE` and `PACKAGE_CONFORMANCE` are internal evidence-kind
// enums; `AUTO_BYTE_VERIFIED_VAULT_DOCUMENT` and "Company evidence available
// for drafting" name a drafting state rather than any evidence; and
// `Key-Experts-1.txt` / `02_Legal_Registration_Documents_Summary.docx.txt` are
// stored Company Vault filenames. Measured on the real Pharo run: 19 rows,
// 54 forbidden-token occurrences.
//
// This is the same failure as the `automatic-requirement-evidence:v1:{…}` leak
// already fixed on that same line for the note field alone — closed for one
// field, left open on the four beside it.
//
// The paired assertions below keep both directions honest: internal vocabulary
// must disappear, and evidence a client SHOULD see — a named certificate, a
// named hospital project, a named expert — must survive verbatim, because
// deleting that would be a worse proposal, not a safer one.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  clientSafeComplianceEvidence,
  clientSafeEvidenceReference,
} from "../lib/engine/automatic-requirement-coverage";

// Exactly the values the real Pharo tender produced.
const INTERNAL_VOCABULARY = [
  "PROPOSAL_RESPONSE",
  "PACKAGE_CONFORMANCE",
  "BUILD_PLAN_ITEM",
  "COMPANY_DOCUMENT",
  "LEGAL_RECORD",
  "AUTO_BYTE_VERIFIED_VAULT_DOCUMENT",
  "AUTO_SOURCE_VERIFIED_VAULT_RECORD",
  "AUTO_PACKAGE_CONFORMANCE",
  "AUTO_PLANNED_ARTIFACT",
  "available for drafting",
  "Company Vault",
  "expert record(s)",
  "project record(s)",
  ".txt",
  ".docx",
];

const REAL_ROWS = [
  {
    supportLevel: "PARTIAL",
    evidenceType: "PROPOSAL_RESPONSE",
    evidenceSource: "Company evidence available for drafting",
    evidenceReference: "Key-Experts-1.txt",
    notes: "One relevant Company Vault document, 3 selected expert(s), and 3 selected project reference(s) may support drafting. The response is not covered until generated content is automatically source-linked.",
  },
  {
    supportLevel: "FULL",
    evidenceType: "COMPANY_DOCUMENT",
    evidenceSource: "AUTO_BYTE_VERIFIED_VAULT_DOCUMENT",
    evidenceReference: "02_Legal_Registration_Documents_Summary.docx.txt",
    notes: null,
  },
  {
    supportLevel: "SUBSTANTIAL",
    evidenceType: "PACKAGE_CONFORMANCE",
    evidenceSource: "AUTO_PACKAGE_CONFORMANCE",
    evidenceReference: "Project-References-5.txt",
    notes: "3 selected project reference(s) are available from 114 project record(s).",
  },
];

describe("a compliance row rendered for the client carries no engine vocabulary", () => {
  for (const [index, row] of REAL_ROWS.entries()) {
    it(`row ${index + 1} (${row.evidenceType}) is clean`, () => {
      const rendered = clientSafeComplianceEvidence(row);
      for (const token of INTERNAL_VOCABULARY) {
        assert.equal(
          rendered.includes(token),
          false,
          `"${token}" reached the client line: ${rendered}`,
        );
      }
      assert.ok(rendered.trim().length > 0, "the row must still say how well the requirement is covered");
    });
  }

  it("still tells the reader how strongly the requirement is covered, and by what kind of evidence", () => {
    const rendered = clientSafeComplianceEvidence({
      supportLevel: "SUBSTANTIAL",
      evidenceType: "PROJECT",
      evidenceSource: "Selected project references",
      evidenceReference: "G+6 General Hospital – Dr Abdul Seid",
      notes: null,
    });
    assert.match(rendered, /substantially evidenced/);
    assert.match(rendered, /project reference/);
    assert.match(rendered, /G\+6 General Hospital – Dr Abdul Seid/, "a named project is exactly what an evaluator wants");
  });
});

describe("evidence references keep real evidence and drop stored filenames", () => {
  it("keeps a named certificate", () => {
    assert.equal(
      clientSafeEvidenceReference("Consultancy Competency Certificate - Grade 1 / Category 1"),
      "Consultancy Competency Certificate - Grade 1 / Category 1",
    );
  });

  it("keeps named experts", () => {
    assert.equal(
      clientSafeEvidenceReference("Selamawit Mesfin, Daniel Getachew Tadesse, Habib Ahmed"),
      "Selamawit Mesfin, Daniel Getachew Tadesse, Habib Ahmed",
    );
  });

  it("drops a stored vault filename", () => {
    assert.equal(clientSafeEvidenceReference("Key-Experts-1.txt"), "");
    assert.equal(clientSafeEvidenceReference("02_Legal_Registration_Documents_Summary.docx.txt"), "");
  });

  it("judges each item separately, so one filename does not discard the projects beside it", () => {
    assert.equal(
      clientSafeEvidenceReference("G+6 General Hospital – Dr Abdul Seid, Project-References-5.txt, Hospital Project"),
      "G+6 General Hospital – Dr Abdul Seid, Hospital Project",
    );
  });

  it("drops a vault filename this codebase has never seen, by shape rather than by name", () => {
    assert.equal(clientSafeEvidenceReference("Some-Future-Vault-Export-9.pdf"), "");
    assert.equal(clientSafeEvidenceReference("quarterly-figures.xlsx"), "");
  });
});
