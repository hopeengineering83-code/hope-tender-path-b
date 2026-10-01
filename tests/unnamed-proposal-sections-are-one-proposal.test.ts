/**
 * A tender that names no files gets ONE technical proposal, not a file per
 * section.
 *
 * 2026-09-29, Preview: the tender stated no file names; AI Analyze returned
 * "Company Profile and Qualifications" and "Technical Approach and
 * Methodology" (plus team, portfolio, format, validity rows). The Build Plan
 * made the first two separate required .docx files; Proposal Generation
 * wrote the complete Technical Proposal covering every row, and auto-finalize
 * retired it as outside the plan. The package was two short drafts.
 *
 * Generic fixture (office fit-out design), not the benchmark tender.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { buildSubmissionPlan } from "../lib/engine/submission-plan";

const base = { priority: "MANDATORY", exactFileName: null, exactOrder: null } as const;
const UNNAMED = [
  { ...base, id: "r1", requirementType: "COMPANY_PROFILE", title: "Company Profile and Qualifications", description: "Provide the firm profile and relevant qualifications." },
  { ...base, id: "r2", requirementType: "METHODOLOGY", title: "Technical Approach and Methodology", description: "Describe the approach to the design of the office space." },
  { ...base, id: "r3", requirementType: "EXPERT", title: "Project Team Qualifications", description: "CVs of the proposed architect and design team." },
  { ...base, id: "r4", requirementType: "COMPANY_PROFILE", title: "Portfolio and Experience", description: "List similar completed assignments." },
  { ...base, id: "r5", requirementType: "FORMAT", title: "Bid Submission Format", description: "The proposal must be signed by the authorized person and sealed." },
];

describe("unnamed proposal sections fold into one Technical Proposal", () => {
  it("plans one Technical Proposal carrying every section's requirement id", () => {
    const plan = buildSubmissionPlan({ id: "t", title: "Office Fit-out Design Services", requirements: [...UNNAMED] });
    const technical = plan.files.filter((file) => file.envelope === "TECHNICAL");
    assert.deepEqual(technical.map((file) => file.exactFileName), ["Technical Proposal.docx"]);
    assert.equal(technical[0].documentType, "TECHNICAL_PROPOSAL");
    assert.equal(technical[0].required, true);
    for (const id of ["r1", "r2"]) assert.ok(technical[0].sourceRequirementIds.includes(id), `${id} keeps its provenance`);
  });

  it("an EOI tender's single file is the Expression of Interest", () => {
    const plan = buildSubmissionPlan({ id: "t", title: "Expression of Interest for Office Design", requirements: [...UNNAMED] });
    assert.ok(plan.files.some((file) => file.exactFileName === "Expression of Interest.docx"));
  });

  it("a tender that names its files keeps them exactly as named", () => {
    const plan = buildSubmissionPlan({
      id: "t",
      exactFileNaming: JSON.stringify(["01-Company-Profile.docx", "02-Methodology.docx"]),
      requirements: [
        { ...UNNAMED[0], exactFileName: "01-Company-Profile.docx", exactOrder: 1 },
        { ...UNNAMED[1], exactFileName: "02-Methodology.docx", exactOrder: 2 },
      ],
    });
    assert.deepEqual(plan.files.map((file) => file.exactFileName), ["01-Company-Profile.docx", "02-Methodology.docx"]);
  });

  it("financial proposals and tender forms stay separate files", () => {
    const plan = buildSubmissionPlan({
      id: "t",
      requirements: [
        ...UNNAMED,
        { ...base, id: "f1", requirementType: "FINANCIAL", title: "Financial Proposal", description: "Provide the priced financial proposal with the fee breakdown." },
        { ...base, id: "f2", requirementType: "FORM", title: "Bid Submission Form", description: "Complete the attached bid form." },
      ],
    });
    const names = plan.files.map((file) => file.exactFileName);
    assert.ok(names.includes("Technical Proposal.docx"));
    assert.ok(names.some((name) => /financial proposal/i.test(name)), `financial kept: ${names.join(", ")}`);
    assert.ok(names.some((name) => /bid submission form/i.test(name)), `form kept: ${names.join(", ")}`);
    assert.equal(names.filter((name) => /company profile|methodology/i.test(name)).length, 0);
  });
});
