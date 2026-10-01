// A submission RULE is verified by observing the package, never by asking the
// owner for evidence.
//
// The live tender showed two mandatory requirements permanently stuck at
// "Partially verified":
//
//   "Submission in a Single PDF Technical File"   [Format]
//   "Financial Proposal Omission"                 [Submission]
//
// both carrying "Automatically linked. The Engine will strengthen this
// requirement when more specific eligible evidence or validated output bytes
// become available." Neither can ever be strengthened: no company record, CV,
// licence or tender source file can prove that our submission is one PDF or
// that it carries no financial proposal. They were being scored by TEXT
// SIMILARITY against candidate records, and the name of a rule never closely
// matches the name of a document, so the score always landed under the FULL
// threshold and parked at PARTIAL.
//
// These tests prove the rule is now decided by observing the package, that a
// package which breaks a rule is still blocked (fail-closed), and that a
// package which cannot yet be observed is not reported as an evidence gap.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyPackageRule,
  evaluatePackageConformance,
  type ConformanceDocument,
} from "../lib/engine/package-conformance";

function doc(overrides: Partial<ConformanceDocument> & { id: string }): ConformanceDocument {
  return {
    name: overrides.exactFileName ?? overrides.id,
    exactFileName: null,
    documentType: "TECHNICAL_PROPOSAL",
    format: "PDF",
    generationStatus: "GENERATED",
    validationStatus: "VALIDATED",
    reviewStatus: "APPROVED",
    ...overrides,
  };
}

const SINGLE_PDF = { title: "Submission in a Single PDF Technical File", requirementType: "FORMAT" };
const FIN_OMISSION = { title: "Financial Proposal Omission", requirementType: "SUBMISSION" };

test("the two live-tender rules are recognised as package rules, not evidence requirements", () => {
  assert.equal(classifyPackageRule(SINGLE_PDF), "SINGLE_FILE_CONSOLIDATION");
  assert.equal(classifyPackageRule(FIN_OMISSION), "FINANCIAL_SEPARATION");
});

test("an ordinary evidence requirement is untouched by the conformance path", () => {
  for (const title of [
    "CV of the Team Leader",
    "Three similar project references in the last five years",
    "Audited financial statements for the last three years",
    "Valid trade licence",
  ]) {
    assert.equal(classifyPackageRule({ title, requirementType: "EXPERT" }), null, title);
    const result = evaluatePackageConformance({ title }, { documents: [] });
    assert.equal(result.applicable, false, title);
  }
});

test("single-PDF rule is SATISFIED when the technical envelope resolves to exactly one PDF", () => {
  const result = evaluatePackageConformance(SINGLE_PDF, {
    documents: [
      doc({ id: "d1", exactFileName: "Technical Proposal.pdf", format: "PDF" }),
      // Superseded rows are historical and must not count; the canonical
      // current-document selection drops them.
      doc({ id: "d2", exactFileName: "Technical Proposal.docx", format: "DOCX", generationStatus: "SUPERSEDED" }),
    ],
  });
  assert.equal(result.status, "SATISFIED");
  assert.match(result.reason, /exactly one export-candidate file/);
  assert.match(result.factDigest, /^[a-f0-9]{64}$/);
});

test("single-PDF rule is VIOLATED — not partially met — when the technical envelope holds two files", () => {
  const result = evaluatePackageConformance(SINGLE_PDF, {
    documents: [
      doc({ id: "d1", exactFileName: "Technical Proposal.pdf" }),
      doc({ id: "d2", exactFileName: "Methodology.pdf", documentType: "METHODOLOGY" }),
    ],
  });
  assert.equal(result.status, "VIOLATED");
  assert.match(result.reason, /holds 2/);
  assert.match(result.reason, /Technical Proposal\.pdf/);
});

test("single-PDF rule is VIOLATED when the one technical file is not a PDF", () => {
  const result = evaluatePackageConformance(SINGLE_PDF, {
    documents: [doc({ id: "d1", exactFileName: "Technical Proposal.docx", format: "DOCX" })],
  });
  assert.equal(result.status, "VIOLATED");
  assert.match(result.reason, /single PDF file/);
});

test("single-PDF rule is PENDING_PACKAGE — never an evidence gap — before any document exists", () => {
  const result = evaluatePackageConformance(SINGLE_PDF, { documents: [] });
  assert.equal(result.status, "PENDING_PACKAGE");
  assert.match(result.reason, /needs no owner-supplied evidence/);
});

test("financial-omission rule is SATISFIED when no financial-envelope document is in the package", () => {
  const result = evaluatePackageConformance(FIN_OMISSION, {
    documents: [
      doc({ id: "d1", exactFileName: "Technical Proposal.pdf" }),
      doc({ id: "d2", exactFileName: "Company Registration.pdf", documentType: "LEGAL" }),
    ],
  });
  assert.equal(result.status, "SATISFIED");
  assert.match(result.reason, /none of them belongs to the financial envelope/);
});

test("financial-omission rule is VIOLATED when a priced document is still in the package", () => {
  // The declared format must match the extension, or the artifact-identity
  // authority correctly excludes the row as mislabelled before the packaging
  // rule ever sees it — "Bill of Quantities.xlsx" declared PDF is not a real
  // document, it is a defect of its own.
  for (const [name, format] of [
    ["Financial Proposal.pdf", "PDF"],
    ["Bill of Quantities.xlsx", "XLSX"],
    ["Price Schedule.pdf", "PDF"],
  ] as const) {
    const result = evaluatePackageConformance(FIN_OMISSION, {
      documents: [
        doc({ id: "d1", exactFileName: "Technical Proposal.pdf" }),
        doc({ id: "d2", exactFileName: name, format, documentType: "FINANCIAL" }),
      ],
    });
    assert.equal(result.status, "VIOLATED", name);
    assert.match(result.reason, /financial-envelope document/);
  }
});

test("financial-omission rule is PENDING_PACKAGE before any document exists", () => {
  const result = evaluatePackageConformance(FIN_OMISSION, { documents: [] });
  assert.equal(result.status, "PENDING_PACKAGE");
});

test("file-format rule checks the demanded format against every current document in scope", () => {
  const req = { title: "All documents must be submitted in PDF format", requirementType: "FORMAT" };
  assert.equal(classifyPackageRule(req), "FILE_FORMAT");

  const ok = evaluatePackageConformance(req, {
    documents: [doc({ id: "a", exactFileName: "A.pdf" }), doc({ id: "b", exactFileName: "B.pdf" })],
  });
  assert.equal(ok.status, "SATISFIED");

  const bad = evaluatePackageConformance(req, {
    documents: [doc({ id: "a", exactFileName: "A.pdf" }), doc({ id: "b", exactFileName: "B.docx", format: "DOCX" })],
  });
  assert.equal(bad.status, "VIOLATED");
  assert.match(bad.reason, /B\.docx/);
});

test("file-naming rule is decided only against a CONFIRMED build plan, never guessed", () => {
  const req = { title: "File naming convention must be followed exactly", requirementType: "FORMAT" };
  assert.equal(classifyPackageRule(req), "FILE_NAMING");

  const noPlan = evaluatePackageConformance(req, {
    documents: [doc({ id: "a", exactFileName: "Technical Proposal.pdf" })],
    planConfirmed: false,
  });
  assert.equal(noPlan.status, "PENDING_PACKAGE");

  const conforms = evaluatePackageConformance(req, {
    documents: [doc({ id: "a", exactFileName: "Technical Proposal.pdf" })],
    plannedFileNames: ["Technical Proposal.pdf"],
    planConfirmed: true,
  });
  assert.equal(conforms.status, "SATISFIED");

  const breaks = evaluatePackageConformance(req, {
    documents: [doc({ id: "a", exactFileName: "untitled (1).pdf" })],
    plannedFileNames: ["Technical Proposal.pdf"],
    planConfirmed: true,
  });
  assert.equal(breaks.status, "VIOLATED");
  assert.match(breaks.reason, /untitled \(1\)\.pdf/);
});

test("a packaging rule the stored bytes cannot decide is never reported as met", () => {
  for (const title of [
    "The technical proposal must not exceed 40 pages",
    "Three hard copies must be delivered, spiral bound",
    "Font size must be at least 11pt",
  ]) {
    const req = { title, requirementType: "FORMAT" };
    assert.equal(classifyPackageRule(req), "NOT_MACHINE_DECIDABLE", title);
    const result = evaluatePackageConformance(req, {
      documents: [doc({ id: "a", exactFileName: "Technical Proposal.pdf" })],
    });
    assert.equal(result.status, "NOT_MACHINE_DECIDABLE", title);
    assert.notEqual(result.status, "SATISFIED");
  }
});

test("the fact digest changes when the package changes, so a stale verdict cannot survive", () => {
  const one = evaluatePackageConformance(SINGLE_PDF, {
    documents: [doc({ id: "a", exactFileName: "Technical Proposal.pdf" })],
  });
  const same = evaluatePackageConformance(SINGLE_PDF, {
    documents: [doc({ id: "a", exactFileName: "Technical Proposal.pdf" })],
  });
  const changed = evaluatePackageConformance(SINGLE_PDF, {
    documents: [doc({ id: "a", exactFileName: "Technical Proposal.pdf", validationStatus: "PENDING" })],
  });
  assert.equal(one.factDigest, same.factDigest);
  assert.notEqual(one.factDigest, changed.factDigest);
});

test("a substantive evidence requirement that merely mentions PDF keeps its evidence path", () => {
  // "submit the audited financial statements in PDF" is an evidence
  // requirement with a format note attached, not a packaging rule.
  assert.equal(
    classifyPackageRule({
      title: "Audited financial statements for the last three years, submitted in PDF format",
      requirementType: "FINANCIAL",
    }),
    null,
  );
});
