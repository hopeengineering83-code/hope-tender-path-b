// Unit tests for constraint-validator (gap #4 — compliance reasoning).
// Pure-function coverage: deterministic sweep, threshold checker,
// prompt formatters, weak-axis derivation.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  validateConstraints,
  formatConstraintsForCritique,
  formatViolationsForCritique,
  violationsAsWeakAxes,
} from "../lib/engine/constraint-validator";
import type { DeepTenderComprehension } from "../lib/engine/evaluation-criteria-extractor";

function comprehension(opts: Partial<DeepTenderComprehension> = {}): DeepTenderComprehension {
  return {
    reasoning: "test",
    criteria: opts.criteria ?? [],
    disqualifiers: opts.disqualifiers ?? [],
    prohibitions: opts.prohibitions ?? [],
    totalWeightAccountedFor: opts.totalWeightAccountedFor ?? null,
  };
}

describe("validateConstraints — null/empty inputs", () => {
  it("returns empty result when comprehension is null", () => {
    const r = validateConstraints(null, "## Cover Letter\n\nText.");
    assert.deepEqual(r.violations, []);
    assert.deepEqual(r.cleared, []);
    assert.deepEqual(r.deferredToCritic, []);
  });

  it("returns empty result when comprehension has no rules", () => {
    const r = validateConstraints(comprehension(), "## Cover Letter\n\nText.");
    assert.deepEqual(r.violations, []);
  });
});

describe("validateConstraints — JV prohibition", () => {
  const comp = comprehension({ prohibitions: ["No joint ventures permitted"] });

  it("flags joint venture mention as a CRITICAL prohibition violation", () => {
    const md = "## Section A\n\nWe propose to deliver this assignment in joint venture with ABC Partners.";
    const r = validateConstraints(comp, md);
    assert.equal(r.violations.length, 1);
    assert.equal(r.violations[0].type, "prohibition");
    assert.equal(r.violations[0].severity, "CRITICAL");
    assert.match(r.violations[0].rule, /joint ventures/);
    assert.match(r.violations[0].evidence, /joint venture with/);
    assert.equal(r.violations[0].location, "Section A");
    assert.match(r.violations[0].suggestion, /joint venture/);
  });

  it("flags JV abbreviation usage", () => {
    const md = "## Cover Letter\n\nWe will deliver through our JV partner XYZ Ltd.";
    const r = validateConstraints(comp, md);
    assert.equal(r.violations.length, 1);
    assert.equal(r.violations[0].severity, "CRITICAL");
  });

  it("clears the prohibition when no JV language is present", () => {
    const md = "## Cover Letter\n\nWe will deliver as sole prime contractor with our in-house team.";
    const r = validateConstraints(comp, md);
    assert.equal(r.violations.length, 0);
    assert.deepEqual(r.cleared, ["No joint ventures permitted"]);
  });
});

describe("validateConstraints — subcontracting prohibition", () => {
  const comp = comprehension({ prohibitions: ["Sub-contracting of core services is not permitted"] });

  it("flags subcontracting mention", () => {
    const md = "## Section C\n\nNon-core works will be subcontracted to a local firm.";
    const r = validateConstraints(comp, md);
    assert.equal(r.violations.length, 1);
    assert.equal(r.violations[0].type, "prohibition");
  });

  it("does NOT flag the rule itself appearing in the proposal", () => {
    const md = "## Section A\n\nWe confirm that no part of the assignment will be subcontracted.";
    const r = validateConstraints(comp, md);
    // The negative phrasing should not trip the matcher
    assert.equal(r.violations.length, 0);
  });
});

describe("validateConstraints — financial content in technical envelope", () => {
  const comp = comprehension({ prohibitions: ["No price or cost information in the technical envelope — two-envelope submission"] });

  it("flags an explicit price quote in the technical envelope", () => {
    const md = "## Section C\n\nOur price is ETB 1,500,000 total for the assignment.";
    const r = validateConstraints(comp, md);
    assert.ok(r.violations.length >= 1, `expected price quote to be flagged; got ${r.violations.length} violations`);
    assert.match(r.violations[0].suggestion, /technical envelope/i);
  });

  it("does NOT flag a procurement-cost description that lacks figures", () => {
    const md = "## Section C\n\nThe firm will reuse equipment, reducing procurement complexity for the client.";
    const r = validateConstraints(comp, md);
    assert.equal(r.violations.length, 0);
  });
});

describe("validateConstraints — advance-payment prohibition", () => {
  const comp = comprehension({ prohibitions: ["Advance payment is not permitted under any circumstances"] });

  it("flags a proposed advance payment", () => {
    const md = "## Payment Terms\n\nWe request an advance payment of 20% on contract signing.";
    const r = validateConstraints(comp, md);
    assert.ok(r.violations.length >= 1);
    assert.match(r.violations[0].suggestion, /advance payment|mobilisation/i);
  });
});

describe("validateConstraints — alliance / partnership prohibition", () => {
  const comp = comprehension({ prohibitions: ["No alliance or teaming arrangement is permitted — sole bidder required"] });

  it("flags an explicit strategic-alliance arrangement", () => {
    const md = "## Section A\n\nWe deliver this assignment in strategic alliance with Acme Engineering.";
    const r = validateConstraints(comp, md);
    assert.ok(r.violations.length >= 1);
  });

  it("does NOT flag generic 'partnership' language without an alliance counterparty", () => {
    const md = "## Section A\n\nWe value a close partnership approach with our clients.";
    const r = validateConstraints(comp, md);
    assert.equal(r.violations.length, 0);
  });
});

describe("validateConstraints — additional-cost-to-client prohibition", () => {
  const comp = comprehension({ prohibitions: ["No additional purchase or cost shall be incurred by the client — client shall not procure additional software"] });

  it("flags a proposal where the client must purchase third-party software", () => {
    const md = "## Section C\n\nThe client will purchase Microsoft licences separately to support the deliverables.";
    const r = validateConstraints(comp, md);
    assert.ok(r.violations.length >= 1);
    assert.match(r.violations[0].suggestion, /at no extra cost|included in the firm/i);
  });
});

describe("validateConstraints — contract assignment prohibition", () => {
  const comp = comprehension({ prohibitions: ["Assignment of contract is not permitted"] });

  it("flags an asserted right to assign the contract", () => {
    const md = "## Section D\n\nWe reserve the right to assign the contract to a subsidiary if required.";
    const r = validateConstraints(comp, md);
    assert.ok(r.violations.length >= 1);
  });
});

describe("validateConstraints — bespoke / no-boilerplate prohibition", () => {
  const comp = comprehension({ prohibitions: ["Bespoke proposal required — no generic boilerplate or template language"] });

  it("flags 'leading firm in the region' boilerplate", () => {
    const md = "## Section A\n\nWe are a leading firm in the region with extensive expertise.";
    const r = validateConstraints(comp, md);
    assert.ok(r.violations.length >= 1);
  });

  it("flags 'world-class expertise' boilerplate", () => {
    const md = "## Section A\n\nOur team brings world-class expertise to every assignment.";
    const r = validateConstraints(comp, md);
    assert.ok(r.violations.length >= 1);
  });
});

describe("validateConstraints — unknown prohibition", () => {
  it("defers prohibitions with no matching pattern to the critic", () => {
    const comp = comprehension({ prohibitions: ["The firm shall not propose any innovation not pre-approved by the client"] });
    const r = validateConstraints(comp, "## A\n\nProposal text.");
    assert.equal(r.violations.length, 0);
    assert.equal(r.deferredToCritic.length, 1);
    assert.match(r.deferredToCritic[0], /pre-approved/);
  });
});

describe("validateConstraints — year-threshold disqualifier", () => {
  it("flags a disqualifier when the proposal claims a founding year that violates the minimum tenure", () => {
    const currentYear = new Date().getFullYear();
    const recentFoundingYear = currentYear - 2;
    const comp = comprehension({
      disqualifiers: [
        { id: "tenure", rule: "Lead firm must have at least 5 years of operating history", triggerLanguage: "minimum 5 years operating history required" },
      ],
    });
    const md = `## Section A\n\nABC Engineering was founded in ${recentFoundingYear} as a specialist water consultancy.`;
    const r = validateConstraints(comp, md);
    assert.equal(r.violations.length, 1);
    assert.equal(r.violations[0].type, "disqualifier");
    assert.equal(r.violations[0].severity, "CRITICAL");
    assert.match(r.violations[0].suggestion, /≥5 years/);
  });

  it("does NOT flag a satisfying founding year", () => {
    const currentYear = new Date().getFullYear();
    const oldFoundingYear = currentYear - 15;
    const comp = comprehension({
      disqualifiers: [
        { id: "tenure", rule: "Lead firm must have at least 5 years of operating history", triggerLanguage: "minimum 5 years" },
      ],
    });
    const md = `## Section A\n\nFounded in ${oldFoundingYear}.`;
    const r = validateConstraints(comp, md);
    assert.equal(r.violations.length, 0);
    // No pattern matches; rule defers to critic
    assert.equal(r.deferredToCritic.length, 1);
  });

  it("defers non-numeric disqualifiers to the critic", () => {
    const comp = comprehension({
      disqualifiers: [
        { id: "iso", rule: "ISO 9001 certification required", triggerLanguage: "without ISO 9001 will be rejected" },
      ],
    });
    const r = validateConstraints(comp, "## A\n\nWe are a leading firm.");
    assert.equal(r.violations.length, 0);
    assert.equal(r.deferredToCritic.length, 1);
  });
});

describe("formatConstraintsForCritique", () => {
  it("renders a checklist of every prohibition and disqualifier", () => {
    const comp = comprehension({
      prohibitions: ["No joint ventures permitted", "No subcontracting"],
      disqualifiers: [
        { id: "iso", rule: "ISO 9001 required", triggerLanguage: "" },
        { id: "tenure", rule: "5+ years operating history", triggerLanguage: "" },
      ],
    });
    const text = formatConstraintsForCritique(comp);
    assert.match(text, /CONSTRAINT VERIFICATION CHECKLIST/);
    assert.match(text, /Prohibitions/);
    assert.match(text, /P1\. No joint ventures permitted/);
    assert.match(text, /P2\. No subcontracting/);
    assert.match(text, /Disqualifying conditions/);
    assert.match(text, /D1\. ISO 9001 required/);
    assert.match(text, /D2\. 5\+ years operating history/);
  });

  it("returns empty string when no rules exist", () => {
    assert.equal(formatConstraintsForCritique(comprehension()), "");
    assert.equal(formatConstraintsForCritique(null), "");
  });
});

describe("formatViolationsForCritique", () => {
  it("renders detected violations as a numbered list with severity, evidence, and suggested fix", () => {
    const text = formatViolationsForCritique({
      violations: [
        {
          type: "prohibition",
          rule: "No JV",
          evidence: "joint venture with ABC Partners",
          location: "Section A",
          severity: "CRITICAL",
          suggestion: "Remove all JV mentions",
        },
      ],
      cleared: [],
      deferredToCritic: [],
    });
    assert.match(text, /CONSTRAINT VIOLATIONS DETECTED/);
    assert.match(text, /V1\. \[CRITICAL\] PROHIBITION: No JV \[in: Section A\]/);
    assert.match(text, /Evidence: "…joint venture with ABC Partners…"/);
    assert.match(text, /Fix: Remove all JV mentions/);
  });

  it("returns empty string when no violations", () => {
    const text = formatViolationsForCritique({ violations: [], cleared: ["x"], deferredToCritic: ["y"] });
    assert.equal(text, "");
  });
});

describe("violationsAsWeakAxes", () => {
  it("returns distinct axes per violation type", () => {
    const axes = violationsAsWeakAxes({
      violations: [
        { type: "prohibition", rule: "x", evidence: "", location: null, severity: "CRITICAL", suggestion: "" },
        { type: "prohibition", rule: "y", evidence: "", location: null, severity: "CRITICAL", suggestion: "" },
        { type: "disqualifier", rule: "z", evidence: "", location: null, severity: "CRITICAL", suggestion: "" },
      ],
      cleared: [],
      deferredToCritic: [],
    });
    assert.deepEqual(axes.sort(), ["constraintDisqualifier", "constraintProhibition"]);
  });

  it("returns empty when no violations", () => {
    assert.deepEqual(violationsAsWeakAxes({ violations: [], cleared: [], deferredToCritic: [] }), []);
  });
});
