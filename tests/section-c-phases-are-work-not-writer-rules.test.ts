/**
 * The deterministic Section C is built from work, not from the writer's rules
 * or from submission rows.
 *
 * 2026-09-29, Preview (export run 36611674754), an office-design tender:
 * C.2.1 was titled "FORBIDDEN PHRASES: Never write 'demonstrated experience'
 * without a project name; 'c", and the Work Plan's stages were "Site Visit",
 * "Bid Submission Format", "Project Team Qualifications" and "Company Profile
 * and Qualifications", each cut mid-word. B.2 said every project maps "to a
 * Financial / Audit Advisory requirement" because /valuation/ matched
 * "evaluation".
 *
 * Generic fixture (a district library fit-out), not the benchmark tender.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { buildSectionFallback, type ProposalSectionSpec } from "../lib/engine/proposal-sections";
import { BENCHMARK_CONTEXT_LINES, inferSector } from "../lib/engine/proposal-intelligence";
import type { AIBidWriterInput } from "../lib/ai";

const REQUIREMENTS = [
  ...BENCHMARK_CONTEXT_LINES,
  "MANDATORY: Site Visit — Arrange time to visit the site and discuss details with the team until one day before the deadline.",
  "MANDATORY: Bid Submission Format — Submit the proposal with the signature of the authorized person and the seal of the company.",
  "MANDATORY: Project Team Qualifications — Provide qualifications of key members of the proposed project team, including CVs.",
  "MANDATORY: Company Profile and Qualifications — Provide a profile of relevant corporate qualifications.",
  "SCORED: Interior Layout and Space Planning — Prepare space plans and furniture layouts for the reading halls and staff areas.",
  "SCORED: 3D Modelling and Visualisation — Produce 3D models and rendered views of the proposed interiors.",
].join("\n");

function sectionC(): string {
  return buildSectionFallback({ id: "technical-approach" } as unknown as ProposalSectionSpec, {
    tenderTitle: "Interior Design of a District Library",
    clientName: "District Library Board",
    tenderText: "Interior design of a district library. Evaluation criteria: approach and methodology; team.",
    requirements: REQUIREMENTS,
    compliance: "",
    experts: "",
    projects: "",
    differentiators: "",
    companyVault: { name: "Sample Consultants PLC" },
  } as unknown as AIBidWriterInput);
}

describe("Section C phases are work, not writer rules or submission rows", () => {
  it("never prints a writer directive", () => {
    const md = sectionC();
    assert.doesNotMatch(md, /FORBIDDEN PHRASES|EVIDENCE RULE|BENCHMARK STRUCTURE|RULE:/);
  });

  it("does not make submission or credential rows into phases", () => {
    const md = sectionC();
    const headings = md.split("\n").filter((line) => /^### C\.2\.\d/.test(line));
    assert.ok(headings.length >= 6, headings.join("\n"));
    for (const heading of headings) {
      assert.doesNotMatch(heading, /Site Visit|Bid Submission|Team Qualifications|Company Profile/, heading);
    }
    assert.ok(headings.some((h) => /Interior Layout and Space Planning$/.test(h)), headings.join("\n"));
    assert.ok(headings.some((h) => /3D Modelling and Visualisation$/.test(h)), headings.join("\n"));
  });

  it("an 'evaluation criteria' tender is not a finance tender", () => {
    assert.notEqual(inferSector("Interior design of an office. Evaluation criteria: approach, team, experience."), "Financial / Audit Advisory");
    assert.equal(inferSector("Asset valuation and due diligence for a state enterprise."), "Financial / Audit Advisory");
  });
});
