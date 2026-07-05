// Regression tests for quality gap fixes from phase 13.
//
// Phase 13 addresses:
//   self-score-builder.ts: buildSelfScoreSection returned null when
//   evaluationCriteria was empty, even when requirements were present.
//   Section H (Proposal Self-Score) was silently absent on tenders that
//   embed scoring criteria implicitly in requirements, scoring 0/10 on
//   the selfScorePresence quality axis.
//   Fix: synthesise plausible criteria from the requirements array when
//   evaluationCriteria is empty, mirroring the same fallback logic in
//   evaluator-mirror-builder.ts (phase 11).

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  buildSelfScoreSection,
  hasSelfScoreHeading,
} from "../lib/engine/self-score-builder";

describe("buildSelfScoreSection — synthesised criteria from requirements", () => {
  it("returns non-null when evaluationCriteria is empty but requirements are present", () => {
    const result = buildSelfScoreSection({
      evaluationCriteria: [],
      evaluationWeights: [],
      topProjects: [],
      topExperts: [],
      hasComplianceMatrix: false,
      hasEvaluatorMirror: false,
      hasWinThemes: false,
      primarySector: "Infrastructure",
      requirements: [
        { title: "CV of Lead Expert", requirementType: "EXPERT", priority: "MANDATORY" },
        { title: "Technical Methodology", requirementType: "METHODOLOGY", priority: "MANDATORY" },
      ],
    });
    assert.ok(result !== null, "should produce Section H when criteria can be synthesised from requirements");
  });

  it("synthesised output contains a Section H heading", () => {
    const result = buildSelfScoreSection({
      evaluationCriteria: [],
      evaluationWeights: [],
      topProjects: [],
      topExperts: [],
      hasComplianceMatrix: false,
      hasEvaluatorMirror: false,
      hasWinThemes: false,
      primarySector: "Water",
      requirements: [
        { title: "Project Experience in Water Sector", requirementType: "PROJECT_EXPERIENCE", priority: "SCORED" },
      ],
    });
    assert.ok(result !== null);
    assert.ok(hasSelfScoreHeading(result!), "output must contain a Section H / Self-Score heading");
  });

  it("synthesised output contains a score table with at least one data row", () => {
    const result = buildSelfScoreSection({
      evaluationCriteria: [],
      evaluationWeights: [],
      topProjects: [],
      topExperts: [],
      hasComplianceMatrix: false,
      hasEvaluatorMirror: false,
      hasWinThemes: false,
      primarySector: "Health",
      requirements: [
        { title: "CVs of Proposed Experts", requirementType: "EXPERT", priority: "MANDATORY" },
        { title: "Risk Management Plan", requirementType: "METHODOLOGY", priority: "SCORED" },
      ],
    });
    assert.ok(result !== null);
    const rows = result!.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Evaluation Criterion") && !l.startsWith("|---"));
    assert.ok(rows.length >= 1, `expected at least one data row, got ${rows.length}`);
  });

  it("returns null when both evaluationCriteria and requirements are empty", () => {
    const result = buildSelfScoreSection({
      evaluationCriteria: [],
      evaluationWeights: [],
      topProjects: [],
      topExperts: [],
      hasComplianceMatrix: false,
      hasEvaluatorMirror: false,
      hasWinThemes: false,
      primarySector: "General",
      requirements: [],
    });
    assert.strictEqual(result, null);
  });

  it("does not synthesise when evaluationCriteria is already populated", () => {
    const result = buildSelfScoreSection({
      evaluationCriteria: ["Technical approach and methodology"],
      evaluationWeights: [],
      topProjects: [],
      topExperts: [],
      hasComplianceMatrix: false,
      hasEvaluatorMirror: false,
      hasWinThemes: false,
      primarySector: "Transport",
      requirements: [
        { title: "CV of Lead Expert", requirementType: "EXPERT", priority: "MANDATORY" },
      ],
    });
    assert.ok(result !== null);
    assert.ok(result!.includes("Technical approach and methodology"), "explicit criterion should appear");
  });

  it("synthesised output contains predicted overall score line", () => {
    const result = buildSelfScoreSection({
      evaluationCriteria: [],
      evaluationWeights: [],
      topProjects: [{ name: "Addis Ring Road Phase 2", contractValue: 120_000_000, currency: "ETB" }],
      topExperts: [{ fullName: "Dawit Tesfaye" }],
      hasComplianceMatrix: true,
      hasEvaluatorMirror: true,
      hasWinThemes: true,
      primarySector: "Road",
      requirements: [
        { title: "Methodology and Work Plan", requirementType: "METHODOLOGY", priority: "MANDATORY" },
        { title: "Key Expert CVs", requirementType: "EXPERT", priority: "MANDATORY" },
      ],
    });
    assert.ok(result !== null);
    assert.ok(/Predicted overall technical score/i.test(result!), "output must include a predicted overall score");
  });
});
