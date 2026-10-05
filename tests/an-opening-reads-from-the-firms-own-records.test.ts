/**
 * The proposal's opening and company sections read from the firm's records
 * as a person would write them.
 *
 * 2026-10-05, a local end-to-end run of the deterministic generator on an
 * office-fit-out RFQ (scripts/tmp-local-generation-harness.ts) and the hosted
 * hands-off run 37336342077 on an office-design EOI:
 *  - with no readable scope items, the letter fell back to two sentences and
 *    the Executive Summary to one;
 *  - a description that names the firm as its own subject was spliced in
 *    whole: "… is a meridian Design Consultants PLC is an architectural …";
 *  - a Managing Director signed as "General Manager";
 *  - a Section E row carried the owner instruction "Upload evidence, review
 *    matching candidates, or confirm manual proposal coverage before export",
 *    and the sweep that removed it removed the row, leaving rows 1, 3, 4;
 *  - "1 experts … 1 of them hold".
 * Fixtures are invented firms.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { descriptionAfterOwnName } from "../lib/engine/proposal-labels";
import { resolveSignatory } from "../lib/engine/signatory";
import { buildComplianceMatrixSection } from "../lib/engine/compliance-matrix-builder";
import { recordBasedOpeningSections } from "../lib/engine/generate-elite";
import type { ExpertRecord, ProjectRecord } from "../lib/engine/benchmark-tables";

describe("descriptionAfterOwnName", () => {
  it("takes the predicate of a description that opens with the firm's name and legal form", () => {
    assert.deepEqual(descriptionAfterOwnName("Meridian Design Consultants PLC is an architectural consultancy", ["Meridian Design Consultants"]), { predicate: "an architectural consultancy" });
    assert.deepEqual(descriptionAfterOwnName("Kestrel Engineering Ltd. is a structural practice", ["Kestrel Engineering Ltd.", "Kestrel Engineering"]), { predicate: "a structural practice" });
  });

  it("keeps a self-named description that does not continue with is/are as its own sentence", () => {
    assert.deepEqual(descriptionAfterOwnName("Meridian Design Consultants was founded in 2012 in Addis Ababa", ["Meridian Design Consultants"]), { predicate: null });
  });

  it("is null when the description does not open with the firm's name", () => {
    assert.equal(descriptionAfterOwnName("Architectural and interior design consultancy", ["Meridian Design Consultants"]), null);
  });
});

describe("resolveSignatory", () => {
  it("uses the title the record or the team gives before the General Manager default", () => {
    assert.equal(resolveSignatory({ gmName: "Liya Bekele", gmTitle: "Managing Director" })?.title, "Managing Director");
    assert.equal(resolveSignatory({ gmName: "Liya Bekele", experts: [{ fullName: "Liya Bekele", title: "Managing Director / Principal Architect" }] })?.title, "Managing Director / Principal Architect");
    assert.equal(resolveSignatory({ gmName: "Liya Bekele" })?.title, "General Manager");
  });
});

describe("Section E carries no owner instruction", () => {
  it("states the status without the engine's gap mitigation", () => {
    const md = buildComplianceMatrixSection({
      requirements: [
        { id: "r1", title: "Company Profile", requirementType: "COMPANY_PROFILE", priority: "MANDATORY" },
        { id: "r2", title: "Litigation History Disclosure", requirementType: "DECLARATION", priority: "MANDATORY" },
      ],
      matrixRows: [
        { requirementId: "r1", evidenceType: "COMPANY_DOCUMENT", evidenceReference: "Company profile", supportLevel: "FULL" },
        { requirementId: "r2", evidenceType: "COMPANY_DOCUMENT", evidenceReference: "Register", supportLevel: "PARTIAL" },
      ],
      gaps: [{ requirementId: "r2", description: "Evidence gap", mitigationPlan: "Upload evidence, review matching candidates, or confirm manual proposal coverage before export." }],
    } as never)!;
    assert.doesNotMatch(md, /Upload evidence|matching candidates|before export|Mitigation:/);
    assert.match(md, /\| 2 \| Litigation History Disclosure/);
    assert.doesNotMatch(md, /include a mitigation plan/);
  });
});

describe("the opening sections without readable scope items", () => {
  const projects = [{ name: "Kality Logistics Office Fit-Out", clientName: "Kality Logistics PLC", country: "Ethiopia", sector: "Commercial/office", serviceAreas: JSON.stringify(["Interior design", "Space planning"]), summary: "Interior design of 1,200 m² of office floors." }] as unknown as ProjectRecord[];
  const experts = [{ fullName: "Liya Bekele", title: "Managing Director / Principal Architect", profile: "Professional Architect, Reg. No. AR/1234." }] as unknown as ExpertRecord[];
  const md = recordBasedOpeningSections({
    companyName: "Meridian Design Consultants", clientName: "Lakeside Research Institute", tenderTitle: "Office Floors Interior Design",
    primarySector: "Interior Design / Fit-Out & Space Planning", scopePlan: [], projects, experts,
    companyDescription: "Meridian Design Consultants PLC is an architectural and interior design consultancy registered in Ethiopia",
    recipients: "Lakeside Research Institute", subject: "s", technicalOnly: false, salutation: "Dear Evaluation Committee,", signOff: ["Sincerely,"],
  });

  it("names the reference and the services its record states", () => {
    assert.match(md, /Kality Logistics Office Fit-Out \(Ethiopia, 1,200 m²\)/);
    assert.match(md, /recorded services included interior design and space planning/);
  });

  it("states the firm's own description once, not spliced after its name", () => {
    assert.match(md, /Meridian Design Consultants is an architectural and interior design consultancy registered in Ethiopia\./);
    assert.doesNotMatch(md, /is an? meridian/i);
  });

  it("does not write '1 experts' or '1 of the 1'", () => {
    assert.doesNotMatch(md, /\b1 experts\b|\b1 of the 1\b|\b1 of them hold\b|team of 1 named experts/);
    assert.match(md, /The proposed team is led by Liya Bekele/);
  });
});
