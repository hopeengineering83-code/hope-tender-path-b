import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { resolveArtifactQualitySchema } from "../lib/engine/artifact-quality-schema";

/**
 * THE DEFECT.
 * -----------
 * 2026-09-20, POST /api/tenders/{id}/validate returned 422:
 *
 *   Technical Approach and Methodology  [QUALITY GATE score=28]
 *   Missing required sections: Cover Letter, Understanding of the Assignment,
 *   Work Plan, Team Composition, Compliance Matrix, Submission Checklist
 *
 * That list is TECHNICAL_PROPOSAL's own section list, and "Technical Approach
 * and Methodology" is itself one of those sections. A section was being
 * required to contain its siblings, which no section can ever satisfy, so the
 * artifact was permanently unexportable and blocked the package ZIP.
 *
 * The cause was schema selection by `documentType`: a complete proposal and a
 * single narrative component are both persisted as TECHNICAL_PROPOSAL. A
 * one-off had already been patched in for cover letters, by name, with the
 * comment that the type table "has no COVER_LETTER key of its own" — the same
 * bug, fixed for one kind.
 *
 * THE RULE PINNED HERE: an artifact named after one of its parent type's own
 * declared sections is a COMPONENT of that submission, and the parent's
 * section list is not its schema. The rule reads the existing section table,
 * so it carries no tender, sector or filename knowledge.
 *
 * Fixtures below are deliberately cross-sector — architecture/building design,
 * water, roads, geotechnical, supervision, EOI — because the Pharo benchmark
 * must not be what makes this work.
 */

const SECTIONS_BY_TYPE: Record<string, string[]> = {
  TECHNICAL_PROPOSAL: ["Cover Letter", "Understanding of the Assignment", "Technical Approach and Methodology", "Work Plan", "Team Composition", "Compliance Matrix", "Submission Checklist"],
  EXPRESSION_OF_INTEREST: ["Cover Letter", "Expression of Interest", "Company Profile", "Understanding of the Assignment", "Submission Checklist"],
  QUOTATION: ["Quotation Cover Letter", "Price Schedule", "Submission Checklist"],
  FINANCIAL_PROPOSAL: ["Financial Proposal", "Price Schedule"],
};

function resolve(documentName: string, documentType: string, fileName = `${documentName}.docx`) {
  return resolveArtifactQualitySchema({ documentName, fileName, documentType, requiredSectionsByType: SECTIONS_BY_TYPE });
}

describe("a section is not the whole submission", () => {
  it("does not require a methodology component to contain its siblings", () => {
    const schema = resolve("Technical Approach and Methodology", "TECHNICAL_PROPOSAL");
    const required: string[] = [...schema.requiredSections];
    assert.equal(schema.role, "COMPONENT");
    for (const sibling of ["Cover Letter", "Work Plan", "Team Composition", "Compliance Matrix", "Submission Checklist"]) {
      assert.ok(!required.includes(sibling), `still demanding ${sibling}`);
    }
    assert.deepEqual(required, []);
  });

  it("still holds a COMPLETE technical proposal to the full section list", () => {
    const schema = resolve("Technical Proposal", "TECHNICAL_PROPOSAL", "Technical Proposal.pdf");
    assert.equal(schema.role, "COMPLETE_DOCUMENT");
    assert.deepEqual(schema.requiredSections, SECTIONS_BY_TYPE.TECHNICAL_PROPOSAL);
  });

  it("recognises a component through ordering prefixes and extensions", () => {
    for (const name of [
      "03 - Technical Approach and Methodology",
      "2.1 Technical Approach and Methodology",
      "Technical Approach and Methodology",
    ]) {
      const schema = resolve(name, "TECHNICAL_PROPOSAL", `${name}.docx`);
      assert.equal(schema.role, "COMPONENT", `${name} was not recognised as a component`);
    }
  });

  it("keeps the letter-shaped check for cover and transmittal letters", () => {
    for (const name of ["Cover Letter", "Letter of Transmittal", "Transmittal Letter"]) {
      const schema = resolve(name, "TECHNICAL_PROPOSAL");
      assert.equal(schema.role, "COMPONENT");
      assert.deepEqual(schema.requiredSections, ["Dear", "Subject", "Sincerely"]);
    }
  });

  it("works for other procurement structures, not just technical proposals", () => {
    const eoiComponent = resolve("Company Profile", "EXPRESSION_OF_INTEREST");
    assert.equal(eoiComponent.role, "COMPONENT");
    assert.deepEqual(eoiComponent.requiredSections, []);

    const eoiWhole = resolve("Expression of Interest Submission", "EXPRESSION_OF_INTEREST");
    assert.equal(eoiWhole.role, "COMPLETE_DOCUMENT");
    assert.deepEqual(eoiWhole.requiredSections, SECTIONS_BY_TYPE.EXPRESSION_OF_INTEREST);

    const priceComponent = resolve("Price Schedule", "FINANCIAL_PROPOSAL");
    assert.equal(priceComponent.role, "COMPONENT");
  });

  it("is sector-agnostic: the same artifact name behaves identically across sectors", () => {
    // Nothing about water, roads, geotechnical or supervision may change the
    // answer — the rule reads the section table, not the subject matter.
    const roles = [
      "Technical Approach and Methodology",
    ].flatMap((name) => [
      resolve(`${name}`, "TECHNICAL_PROPOSAL", `Rural Water Supply - ${name}.docx`),
      resolve(`${name}`, "TECHNICAL_PROPOSAL", `Road Rehabilitation Supervision - ${name}.docx`),
      resolve(`${name}`, "TECHNICAL_PROPOSAL", `Geotechnical Investigation - ${name}.docx`),
    ]).map((s) => s.role);
    assert.deepEqual(new Set(roles), new Set(["COMPONENT"]));
  });

  it("does not misclassify an unrelated artifact as a component", () => {
    for (const name of ["Bill of Quantities", "Site Investigation Report", "Bid Security"]) {
      const schema = resolve(name, "TECHNICAL_PROPOSAL");
      assert.equal(schema.role, "COMPLETE_DOCUMENT", `${name} was wrongly treated as a section`);
    }
  });

  it("always explains which schema it chose and why", () => {
    for (const [name, type] of [["Technical Approach and Methodology", "TECHNICAL_PROPOSAL"], ["Technical Proposal", "TECHNICAL_PROPOSAL"]] as const) {
      const schema = resolve(name, type);
      assert.ok(schema.rationale.length > 40, `${name}: rationale too thin to act on`);
    }
  });

  // Architecture / building-design consultancy is the first sector on the
  // owner's generalization list, and it is the one most likely to be confused
  // with the benchmark, so it is pinned explicitly here rather than left to be
  // inferred from the water and roads fixtures above.
  it("classifies an architectural building-design submission by the same rule", () => {
    // A single design-methodology narrative inside a building-design bid.
    const component = resolve("Technical Approach and Methodology", "TECHNICAL_PROPOSAL", "Architectural Design Services — Technical Approach and Methodology.docx");
    assert.equal(component.role, "COMPONENT");
    assert.deepEqual([...component.requiredSections], []);

    // The complete submission for the same bid still answers to the full list.
    const whole = resolve("Technical Proposal", "TECHNICAL_PROPOSAL", "Technical Proposal.pdf");
    assert.equal(whole.role, "COMPLETE_DOCUMENT");
    assert.ok(whole.requiredSections.includes("Team Composition"));

    // And the transmittal letter of a building-design bid is a letter, not a
    // proposal — under the name a design practice actually uses for it.
    const letter = resolve("Letter of Transmittal", "TECHNICAL_PROPOSAL", "Letter of Transmittal.docx");
    assert.equal(letter.role, "COMPONENT");
    assert.equal(letter.schemaKey, "COVER_LETTER");
  });

  it("carries no sector, client or benchmark vocabulary in the authority itself", () => {
    const src = readFileSync("lib/engine/artifact-quality-schema.ts", "utf8");
    const code = src
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    for (const forbidden of [/\bPharo\b/i, /\bhospital/i, /\bhealthcare/i, /\bmedical\b/i, /\bEthiopia/i]) {
      assert.equal(forbidden.test(code), false, `executable code mentions ${forbidden}`);
    }
  });

  it("the gate consumes this authority instead of keying on documentType alone", () => {
    const src = readFileSync("lib/engine/export-readiness.ts", "utf8");
    assert.match(src, /resolveArtifactQualitySchema\(/);
    // The old one-off must be gone, not sitting alongside the general rule.
    assert.equal(
      /const isCoverLetterDoc = /.test(src),
      false,
      "the cover-letter special case still exists beside the general rule",
    );
  });

  it("the component's own content rules still exist and are not weakened", () => {
    // Removing the parent's list must not remove the methodology requirements;
    // those live in document-quality-gate and must keep applying.
    const gate = readFileSync("lib/engine/document-quality-gate.ts", "utf8");
    assert.match(gate, /"phases",\s*"tasks",\s*"deliverables",\s*"schedule",\s*"qa",\s*"risk"/);
    assert.match(gate, /methodology\|work\\s\+plan\|approach/);
  });
});
