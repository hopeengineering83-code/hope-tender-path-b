import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { sourceGroundedEvaluationCriteria } from "../lib/engine/tender-evaluation-criteria";
import { buildEvaluatorMirrorSection } from "../lib/engine/evaluator-mirror-builder";

/**
 * Section F of run 36074770709 said it listed "each evaluation criterion
 * stated in the tender ... in the tender's own wording", then printed five
 * criteria the tender does not state, a weight column of em-dashes for a
 * tender that states no weights, and the same "see Section B.2" pointer as
 * evidence for every row. AI Analyze had stored the tender's own five
 * criteria with page and quote; those are now the authority, and each row
 * names the evidence the proposal presents for that criterion.
 */

const ANALYSED = JSON.stringify([
  { criterion: "Relevant healthcare project experience", weight: null, sourcePage: 5, sourceQuote: "Relevant healthcare project experience" },
  { criterion: "Quality and relevance of portfolio", weight: "not stated", sourcePage: 5, sourceQuote: "Quality and relevance of portfolio" },
  { criterion: "Strength of professional team", sourcePage: 5, sourceQuote: "Strength of professional team" },
  { criterion: "Compliance with submission requirements", sourcePage: 5, sourceQuote: "Compliance with submission requirements" },
  { criterion: "Invented without a quote", sourcePage: 5 },
  { criterion: "Relevant healthcare project experience", sourcePage: 5, sourceQuote: "dup" },
]);

describe("the tender's evaluation criteria, as analysed", () => {
  it("keeps only criteria stored with a source quote, once each", () => {
    const criteria = sourceGroundedEvaluationCriteria(ANALYSED);
    assert.deepEqual(criteria.map((c) => c.criterion), [
      "Relevant healthcare project experience",
      "Quality and relevance of portfolio",
      "Strength of professional team",
      "Compliance with submission requirements",
    ]);
    assert.ok(criteria.every((c) => c.weight === null && c.sourcePage === 5));
  });

  it("reads a stated weight and ignores unreadable input", () => {
    const criteria = sourceGroundedEvaluationCriteria(JSON.stringify([{ criterion: "Methodology", weight: 40, sourceQuote: "Methodology 40%" }]));
    assert.equal(criteria[0].weight, "40%");
    assert.deepEqual(sourceGroundedEvaluationCriteria("not json"), []);
    assert.deepEqual(sourceGroundedEvaluationCriteria(null), []);
  });

  it("replaces the keyword detector's criteria in the generator", () => {
    const source = readFileSync("lib/engine/generate-elite.ts", "utf8");
    assert.match(source, /intelligence\.evaluationCriteria = groundedCriteria\.map\(\(c\) => c\.criterion\)/);
  });
});

describe("Section F", () => {
  const criteria = sourceGroundedEvaluationCriteria(ANALYSED).map((c) => c.criterion);
  const section = buildEvaluatorMirrorSection({
    evaluationCriteria: criteria,
    evaluationWeights: [],
    primarySector: "Healthcare",
    projects: [
      { name: "Specialty Hospital Design", country: "Ethiopia", sector: "Healthcare", serviceAreas: "Architectural design, Supervision" },
      { name: "Regional Referral Hospital", country: "Ethiopia", sector: "Healthcare", serviceAreas: "Design review" },
    ],
    experts: [
      { fullName: "Girum Alemu", title: "Senior Architect" },
      { fullName: "Ahmed Kebede", title: "General Manager", certifications: JSON.stringify(["PSTE/6884"]) },
    ],
    scopeItemCount: 6,
    submission: { fileNames: ["Technical Proposal.pdf"], method: "Email submission only" },
  }) ?? "";

  it("prints no weight column when the tender states no weights", () => {
    assert.match(section, /The tender states no weights\./);
    assert.match(section, /^\| Evaluation Criterion \(in the tender's wording\) \| Where This Proposal Answers It \| Evidence in This Proposal \|$/m);
    assert.doesNotMatch(section, /\| Weight \|/);
  });

  it("lists the tender's criteria in its own wording", () => {
    for (const c of criteria) assert.match(section, new RegExp(`^\\| ${c} \\|`, "m"));
  });

  it("names criterion-specific evidence, not one pointer for every row", () => {
    const evidence = section.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Evaluation")).map((l) => l.split("|")[3].trim());
    assert.equal(new Set(evidence).size, evidence.length, evidence.join("\n"));
    assert.ok(evidence.some((e) => /Girum Alemu|Ahmed Kebede|2 named experts|named experts/.test(e)), evidence.join("\n"));
    assert.ok(evidence.some((e) => /Technical Proposal\.pdf/.test(e)), evidence.join("\n"));
  });
});
