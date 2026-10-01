/**
 * The whole-document fallback writes an EOI as an EOI, and claims no
 * experience the record does not hold.
 *
 * 2026-10-01, Preview, a telecom-tower EOI (inspect run 36876028650): with
 * every section on its deterministic text the delivered EOI opened "Subject:
 * Technical Proposal for …", "This is a TECHNICAL PROPOSAL ONLY", promised
 * "comparable project references" and team members "each with prior
 * comparable delivery experience" for a tender where no project was selected,
 * printed a differentiators lead-in over nothing, and declared the firm "not
 * under any current debarment" ahead of the owner's own signed declaration.
 *
 * Generic fixtures.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { withSubmissionDocumentLabel } from "../lib/engine/generate-elite";
import { buildCoverLetterOpener, buildExecutiveSummaryOpener } from "../lib/engine/benchmark-tables";
import { buildConflictOfInterestSection } from "../lib/engine/understanding-and-value-added";

describe("the document calls itself what the plan says it is", () => {
  const md = "Subject: Technical Proposal for Mast Maintenance\n\nNote: This is a TECHNICAL PROPOSAL ONLY. No financial offer is included.\n\nWe submit this technical proposal.";
  it("an EOI is an Expression of Interest throughout", () => {
    const out = withSubmissionDocumentLabel(md, "Expression of Interest");
    assert.doesNotMatch(out, /technical proposal/i);
    assert.match(out, /Subject: Expression of Interest for/);
    assert.match(out, /this Expression of Interest\./);
  });
  it("a technical proposal is left as written", () => {
    assert.equal(withSubmissionDocumentLabel(md, "Technical Proposal"), md);
  });
});

describe("no project, no claim of comparable experience", () => {
  it("the openers promise nothing the record lacks", () => {
    const cover = buildCoverLetterOpener({ companyName: "S", clientName: "C", tenderTitle: "T", projects: [] });
    const summary = buildExecutiveSummaryOpener({ companyName: "S", clientName: "C", projects: [], reviewedExpertCount: 3 });
    for (const text of [cover, summary]) assert.doesNotMatch(text, /comparable/i);
  });
});

describe("the firm's legal history is the owner's declaration", () => {
  it("D.5 does not state the firm's debarment status", () => {
    assert.doesNotMatch(buildConflictOfInterestSection({ companyName: "S", clientName: "C", tenderTitle: "T" }), /debar/i);
  });
});

import { buildEvaluatorMirrorSection } from "../lib/engine/evaluator-mirror-builder";

describe("Section F answers a legal-history criterion with the declaration", () => {
  it("points declaration and company-record criteria at the right place, not at projects or experts", () => {
    const md = buildEvaluatorMirrorSection({
      evaluationCriteria: ["Litigation History", "History of Non-Performing Contracts", "Legal Status", "Financial Standing"],
      evaluationWeights: [], primarySector: "x", topExpertName: "A. Engineer",
    } as never)!;
    const row = (name: string) => md.split("\n").find((line) => line.startsWith(`| ${name} |`))!;
    for (const name of ["Litigation History", "History of Non-Performing Contracts"]) {
      assert.match(row(name), /Declaration/);
      assert.doesNotMatch(row(name), /Featured Projects|lead expert/);
    }
    for (const name of ["Legal Status", "Financial Standing"]) {
      assert.doesNotMatch(row(name), /lead expert|Section A–D/);
    }
  });
});
