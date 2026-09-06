// The numbers on the contents page must describe the page.
//
// THE DELIVERED DEFECT
// --------------------
// Hosted run 34035620990 regenerated the Pharo Technical Proposal on a head
// that already carried the Section C authority. The authority logged
// "20 sub-section(s) as C.1 … C.20" and the delivered PDF's contents page
// still read:
//
//     C.1 … C.6, C.8 … C.20        (C.7 absent)
//     D.1, D.2, D.3, D.5           (D.4 absent)
//     A.4, A.4a, A.4.1, A.5        (a letter suffix standing in for a number)
//
// with C.13 Relevant project experience, C.14 Team qualifications, C.15
// Company capacity and D.3 Professional Certifications each followed
// immediately by the next heading — four promises with nothing under them.
//
// The numbering was correct when it was derived and wrong when it was
// rendered, because a dozen sanitising passes run in between. These tests pin
// the rule that fixes that class of defect rather than those three symptoms:
// numbering is derived over the sub-sections that survive to the render, and a
// heading with nothing under it is not a section.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { sealDocumentStructure, sectionCHeadingsOf } from "../lib/engine/document-structure-seal";

function headings(markdown: string, letter: string): string[] {
  return markdown
    .split("\n")
    .filter((line) => new RegExp(`^#{2,3}\\s+${letter}\\.`).test(line))
    .map((line) => line.replace(/^#+\s+/, "").trim());
}

describe("a stripped body cannot leave a gap in the numbering", () => {
  it("closes the C.7 hole the delivered proposal shipped", () => {
    // Exactly the shape the sanitisers left behind: the Risk Register heading
    // gone, its tables still sitting under the standards sub-section.
    const md = [
      "# Section C: Technical Approach",
      "",
      "## C.6 Sector-Specific Technical Standards Applied",
      "",
      "HEPA filtration is specified for theatres and isolation rooms.",
      "",
      "Top delivery risks identified for this assignment, with named mitigations.",
      "",
      "## C.8 Healthcare facility design and clinical workflow",
      "",
      "Clinical adjacency and patient-flow planning driven by the clinical brief.",
      "",
      "## C.9 MEP, biomedical engineering and equipment integration",
      "",
      "Load calculations tied to the confirmed equipment schedule.",
      "",
    ].join("\n");

    const numbers = sectionCHeadingsOf(sealDocumentStructure(md).markdown).map((h) => h.split(" ")[0]);
    assert.deepEqual(numbers, ["C.1", "C.2", "C.3"], "numbering is derived over what survived, with no hole");
  });

  it("closes the D.4 hole without inventing the missing declaration", () => {
    const md = [
      "# Section D: Additional Information",
      "",
      "## D.1 Value Framework",
      "",
      "What the client gains.",
      "",
      "## D.2 Value-Added Services",
      "",
      "Optional extensions.",
      "",
      "## D.5 Declaration of No Conflict of Interest",
      "",
      "The firm declares no conflict.",
      "",
    ].join("\n");

    const out = sealDocumentStructure(md).markdown;
    assert.deepEqual(headings(out, "D").map((h) => h.split(" ")[0]), ["D.1", "D.2", "D.3"]);
    assert.ok(!/Declaration of Eligibility/.test(out), "the seal renumbers; it never writes a section that was not there");
  });

  it("gives a letter-suffixed heading a real number of its own", () => {
    const md = [
      "# Section A: Company Profile",
      "",
      "## A.4 Key Personnel",
      "",
      "The proposed personnel.",
      "",
      "## A.4a Proposed Project Team",
      "",
      "The team assigned to this assignment.",
      "",
      "## A.5 Team-to-Project Experience Mapping",
      "",
      "Each expert mapped to a reviewed project.",
      "",
    ].join("\n");

    const out = headings(sealDocumentStructure(md).markdown, "A");
    assert.deepEqual(out.map((h) => h.split(" ")[0]), ["A.4", "A.5", "A.6"]);
    assert.ok(!out.some((h) => /^A\.\d+[a-z]\b/.test(h)), `no letter suffix survives: ${out.join(" | ")}`);
  });

  it("keeps a deliberately zero-based section zero-based", () => {
    const md = "# Section A: Company Profile\n\n## A.0 Portfolio at a Glance\n\nAt a glance.\n\n## A.1 Company Overview\n\nOverview.\n";
    assert.deepEqual(
      headings(sealDocumentStructure(md).markdown, "A").map((h) => h.split(" ")[0]),
      ["A.0", "A.1"],
    );
  });
});

describe("a heading with nothing under it is not a section", () => {
  it("drops the four empty headings the delivered proposal advertised", () => {
    const md = [
      "# Section C: Technical Approach",
      "",
      "## C.12 Proposed Team and Expert Contributions",
      "",
      "The proposed disciplines are mapped to the tender's healthcare scope.",
      "",
      "## C.13 Relevant project experience",
      "",
      "## C.14 Team qualifications and comparable previous roles",
      "",
      "## C.15 Company capacity",
      "",
      "## C.16 Project Phasing and Deliverables",
      "",
      "The engagement is delivered in five phases.",
      "",
    ].join("\n");

    const result = sealDocumentStructure(md);
    assert.equal(result.droppedEmpty.length, 3, `three empty promises dropped, got ${JSON.stringify(result.droppedEmpty)}`);
    const out = sectionCHeadingsOf(result.markdown);
    assert.deepEqual(out.map((h) => h.split(" ")[0]), ["C.1", "C.2"]);
    assert.ok(!/Relevant project experience/.test(result.markdown));
  });

  it("keeps a heading whose only content is a table", () => {
    const md = [
      "# Section C: Technical Approach",
      "",
      "## C.17 RACI Matrix",
      "",
      "| Activity | Lead |",
      "|---|---|",
      "| Inception report | Project Principal |",
      "",
    ].join("\n");
    assert.deepEqual(sealDocumentStructure(md).droppedEmpty, []);
  });

  it("keeps a parent whose content lives entirely in its children", () => {
    const md = [
      "# Section C: Technical Approach",
      "",
      "## C.2 Technical Methodology",
      "",
      "### C.2.1 Site Investigation",
      "",
      "Drilling and soils testing precede the structural model.",
      "",
    ].join("\n");
    const result = sealDocumentStructure(md);
    assert.deepEqual(result.droppedEmpty, []);
    assert.match(result.markdown, /## C\.1 Technical Methodology/);
    assert.match(result.markdown, /### C\.1\.1 Site Investigation/, "a child follows its parent's derived number");
  });
});

describe("what the seal must not touch", () => {
  it("leaves unnumbered headings alone and does not let them consume a number", () => {
    const md = [
      "# Section D: Additional Information",
      "",
      "## D.1 Value Framework",
      "",
      "What the client gains.",
      "",
      "## Submission Checklist",
      "",
      "Each mandatory requirement is addressed.",
      "",
      "## D.2 Value-Added Services",
      "",
      "Optional extensions.",
      "",
    ].join("\n");
    const out = sealDocumentStructure(md).markdown;
    assert.match(out, /^## Submission Checklist$/m, "an unnumbered heading keeps its wording");
    assert.deepEqual(headings(out, "D").map((h) => h.split(" ")[0]), ["D.1", "D.2"]);
  });

  it("is idempotent", () => {
    const md = [
      "# Section C: Technical Approach",
      "",
      "## C.6 Sector-Specific Technical Standards Applied",
      "",
      "Standards applied.",
      "",
      "## C.8 Healthcare facility design",
      "",
      "Clinical workflow.",
      "",
    ].join("\n");
    const once = sealDocumentStructure(md).markdown;
    assert.equal(sealDocumentStructure(once).markdown, once);
  });

  it("gives a sub-section that strayed under Section C one number, not two", () => {
    // A producer emitted a B-numbered heading inside Section C. The reader must
    // never see "C.1 B.2 Project Portfolio" — one heading carries one number.
    const md = "# Section C: Technical Approach\n\n## B.2 Project Portfolio\n\nStray heading.\n";
    const out = sealDocumentStructure(md).markdown;
    assert.match(out, /^## C\.1 Project Portfolio$/m);
    assert.ok(!/C\.\d+ B\.\d/.test(out), `one number per heading: ${out}`);
  });
});

describe("cross-references point at the number the section really has", () => {
  it("repoints a reference whose title moved to a different number", () => {
    // The delivered proposal said "addressed below in Section C.2 (Technical
    // Methodology)" while Technical Methodology was C.3 — a hard-coded number
    // written by a producer that could not know the final ordering.
    const md = [
      "# Section C: Technical Approach",
      "",
      "## C.0 Tender Specifics Recognised by This Proposal",
      "",
      "These are addressed below in Section C.2 (Technical Methodology).",
      "",
      "## C.1 Understanding of the Assignment",
      "",
      "The assignment.",
      "",
      "## C.2 Technical Methodology",
      "",
      "The methodology.",
      "",
    ].join("\n");
    const result = sealDocumentStructure(md);
    assert.match(result.markdown, /Section C\.3 \(Technical Methodology\)/);
    assert.equal(result.resolvedCrossReferences, 1);
  });

  it("leaves a reference alone when it is already correct", () => {
    const md = [
      "# Section C: Technical Approach",
      "",
      "## C.1 Technical Methodology",
      "",
      "See Section C.1 (Technical Methodology) for the staged approach.",
      "",
    ].join("\n");
    assert.equal(sealDocumentStructure(md).resolvedCrossReferences, 0);
  });
});

describe("a sub-section a downstream pass deleted is put back", () => {
  // Hosted run 34037370200: the Risk Register's heading was gone by the render
  // and its tables were left reading as part of C.6 Sector-Specific Technical
  // Standards. The authority named the sub-section and recorded the line its
  // body opens with, so the content can be found again with no heading above
  // it.
  const anchor = "Top delivery risks identified for this assignment, with named mitigations grounded in "
    + "the client's engagement and the firm's institutional controls.";
  const orphaned = [
    "# Section C: Technical Approach",
    "",
    "## C.6 Sector-Specific Technical Standards Applied",
    "",
    "HEPA filtration is specified for theatres and isolation rooms.",
    "",
    anchor,
    "",
    "| Risk | Mitigation |",
    "|---|---|",
    "| Licensing delay | Donor-standard documentation |",
    "",
  ].join("\n");

  it("restores the heading immediately above its orphaned body", () => {
    const result = sealDocumentStructure(orphaned, [
      { title: "Sector-Specific Technical Standards Applied", anchor: "HEPA filtration is specified for theatres and isolation rooms." },
      { title: "Risk Register and Mitigation Strategy", anchor },
    ]);
    assert.deepEqual(result.restored, ["Risk Register and Mitigation Strategy"]);
    const out = sectionCHeadingsOf(result.markdown);
    assert.deepEqual(out, [
      "C.1 Sector-Specific Technical Standards Applied",
      "C.2 Risk Register and Mitigation Strategy",
    ]);
    assert.match(result.markdown, /## C\.2 Risk Register and Mitigation Strategy\n\nTop delivery risks/);
  });

  it("does nothing when the sub-section is already there", () => {
    const intact = orphaned.replace(anchor, `## C.7 Risk Register and Mitigation Strategy\n\n${anchor}`);
    const result = sealDocumentStructure(intact, [
      { title: "Risk Register and Mitigation Strategy", anchor },
    ]);
    assert.deepEqual(result.restored, []);
  });

  it("does not restore a sub-section whose body is gone too", () => {
    const md = "# Section C: Technical Approach\n\n## C.1 Quality Assurance\n\nThree design gates.\n";
    const result = sealDocumentStructure(md, [
      { title: "Risk Register and Mitigation Strategy", anchor: "Top delivery risks identified for this assignment, with named mitigations." },
    ]);
    assert.deepEqual(result.restored, [], "the seal restores a heading, never content");
  });

  it("does not insert a heading above text that already has one", () => {
    const md = [
      "# Section C: Technical Approach",
      "",
      "## C.1 Work Plan and Deliverables",
      "",
      "Top delivery risks identified for this assignment, with named mitigations grounded in the client's engagement.",
      "",
    ].join("\n");
    assert.deepEqual(sealDocumentStructure(md, [{ title: "Risk Register and Mitigation Strategy", anchor }]).restored, []);
  });
});

describe("cross-references written without parentheses", () => {
  it("repoints a compliance-matrix reference at the number the section now has", () => {
    const md = [
      "# Section A: Company Profile",
      "",
      "## A.4 Key Personnel",
      "",
      "The proposed personnel.",
      "",
      "## A.4a Proposed Project Team",
      "",
      "The assigned team.",
      "",
      "# Section E: Compliance Matrix",
      "",
      "## E.1 Bid Compliance Mapping",
      "",
      "Multidisciplinary team — Section A.4 Proposed Project Team, evidenced by the CVs.",
      "",
    ].join("\n");
    const result = sealDocumentStructure(md);
    assert.match(result.markdown, /Section A\.5 Proposed Project Team/);
    assert.equal(result.resolvedCrossReferences, 1);
  });

  it("leaves a reference to a title this document does not carry", () => {
    const md = "# Section A: Company Profile\n\n## A.1 Company Overview\n\nOverview.\n\nSee Section Z.9 Some Other Document for detail.\n";
    assert.equal(sealDocumentStructure(md).resolvedCrossReferences, 0);
  });
});
