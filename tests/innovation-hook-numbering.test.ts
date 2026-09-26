// An innovation hook's number is where it sits, not what it was called.
//
// THE DELIVERED DEFECT
// --------------------
// Run 34045764622 shipped "C.17 Tender-Specific Innovation Hooks", whose own
// opening promises "the following tender-specific innovation hooks", followed
// by a single entry labelled "Innovation 1". A second gap appeared in earlier
// runs as "Innovation 1" followed directly by "Innovation 3".
//
// Nothing was deleted. Each hook wrote its own number into its title, and the
// second hook is emitted only when the tender names a brand or a website — so
// whenever it is absent the reader counts from 1 to 3 and finds a hole. It is
// the same defect as the Section C numbering: a number asserted by a producer
// that cannot see which of its siblings survived.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { buildBrandedInnovationHooks } from "../lib/engine/deliverable-and-phases";

function numbers(markdown: string): string[] {
  return (markdown.match(/^### Innovation (\d+):/gm) ?? []).map((line) => line.replace(/\D+/g, ""));
}

describe("innovation hooks are numbered by position", () => {
  it("numbers them 1..N when the brand hook is absent", () => {
    const markdown = buildBrandedInnovationHooks({
      tenderText: "Architectural consultancy services for a specialty medical centre.",
      companyName: "Hope Urban Planning Architectural and Engineering Consultancy PLC",
    });
    assert.deepEqual(numbers(markdown), ["1", "2"], `no hole in the numbering:\n${markdown}`);
  });

  it("numbers them 1..N when the brand hook is present", () => {
    const markdown = buildBrandedInnovationHooks({
      tenderText: "Pharo Ventures — see www.pharoventures.com for brand guidelines.",
      companyName: "Hope Urban Planning Architectural and Engineering Consultancy PLC",
    });
    assert.deepEqual(numbers(markdown), ["1", "2", "3"], `all three hooks numbered in order:\n${markdown}`);
    assert.match(markdown, /### Innovation 2: .*Brand Integration from Day One/);
  });

  it("keeps each hook's subject in its heading", () => {
    const markdown = buildBrandedInnovationHooks({
      tenderText: "Architectural consultancy services.",
      companyName: "Hope Engineering",
    });
    assert.match(markdown, /### Innovation 1: Hope Engineering Project Dashboard/);
    assert.match(markdown, /### Innovation 2: Lessons-Learned Memo and Post-Handover Advisory Window/);
  });
});
