// One verdict for a submission rule, across every surface that reports it.
//
// The Requirements and Evidence panel was taught to say "Enforced by the
// package" for a submission rule. Final Package Readiness, the release
// snapshot, the lifecycle orchestrator and Bid Strategy still said
// "No selected or linked evidence is traced to this requirement" and told the
// owner to "Add trusted traced evidence for mandatory requirement: Financial
// Proposal Omission" — the same wrong ask, one surface over.
//
// Bid Strategy carried its own private copy of "which requirements are
// covered" as well: it read supportLevel straight off the compliance rows,
// ignored source trace entirely, and counted only priority === "MANDATORY"
// while every other surface counts MANDATORY OR CRITICAL. So it could report a
// requirement as covered that Export Readiness reported as untrusted, and drop
// a CRITICAL requirement from its denominator.
//
// These tests hold the surfaces on the one resolver.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

import { mapRequirementsToEvidence } from "../lib/engine/final-package-readiness-model";

const FILE_ID = "file-1";
const QUOTE = "No financial proposal shall be included with the technical submission.";
const ACTIVE_FILES = [{ id: FILE_ID, extractedText: `Section 5. ${QUOTE}`, totalPages: 10 }];

function ruleRequirement() {
  return {
    id: "req-fin",
    title: "Financial Proposal Omission",
    priority: "MANDATORY",
    requirementType: "SUBMISSION",
    sourceTenderFileId: FILE_ID,
    sourcePageNumber: 5,
    sourceExactQuote: QUOTE,
    complianceMatrixRows: [] as Array<{ supportLevel?: string | null }>,
  };
}

function evidenceRequirement() {
  return {
    id: "req-cv",
    title: "CV of the Team Leader",
    priority: "MANDATORY",
    requirementType: "EXPERT",
    sourceTenderFileId: FILE_ID,
    sourcePageNumber: 5,
    sourceExactQuote: QUOTE,
    complianceMatrixRows: [] as Array<{ supportLevel?: string | null }>,
  };
}

const TECHNICAL_PDF = {
  id: "doc-1",
  name: "Technical Proposal.pdf",
  exactFileName: "Technical Proposal.pdf",
  documentType: "TECHNICAL_PROPOSAL",
  format: "PDF",
  generationStatus: "GENERATED",
  validationStatus: "VALIDATED",
  reviewStatus: "APPROVED",
};

const FINANCIAL_PDF = { ...TECHNICAL_PDF, id: "doc-2", name: "Financial Proposal.pdf", exactFileName: "Financial Proposal.pdf", documentType: "FINANCIAL" };

describe("the canonical resolver reports a submission rule as a rule", () => {
  it("marks a rule the package obeys as fully met, with no evidence link needed", () => {
    const [status] = mapRequirementsToEvidence([ruleRequirement()], [], [], ACTIVE_FILES, {
      documents: [TECHNICAL_PDF],
    });
    assert.ok(status.packageRule, "a submission rule must be identified as one");
    assert.equal(status.packageRule!.status, "SATISFIED");
    assert.equal(status.blockerReason, status.packageRule!.reason);
    assert.doesNotMatch(status.blockerReason ?? "", /No selected or linked evidence/);
  });

  it("keeps a rule the package breaks blocked, naming the package defect", () => {
    const [status] = mapRequirementsToEvidence([ruleRequirement()], [], [], ACTIVE_FILES, {
      documents: [TECHNICAL_PDF, FINANCIAL_PDF],
    });
    assert.equal(status.packageRule!.status, "VIOLATED");
    assert.notEqual(status.displayStatus, "FULLY_MET", "fail-closed: a broken rule still blocks");
    assert.match(status.blockerReason ?? "", /Financial Proposal\.pdf/);
    assert.doesNotMatch(status.blockerReason ?? "", /evidence/i);
  });

  it("never claims a rule is met just because the package is empty", () => {
    const [status] = mapRequirementsToEvidence([ruleRequirement()], [], [], ACTIVE_FILES, {
      documents: [],
    });
    assert.equal(status.packageRule!.status, "PENDING_PACKAGE");
    assert.notEqual(status.displayStatus, "FULLY_MET");
  });

  it("leaves an ordinary evidence requirement on the evidence wording", () => {
    const [status] = mapRequirementsToEvidence([evidenceRequirement()], [], [], ACTIVE_FILES, {
      documents: [TECHNICAL_PDF],
    });
    assert.equal(status.packageRule, null);
    assert.match(status.blockerReason ?? "", /No selected or linked evidence is traced/);
  });

  it("omitting the package facts preserves the previous wording exactly", () => {
    const [status] = mapRequirementsToEvidence([ruleRequirement()], [], [], ACTIVE_FILES);
    assert.equal(status.packageRule, null);
    assert.match(status.blockerReason ?? "", /No selected or linked evidence is traced/);
  });
});

describe("every surface passes the package facts to the one resolver", () => {
  const SURFACES = [
    "lib/engine/final-package-readiness-model.ts",
    "lib/engine/tender-release-snapshot.ts",
    "lib/engine/tender-lifecycle-orchestrator.ts",
    "app/api/tenders/[id]/bid-strategy/route.ts",
  ];

  it("hands documents to mapRequirementsToEvidence everywhere it is called", () => {
    for (const path of SURFACES) {
      const source = readFileSync(path, "utf8");
      assert.match(source, /mapRequirementsToEvidence/, `${path} must use the canonical resolver`);
      assert.match(source, /documents:/, `${path} must supply the package facts`);
    }
  });

  it("Bid Strategy no longer keeps a private coverage rule", () => {
    const source = readFileSync("app/api/tenders/[id]/bid-strategy/route.ts", "utf8");
    // The private copy read supportLevel off the rows and counted MANDATORY
    // alone. Neither may return.
    assert.doesNotMatch(
      source,
      /const mandatory = requirements\.filter\(\(r\) => String\(r\.priority \?\? ""\)\.toUpperCase\(\) === "MANDATORY"\)/,
      "the MANDATORY-only denominator must not come back",
    );
    assert.match(source, /mapRequirementsToEvidence\(requirements, \[\], \[\], activeFiles, packageFacts\)/);
    assert.match(source, /status\.displayStatus === "FULLY_MET"/);
  });

  it("blocks a broken submission rule under a rule code, not an evidence code", () => {
    const source = readFileSync("lib/engine/final-package-readiness-model.ts", "utf8");
    assert.match(source, /SUBMISSION_RULE_BROKEN_BY_PACKAGE/);
    assert.match(source, /SUBMISSION_RULE_AWAITING_PACKAGE/);
    // The blocker is still produced — fail-closed is unchanged.
    assert.match(source, /\.filter\(\(status\) => status\.mandatory && status\.displayStatus !== "FULLY_MET"\)/);
  });
});
