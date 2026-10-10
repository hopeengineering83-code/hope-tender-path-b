// A criterion that awards points is SCORED; only a stated consequence makes
// it a gate — and a mandatory requirement stays mandatory however the model
// spells it.
//
// 2026-10-10: the deterministic fallback analysis (staged for owner approval
// when every AI provider fails) classed "The methodology and work plan shall be
// evaluated out of 30 points" as MANDATORY because it reads "shall", and bundled
// "Specific experience of the consultant: 20 points" with a page limit into one
// MANDATORY requirement, because a bundle took the strongest priority of its
// members. A scored criterion the firm answers weakly then became a hard
// compliance gap. Separately, AI Analyze stored the model's priority label as
// written: the promotion gate reads /mandatory|critical/i, the compliance engine
// compares === "MANDATORY", so a "Mandatory" requirement was grounded as
// mandatory and then raised no gap when unmet.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { analyzeTender } from "../lib/engine/analysis";
import { mapToDraft } from "../lib/ai-jobs/analysis-job-service";
import { buildCompliance } from "../lib/engine/compliance";

const LINES = [
  "1. The methodology and work plan shall be evaluated out of 30 points.",
  "2. Specific experience of the consultant relevant to the assignment: 20 points.",
  "3. The bidder must submit a valid trade licence; bids without it will be rejected.",
  "4. Qualifications of key experts shall be scored (40 marks).",
  "5. The technical proposal shall not exceed 30 pages.",
  "6. Bidders scoring below 70 points in the technical evaluation shall be disqualified.",
  "7. A bid security of 2% of the bid price shall be submitted with the bid.",
];

function analyse(lines: string[]) {
  return analyzeTender({ id: "t", title: "Consultancy", files: [{ id: "f", originalFileName: "tor.pdf", mimeType: "application/pdf", classification: null, extractedText: lines.join("\n") }] } as never).requirements;
}

describe("the fallback analysis keeps scored criteria scored", () => {
  it("a points-bearing criterion is SCORED, whatever verb it uses", () => {
    const [only] = analyse([LINES[0]!]);
    assert.equal(only!.priority, "SCORED");
  });

  it("a pass mark, a rejection, a page limit and a bid security stay MANDATORY", () => {
    for (const line of [LINES[2]!, LINES[4]!, LINES[5]!, LINES[6]!]) {
      const [only] = analyse([line]);
      assert.equal(only!.priority, "MANDATORY", line);
    }
  });

  it("no MANDATORY bundle carries a scored criterion; every scored line lands in a SCORED requirement", () => {
    const requirements = analyse(LINES);
    for (const r of requirements.filter((x) => x.priority === "MANDATORY")) {
      assert.doesNotMatch(r.description, /20 points|40 marks|out of 30 points/, r.description);
    }
    const scored = requirements.filter((x) => x.priority === "SCORED").map((x) => x.description).join(" ");
    for (const marker of ["out of 30 points", "20 points", "40 marks"]) assert.ok(scored.includes(marker), marker);
  });
});

describe("AI Analyze stores one spelling of a priority", () => {
  const draft = (priority: string) => mapToDraft({ title: "Valid trade licence", description: "The bidder shall submit a valid trade licence.", requirementType: "ELIGIBILITY", priority } as never);

  it("'Mandatory', ' mandatory ' and 'MANDATORY' are one priority", () => {
    for (const label of ["Mandatory", " mandatory ", "MANDATORY"]) assert.equal(draft(label).priority, "MANDATORY", label);
    assert.equal(draft("").priority, "INFORMATIONAL");
  });

  it("so an unmet mandatory requirement the model wrote as 'Mandatory' raises its gap", () => {
    const result = buildCompliance([{ id: "r", requirement: draft("Mandatory") }],
      { companyId: "c", experts: [], projects: [], documents: [], legalRecords: [], financialRecords: [], complianceRecords: [] } as never,
      { expertMatches: [], projectMatches: [] } as never);
    assert.equal(result.gaps.find((g) => g.requirementId === "r")?.severity, "CRITICAL");
  });
});
