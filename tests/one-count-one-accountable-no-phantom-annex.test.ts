// 2026-09-27, Preview, accept run 36336299603 (score 100, READY). The
// delivered PDF still said three things its own pages contradicted:
//
//  - Section F: "8 named experts …; 3 with a professional registration", while
//    the cover letter, Executive Summary and team table showed 4. Section F read
//    the CV with a narrower pattern of its own and missed a CV that states the
//    registration in words.
//  - RACI: "Final issuance and handover" had two Accountable owners, under a
//    sentence that says each activity has exactly one.
//  - Section E: "Section A–D (cross-referenced in proposal annex)" for every
//    requirement the keyword map could not place, including the Cover Letter.
//    The proposal has no annex.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { buildEvaluatorMirrorSection } from "../lib/engine/evaluator-mirror-builder";
import { buildComplianceMatrixSection } from "../lib/engine/compliance-matrix-builder";
import { injectMethodologyTables } from "../lib/engine/methodology-tables";

describe("one registration count, one Accountable, no phantom annex", () => {
  it("counts a registration stated in words in the CV", () => {
    const md = buildEvaluatorMirrorSection({
      evaluationCriteria: ["Strength of professional team"],
      evaluationWeights: [],
      primarySector: "Healthcare",
      experts: [
        { fullName: "Expert One", title: "Engineer", certifications: '["Practicing Professional Engineer (PSTE/1111)"]', profile: "" },
        { fullName: "Expert Two", title: "Sanitary Engineer", certifications: "[]", profile: "Professional Sanitary Engineer, Registration Number PSNE/17891, issued by the construction authority." },
        { fullName: "Expert Three", title: "Architect", certifications: "[]", profile: "Architect with ten years of practice." },
      ],
    }) ?? "";
    assert.match(md, /3 named experts from the firm's own CVs; 2 with a professional registration/);
    assert.match(md, /PSNE\/17891|PSTE\/1111/);
  });

  it("gives every RACI activity exactly one Accountable owner", () => {
    const md = injectMethodologyTables("# Section C: Technical Approach\n", {
      primarySector: "Healthcare",
      experts: [
        { id: "1", fullName: "A Principal", title: "Project Manager", disciplines: [] },
        { id: "2", fullName: "B Lead", title: "Senior Engineer", disciplines: [] },
        { id: "3", fullName: "C Tech", title: "Architect", disciplines: [] },
        { id: "4", fullName: "D Review", title: "Quality Reviewer", disciplines: [] },
      ] as never[],
      projects: [],
    }).markdown;
    const start = md.indexOf("<!-- methodology-table:raci -->");
    assert.ok(start >= 0, "RACI table present");
    const block = md.slice(start).split(/\n<!-- methodology-table:(?!raci)/)[0];
    const rows = block.split("\n").filter((l) => /^\| (?!Activity|-)/.test(l));
    assert.ok(rows.length >= 5);
    for (const row of rows) {
      const cells = row.split("|").slice(2, -1).map((c) => c.trim());
      assert.equal(cells.filter((c) => c === "A").length, 1, row);
    }
  });

  it("does not send a requirement to an annex the proposal does not have", () => {
    const md = buildComplianceMatrixSection({
      requirements: [
        { id: "r1", title: "Cover Letter", priority: "MANDATORY" },
        { id: "r2", title: "Healthcare compliance and workflow planning", priority: "MANDATORY" },
      ],
      matrixRows: [],
      gaps: [],
    }) ?? "";
    assert.doesNotMatch(md, /annex/i);
    assert.match(md, /\| Cover Letter[^|]*\| Cover Letter \|/);
  });

  it("places a requirement by its title before its description", () => {
    // 2026-09-28: "Technical Proposal Submission", whose description mentions
    // project experience, was sent to the Project Portfolio.
    const md = buildComplianceMatrixSection({
      requirements: [
        { id: "r1", title: "Technical Proposal Submission", description: "Submit one PDF presenting the firm's project experience and methodology.", priority: "MANDATORY" },
        { id: "r2", title: "Relevant Project Experience", description: "Demonstrate similar projects with client references.", priority: "SCORED" },
      ],
      matrixRows: [],
      gaps: [],
    }) ?? "";
    assert.match(md, /\| Technical Proposal Submission \| Cover Letter \|/);
    assert.match(md, /\| Relevant Project Experience \| Section B\.2 Project Portfolio \|/);
  });
});


describe("a requirement no keyword places is placed by its type", () => {
  it("sends a methodology requirement to Section C and a certification to Section A", () => {
    const md = buildComplianceMatrixSection({
      requirements: [
        { id: "r1", title: "Traffic Management Planning", description: "Outline how traffic is kept moving during construction.", requirementType: "METHODOLOGY", priority: "SCORED" },
        { id: "r2", title: "Additional Information / Certifications", description: "Any certifications relevant to the works.", requirementType: "ANNEX", priority: "INFORMATIONAL" },
      ],
      matrixRows: [],
      gaps: [],
    }) ?? "";
    assert.match(md, /\| Traffic Management Planning \| Section C\.2 Technical Methodology \|/);
    assert.match(md, /\| Additional Information \/ Certifications \| Section A\.1 Company Background \|/);
    assert.doesNotMatch(md, /Sections A–D/);
  });
});

describe("a requirement answered by the proposal itself", () => {
  it("is FULLY MET at a named section, and stays PARTIALLY MET when it rests on other evidence", () => {
    const md = buildComplianceMatrixSection({
      requirements: [
        { id: "r1", title: "Cover Letter", description: "Include a cover letter.", requirementType: "METHODOLOGY", priority: "SCORED" },
        { id: "r2", title: "Traffic Management Planning", description: "Outline how traffic keeps moving.", requirementType: "METHODOLOGY", priority: "SCORED" },
        { id: "r3", title: "Similar Bridge Projects", description: "Three bridges in ten years.", requirementType: "PROJECT_EXPERIENCE", priority: "SCORED" },
        { id: "r4", title: "Something Unplaceable", description: "Misc.", requirementType: "ANNEX", priority: "SCORED" },
      ],
      matrixRows: [
        { requirementId: "r1", evidenceType: "PROPOSAL_RESPONSE", supportLevel: "PARTIAL" },
        { requirementId: "r2", evidenceType: "PROPOSAL_RESPONSE", supportLevel: "PARTIAL" },
        { requirementId: "r3", evidenceType: "PROJECT", supportLevel: "PARTIAL" },
        { requirementId: "r4", evidenceType: "PROPOSAL_RESPONSE", supportLevel: "PARTIAL" },
      ] as never,
      gaps: [],
    }) ?? "";
    assert.match(md, /\| Cover Letter \| Cover Letter \|[^\n]*\| FULLY MET \|/);
    assert.match(md, /\| Traffic Management Planning \| Section C\.2 Technical Methodology \|[^\n]*\| FULLY MET \|/);
    assert.match(md, /\| Similar Bridge Projects \|[^\n]*\| PARTIALLY MET \|/);
    assert.match(md, /\| Something Unplaceable \| Sections A–D \|[^\n]*\| PARTIALLY MET \|/);
  });
});
