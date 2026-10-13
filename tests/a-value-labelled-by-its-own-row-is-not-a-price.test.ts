// A bare amount labelled by its own row is not a price because a neighbouring
// row says "this assignment".
//
// 2026-09-27: the owner's Run Engine produced a Technical Proposal.docx that
// the gate refused at 63 (PRICING_LEAKAGE, "ETB 550.1M"). The project card
// read, one DOCX cell per line:
//   Relevance to This Assignment
//   Same sector as this assignment (Healthcare). ... scope items of this tender ...
//   Construction Value of Works
//   ETB 550.1M
// The value's own label names a delivered asset, but the five-fragment context
// window saw "this assignment" in the row above and vetoed the exemption.
// Fixtures are generic.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { pricingLeakageFinding } from "../lib/engine/pricing-hygiene";

const doc = { name: "Technical Proposal.docx", exactFileName: "Technical Proposal.docx", documentType: "TECHNICAL_PROPOSAL", format: "DOCX" } as never;

const card = (label: string, value: string) => [
  "District Clinic — Healthcare",
  "Field",
  "Detail",
  "Services Provided",
  "Feasibility study, Architectural design, MEP design",
  "Relevance to This Assignment",
  "Same sector as this assignment (Healthcare). The firm's recorded services correspond to these scope items of this tender: Detailed Design (architectural design).",
  label,
  value,
].join("\n");

describe("a value labelled by its own row is not a price", () => {
  it("passes the delivered asset's value under its own label", () => {
    assert.equal(pricingLeakageFinding(card("Construction Value of Works", "ETB 550.1M"), doc), null);
  });

  it("still refuses a fee, and a value its own label ties to this bid", () => {
    assert.ok(pricingLeakageFinding(card("Consultancy Fee", "ETB 1.1M"), doc));
    assert.ok(pricingLeakageFinding(card("Construction value of works for this assignment", "ETB 550.1M"), doc));
  });
});
