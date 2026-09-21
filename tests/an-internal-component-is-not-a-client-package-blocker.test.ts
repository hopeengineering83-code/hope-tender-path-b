import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { resolvePackageRole } from "../lib/engine/artifact-quality-schema";

/**
 * THE DEFECT.
 * -----------
 * 2026-09-20. The benchmark tender reported `requiredDocumentsTotal = 1`: the
 * client asked for one file, Technical Proposal.pdf, and that file passed at
 * quality 100 with full requirement coverage and zero issues. The package was
 * refused anyway:
 *
 *   [EXTRA_FILES]            Generated package contains non-required file(s):
 *                            Technical Approach and Methodology.docx
 *   [OUTSIDE_PLAN_DOCUMENTS] 1 generated document(s) are outside the confirmed
 *                            submission plan: Technical Approach and Methodology.docx.
 *
 * An artifact the app had materialized for its own assembly was marked a
 * final-export candidate, and then blocked a package it was never meant to be
 * in.
 *
 * THE RULE PINNED HERE: the tender's required file names are the authority for
 * the client package. An artifact named after one of its own submission's
 * sections is internal assembly material and is excluded from the package
 * rather than blocking it.
 *
 * AND THE LIMIT ON THAT RULE, which matters more: an unplanned artifact that
 * is NOT a recognizable component is an unauthorized client-facing file and
 * must keep blocking. Hiding those would be a worse defect than the one being
 * fixed, so it is tested first.
 */
const SECTIONS: Record<string, string[]> = {
  TECHNICAL_PROPOSAL: ["Cover Letter", "Understanding of the Assignment", "Technical Approach and Methodology", "Work Plan", "Team Composition", "Compliance Matrix", "Submission Checklist"],
  EXPRESSION_OF_INTEREST: ["Cover Letter", "Expression of Interest", "Company Profile", "Understanding of the Assignment", "Submission Checklist"],
};

function role(fileName: string, documentType: string, plannedDeliveryNames: string[]) {
  return resolvePackageRole({
    documentName: fileName.replace(/\.[a-z0-9]+$/i, ""),
    fileName,
    documentType,
    requiredSectionsByType: SECTIONS,
    plannedDeliveryNames,
  });
}

describe("an internal component is not a client-package blocker", () => {
  it("an unauthorized client-facing file STILL blocks", () => {
    for (const stray of ["Bill of Quantities.docx", "Internal Pricing Notes.docx", "Scanned Passport.pdf"]) {
      const resolved = role(stray, "TECHNICAL_PROPOSAL", ["Technical Proposal.pdf"]);
      assert.equal(resolved.role, "UNPLANNED_CLIENT_FILE", `${stray} was hidden from the package check`);
      assert.match(resolved.rationale, /block/i);
    }
  });

  it("the exact observed artifact is internal, not an extra client file", () => {
    const resolved = role("Technical Approach and Methodology.docx", "TECHNICAL_PROPOSAL", ["Technical Proposal.pdf"]);
    assert.equal(resolved.role, "INTERNAL_COMPONENT");
  });

  it("a planned delivery file is a deliverable regardless of its name", () => {
    const resolved = role("Technical Proposal.pdf", "TECHNICAL_PROPOSAL", ["Technical Proposal.pdf"]);
    assert.equal(resolved.role, "PLANNED_DELIVERABLE");
  });

  it("a component the tender DOES ask for separately stays a deliverable", () => {
    // The plan is the authority: if the client asked for the methodology as
    // its own file, it is a deliverable and must be judged as one.
    const resolved = role("Technical Approach and Methodology.docx", "TECHNICAL_PROPOSAL",
      ["Technical Proposal.pdf", "Technical Approach and Methodology.docx"]);
    assert.equal(resolved.role, "PLANNED_DELIVERABLE");
  });

  it("holds across procurement structures", () => {
    assert.equal(role("Company Profile.docx", "EXPRESSION_OF_INTEREST", ["EOI Submission.pdf"]).role, "INTERNAL_COMPONENT");
    assert.equal(role("Audited Accounts 2025.pdf", "EXPRESSION_OF_INTEREST", ["EOI Submission.pdf"]).role, "UNPLANNED_CLIENT_FILE");
  });

  it("both blocker producers consume this authority", () => {
    const exportReadiness = readFileSync("lib/engine/export-readiness.ts", "utf8");
    const finalReadiness = readFileSync("lib/engine/final-submission-readiness.ts", "utf8");
    assert.match(exportReadiness, /resolvePackageRole\(/, "EXTRA_FILES does not consult the package role");
    assert.match(finalReadiness, /resolvePackageRole\(/, "OUTSIDE_PLAN_DOCUMENTS does not consult the package role");
    assert.match(exportReadiness, /INTERNAL_COMPONENT/);
    assert.match(finalReadiness, /INTERNAL_COMPONENT/);
  });

  it("always says why, for a block as much as for an exclusion", () => {
    for (const [file, planned] of [["Bill of Quantities.docx", []], ["Technical Approach and Methodology.docx", []], ["Technical Proposal.pdf", ["Technical Proposal.pdf"]]] as const) {
      const resolved = role(file, "TECHNICAL_PROPOSAL", [...planned]);
      assert.ok(resolved.rationale.length > 30, `${file}: rationale too thin`);
    }
  });
});
