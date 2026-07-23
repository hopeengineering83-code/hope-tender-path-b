// I — Weak-match classifier + feed into Controls Ledger suggestions.
//
// Production screenshot: 28/28 experts with weak dimensions, 8 corrective
// actions, weak scope coverage — but 3 experts were selected. The matching
// engine produced a score per match, but downstream code treated SELECTED
// matches as fully covered regardless of how weak the score was.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classifyWeakMatches,
  isSelectedButWeak,
  matchCoverageStrength,
  WEAK_MATCH_STRONG_THRESHOLD,
  WEAK_MATCH_LOW_THRESHOLD,
  type MatchRow,
} from "../lib/engine/weak-match-classifier";
import { deriveControlSuggestions } from "../lib/engine/tender-control-suggestions";

function exp(over: Partial<MatchRow> & { score: number }): MatchRow {
  return { id: `e-${over.score}`, score: over.score, isSelected: over.isSelected ?? false, trustLevel: over.trustLevel ?? "REVIEWED", label: over.label ?? "Dr Example" };
}
function proj(over: Partial<MatchRow> & { score: number }): MatchRow {
  return { id: `p-${over.score}`, score: over.score, isSelected: over.isSelected ?? false, trustLevel: over.trustLevel ?? "REVIEWED", label: over.label ?? "Sample Project" };
}

describe("matchCoverageStrength — three-band classifier", () => {
  it("STRONG at and above 0.70", () => {
    assert.equal(matchCoverageStrength(0.70), "STRONG");
    assert.equal(matchCoverageStrength(0.95), "STRONG");
  });
  it("WEAK at 0.40 to <0.70", () => {
    assert.equal(matchCoverageStrength(0.40), "WEAK");
    assert.equal(matchCoverageStrength(0.69), "WEAK");
  });
  it("UNCOVERED below 0.40", () => {
    assert.equal(matchCoverageStrength(0.39), "UNCOVERED");
    assert.equal(matchCoverageStrength(0), "UNCOVERED");
  });
  it("thresholds are exported as constants", () => {
    assert.equal(WEAK_MATCH_STRONG_THRESHOLD, 0.70);
    assert.equal(WEAK_MATCH_LOW_THRESHOLD, 0.40);
  });
});

describe("classifyWeakMatches — Pharo-style screenshot", () => {
  it("3 selected weak experts + no strong vault → JV recommended", () => {
    const r = classifyWeakMatches({
      expertMatches: [
        exp({ score: 0.55, isSelected: true,  label: "Dr Weak A" }),
        exp({ score: 0.52, isSelected: true,  label: "Dr Weak B" }),
        exp({ score: 0.48, isSelected: true,  label: "Dr Weak C" }),
        ...Array.from({ length: 25 }, (_, i) => exp({ score: 0.30 + (i % 10) * 0.005, label: `Dr Other ${i}` })),
      ],
      projectMatches: [],
      expertRequirementsCount: 4,
      projectRequirementsCount: 0,
    });
    assert.equal(r.selectedButWeakExperts, 3);
    assert.equal(r.reviewedSelectedStrongExperts, 0);
    assert.equal(r.needsJVExperts, true, "no strong vault → JV recommended");
    assert.deepEqual(r.selectedButWeakExpertLabels, ["Dr Weak A", "Dr Weak B", "Dr Weak C"]);
  });

  it("a STRONG vault candidate exists ⇒ no JV recommendation, but weak selections still flagged", () => {
    const r = classifyWeakMatches({
      expertMatches: [
        exp({ score: 0.55, isSelected: true,  label: "Dr Selected Weak" }),
        exp({ score: 0.92, isSelected: false, label: "Dr Unselected Strong" }),
      ],
      projectMatches: [],
      expertRequirementsCount: 2,
      projectRequirementsCount: 0,
    });
    assert.equal(r.selectedButWeakExperts, 1);
    assert.equal(r.needsJVExperts, false, "vault has a strong candidate → no JV needed; the operator should swap selection");
  });

  it("only REVIEWED + strong + selected count as reviewedSelectedStrong", () => {
    const r = classifyWeakMatches({
      expertMatches: [
        exp({ score: 0.85, isSelected: true,  trustLevel: "REVIEWED" }),
        exp({ score: 0.85, isSelected: true,  trustLevel: "DRAFT" }),
        exp({ score: 0.80, isSelected: false, trustLevel: "REVIEWED" }),
      ],
      projectMatches: [],
      expertRequirementsCount: 1,
      projectRequirementsCount: 0,
    });
    assert.equal(r.reviewedSelectedStrongExperts, 1);
  });

  it("project side mirrors expert behaviour", () => {
    const r = classifyWeakMatches({
      expertMatches: [],
      projectMatches: [
        proj({ score: 0.50, isSelected: true, label: "Past Job X" }),
        proj({ score: 0.62, isSelected: true, label: "Past Job Y" }),
      ],
      expertRequirementsCount: 0,
      projectRequirementsCount: 3,
    });
    assert.equal(r.selectedButWeakProjects, 2);
    assert.equal(r.needsJVProjects, true);
    assert.deepEqual(r.selectedButWeakProjectLabels, ["Past Job X", "Past Job Y"]);
  });

  it("no expert/project requirements → no JV flag even if zero strong matches", () => {
    const r = classifyWeakMatches({
      expertMatches: [],
      projectMatches: [],
      expertRequirementsCount: 0,
      projectRequirementsCount: 0,
    });
    assert.equal(r.needsJVExperts, false);
    assert.equal(r.needsJVProjects, false);
  });

  it("isSelectedButWeak is a thin wrapper for the strong threshold", () => {
    assert.equal(isSelectedButWeak(0.55), true);
    assert.equal(isSelectedButWeak(0.70), false);
    assert.equal(isSelectedButWeak(0.95), false);
  });
});

describe("Controls-suggestion engine feeds the weak-match report", () => {
  function baseDerivationInput() {
    return {
      metadataStatus: { criticalMissing: [] },
      analysisStatus: { source: "AI_VERIFIED" },
      sourceReferenceStatus: { ungroundedMandatoryCount: 0, totalMandatoryCount: 0 },
      planStatus: { hasExplicitPlan: true, totalRequired: 5, totalMissing: 0, totalOutsidePlan: 0 },
      evidenceStatus: { totalRequirements: 5, requirementsWithLinkedEvidence: 5 },
      counts: { finalExportCandidates: 3, qualityFailedCandidates: 0, outsidePlanRows: 0 },
      providerStatus: { hasAnyProvider: true, hasCooledDownProvider: false },
      officialOriginalStatus: { required: 0, attached: 0 },
    };
  }

  it("emits WEAK_EXPERT_COVERAGE when selectedButWeakExperts > 0", () => {
    const out = deriveControlSuggestions({
      ...baseDerivationInput(),
      weakMatchReport: {
        selectedButWeakExperts: 3,
        selectedButWeakProjects: 0,
        needsJVExperts: false,
        needsJVProjects: false,
        selectedButWeakExpertLabels: ["Dr A", "Dr B"],
        selectedButWeakProjectLabels: [],
      },
    });
    const s = out.find((x) => x.code === "WEAK_EXPERT_COVERAGE");
    assert.ok(s, "must emit WEAK_EXPERT_COVERAGE");
    assert.equal(s!.severity, "HIGH");
    assert.match(s!.description, /Dr A/);
    assert.match(s!.nextAction, /Knowledge Review|JV/i);
  });

  it("emits JV_MITIGATION_NEEDED_EXPERTS when needsJVExperts is true", () => {
    const out = deriveControlSuggestions({
      ...baseDerivationInput(),
      weakMatchReport: {
        selectedButWeakExperts: 0,
        selectedButWeakProjects: 0,
        needsJVExperts: true,
        needsJVProjects: false,
        selectedButWeakExpertLabels: [],
        selectedButWeakProjectLabels: [],
      },
    });
    const s = out.find((x) => x.code === "JV_MITIGATION_NEEDED_EXPERTS");
    assert.ok(s);
    assert.equal(s!.severity, "MEDIUM");
    assert.equal(s!.type, "TASK");
  });

  it("emits WEAK_PROJECT_COVERAGE and JV_MITIGATION_NEEDED_PROJECTS on the project side", () => {
    const out = deriveControlSuggestions({
      ...baseDerivationInput(),
      weakMatchReport: {
        selectedButWeakExperts: 0,
        selectedButWeakProjects: 2,
        needsJVExperts: false,
        needsJVProjects: true,
        selectedButWeakExpertLabels: [],
        selectedButWeakProjectLabels: ["Past Job X"],
      },
    });
    const codes = out.map((s) => s.code);
    assert.ok(codes.includes("WEAK_PROJECT_COVERAGE"));
    assert.ok(codes.includes("JV_MITIGATION_NEEDED_PROJECTS"));
  });

  it("does not emit weak-match suggestions when weakMatchReport is omitted (existing callers)", () => {
    const out = deriveControlSuggestions(baseDerivationInput());
    const codes = out.map((s) => s.code);
    for (const c of ["WEAK_EXPERT_COVERAGE", "WEAK_PROJECT_COVERAGE", "JV_MITIGATION_NEEDED_EXPERTS", "JV_MITIGATION_NEEDED_PROJECTS"]) {
      assert.ok(!codes.includes(c as never), `must NOT emit ${c} when no report is provided`);
    }
  });
});

describe("Reject endpoint accepts the new I-codes", () => {
  const src = readFileSync("app/api/tenders/[id]/controls/suggestions/reject/route.ts", "utf8");
  it("KNOWN_CODES includes every new I code", () => {
    for (const code of ["WEAK_EXPERT_COVERAGE", "WEAK_PROJECT_COVERAGE", "JV_MITIGATION_NEEDED_EXPERTS", "JV_MITIGATION_NEEDED_PROJECTS"]) {
      assert.match(src, new RegExp(code));
    }
  });
});

describe("Controls route passes weakMatchReport into the derivation", () => {
  const src = readFileSync("app/api/tenders/[id]/controls/route.ts", "utf8");
  it("imports the classifier", () => {
    assert.match(src, /classifyWeakMatches/);
  });
  it("counts expert vs project requirements before classifying", () => {
    assert.match(src, /expertRequirementsCount/);
    assert.match(src, /projectRequirementsCount/);
  });
  it("passes the weakMatchReport into deriveControlSuggestions", () => {
    assert.match(src, /weakMatchReport,/);
  });
});

describe("Panel SuggestionCode union includes the I codes", () => {
  const src = readFileSync("package.json", "utf8");
  for (const code of ["WEAK_EXPERT_COVERAGE", "WEAK_PROJECT_COVERAGE", "JV_MITIGATION_NEEDED_EXPERTS", "JV_MITIGATION_NEEDED_PROJECTS"]) {
    it(`SuggestionCode union accepts ${code}`, () => {
      assert.match(src, new RegExp(`"${code}"`));
    });
  }
  it("HIGH_CONFIDENCE_CODES includes the two HIGH-severity weak-coverage codes for bulk-accept", () => {
    assert.match(src, /"WEAK_EXPERT_COVERAGE"/);
    assert.match(src, /"WEAK_PROJECT_COVERAGE"/);
  });
});
