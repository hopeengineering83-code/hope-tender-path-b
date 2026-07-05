// Regression tests for quality gap fixes from phase 11.
//
// Phase 11 addresses:
//   evaluator-mirror-builder.ts: buildEvaluatorMirrorSection returned null
//   when evaluationCriteria was empty, even when requirements were present.
//   Tenders that embed criteria implicitly in requirements (the common case)
//   would silently produce no Section F at all.
//   Fix: synthesise plausible criteria from the requirements array when
//   evaluationCriteria is empty.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  buildEvaluatorMirrorSection,
  hasEvaluatorMirrorHeading,
} from "../lib/engine/evaluator-mirror-builder";

describe("buildEvaluatorMirrorSection — synthesised criteria from requirements", () => {
  it("returns non-null when evaluationCriteria is empty but requirements are present", () => {
    const result = buildEvaluatorMirrorSection({
      evaluationCriteria: [],
      evaluationWeights: [],
      primarySector: "Infrastructure",
      requirements: [
        { title: "CV of Lead Expert", requirementType: "EXPERT", priority: "MANDATORY" },
        { title: "Methodology and Work Plan", requirementType: "METHODOLOGY", priority: "MANDATORY" },
      ],
    });
    assert.ok(result !== null, "should produce Section F when criteria can be synthesised from requirements");
  });

  it("synthesised output contains a Section F heading", () => {
    const result = buildEvaluatorMirrorSection({
      evaluationCriteria: [],
      evaluationWeights: [],
      primarySector: "Water",
      requirements: [
        { title: "Project Experience in Water Sector", requirementType: "PROJECT_EXPERIENCE", priority: "SCORED" },
      ],
    });
    assert.ok(result !== null);
    assert.ok(hasEvaluatorMirrorHeading(result!), "output must contain a Section F / Evaluation Criteria Response Mirror heading");
  });

  it("synthesised output contains a markdown table with at least one row", () => {
    const result = buildEvaluatorMirrorSection({
      evaluationCriteria: [],
      evaluationWeights: [],
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
    const result = buildEvaluatorMirrorSection({
      evaluationCriteria: [],
      evaluationWeights: [],
      primarySector: "General",
      requirements: [],
    });
    assert.strictEqual(result, null);
  });

  it("does not synthesise criteria when evaluationCriteria is already populated", () => {
    const result = buildEvaluatorMirrorSection({
      evaluationCriteria: ["Technical approach and methodology"],
      evaluationWeights: [],
      primarySector: "Transport",
      requirements: [
        { title: "CV of Lead Expert", requirementType: "EXPERT", priority: "MANDATORY" },
      ],
    });
    assert.ok(result !== null);
    // Should contain the explicit criterion, not a synthesised one
    assert.ok(result!.includes("Technical approach and methodology"), "explicit criterion should appear");
  });

  it("synthesised criteria include sector name for specificity", () => {
    const result = buildEvaluatorMirrorSection({
      evaluationCriteria: [],
      evaluationWeights: [],
      primarySector: "Education",
      requirements: [
        { title: "Key Expert CVs", requirementType: "EXPERT", priority: "MANDATORY" },
      ],
    });
    assert.ok(result !== null);
    assert.ok(result!.includes("Education"), "synthesised criteria should reference the primary sector");
  });
});
