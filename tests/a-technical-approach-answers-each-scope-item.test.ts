// The technical approach answers each item of the tender's scope, in its order.
//
// The deterministic writer answered a six-item scope of services with sector
// themes that covered three of the items and named nobody against any of them.
// buildScopeDeliveryPlan reads the tender's own scope items and, for each,
// states who leads it (named only when a proposed expert's title holds that
// discipline), its inputs, deliverables, quality check, approval and a key
// risk. The fixtures are a water scheme and a school, not the tender that
// exposed the gap.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { extractScopeItems, buildScopeDeliveryPlan } from "../lib/engine/scope-delivery-plan";
import { identifySectionCHeading } from "../lib/engine/section-c-authority";
import type { ExpertRecord } from "../lib/engine/benchmark-tables";

const NUMBERED = [
  "[Page 3] SCOPE OF SERVICES",
  "1. Source Assessment and Feasibility",
  "The consultant shall assess candidate boreholes and prepare a feasibility report on yield and water quality.",
  "2. Detailed Design of the Distribution Network",
  "The consultant shall prepare detailed design drawings, technical specifications, cost estimates and bills of quantities for the network.",
  "3. Construction Supervision",
  "The consultant shall supervise the construction works for compliance with the approved design.",
  "4. Commissioning and Handover",
  "The consultant shall conduct final inspection and support handover of the scheme to the operator.",
  "[Page 4] EVALUATION CRITERIA",
  "Experience of the firm.",
].join("\n");

// The same scope as an analysis summary stores it: no list numbers, heading and
// duty sentence on one line.
const INLINE = [
  "# [Page 5] SCOPE OF SERVICES",
  "Site Assessment The consultant shall assess the existing school buildings for structural adequacy.",
  "Architectural Design The consultant shall prepare concept and detailed architectural design for six classrooms.",
  "Regulatory Approvals The consultant shall obtain building permits and applicable approvals.",
  "## Required Qualifications",
].join("\n");

const TEAM = [
  { fullName: "W. Lead", title: "Project Manager / Senior Civil Engineer", yearsExperience: 15 },
  { fullName: "H. Water", title: "Senior Hydraulic Engineer", yearsExperience: 10 },
  { fullName: "R. Site", title: "Resident Engineer", yearsExperience: 8 },
  { fullName: "A. Design", title: "Architect", yearsExperience: 9 },
] as ExpertRecord[];

describe("extractScopeItems", () => {
  it("reads a numbered scope list, in order, and stops at the next heading", () => {
    assert.deepEqual(extractScopeItems(NUMBERED).map((i) => i.title), [
      "Source Assessment and Feasibility",
      "Detailed Design of the Distribution Network",
      "Construction Supervision",
      "Commissioning and Handover",
    ]);
  });

  it("reads the inline form an analysis summary stores", () => {
    assert.deepEqual(extractScopeItems(INLINE).map((i) => i.title), ["Site Assessment", "Architectural Design", "Regulatory Approvals"]);
  });

  it("finds nothing where the tender lists no scope", () => {
    assert.deepEqual(extractScopeItems("The consultant shall deliver the scope of services described in the contract."), []);
    assert.deepEqual(extractScopeItems(""), []);
    assert.equal(buildScopeDeliveryPlan({ tenderText: "No scope here.", experts: TEAM }), "");
  });
});

describe("buildScopeDeliveryPlan", () => {
  const plan = buildScopeDeliveryPlan({ tenderText: NUMBERED, experts: TEAM });
  const block = (n: number) => plan.split(/^### /m)[n] ?? "";

  it("answers every scope item, quoting the tender", () => {
    for (const item of extractScopeItems(NUMBERED)) {
      assert.ok(plan.includes(item.title), `missing ${item.title}`);
      assert.ok(plan.includes(item.description), `the tender's words for ${item.title} are not quoted`);
    }
    for (const field of ["Lead", "Inputs", "Deliverables", "Quality check", "Approval", "Key risk and mitigation"]) {
      assert.equal((plan.match(new RegExp(`^\\| ${field} \\|`, "gm")) ?? []).length, 4, field);
    }
  });

  it("uses the outputs the tender itself names", () => {
    assert.match(block(2), /Detailed design drawings, technical specifications, cost estimates and bills of quantities/);
  });

  it("names a lead only when their own title holds the discipline", () => {
    assert.match(block(3), /\| Lead \| R\. Site \(Resident Engineer\) \|/);
    // No quantity surveyor on the team: the discipline is named, nobody is invented.
    assert.doesNotMatch(plan, /Quantity Surveyor \(.*\)/);
    const noArchitect = buildScopeDeliveryPlan({ tenderText: INLINE, experts: TEAM.filter((e) => !/architect/i.test(e.title ?? "")) });
    assert.match(noArchitect, /\| Lead \| Architect \(discipline lead\) \|/);
  });

  it("adds an authority submission only to an item that is about approvals", () => {
    const inline = buildScopeDeliveryPlan({ tenderText: INLINE, experts: TEAM });
    const approvals = inline.split(/^### /m).find((b) => b.startsWith("3. Regulatory Approvals")) ?? "";
    const design = inline.split(/^### /m).find((b) => b.startsWith("2. Architectural Design")) ?? "";
    assert.match(approvals, /approving authority/);
    assert.doesNotMatch(design, /approving authority/);
  });

  it("is a Section C sub-section the authority recognises", () => {
    assert.match(plan, /^## C\.3 Scope-by-Scope Delivery Plan/m);
    assert.equal(identifySectionCHeading("C.3 Scope-by-Scope Delivery Plan"), "SCOPE_DELIVERY");
  });
});
