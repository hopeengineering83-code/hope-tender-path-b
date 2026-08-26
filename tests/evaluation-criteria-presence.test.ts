import assert from "node:assert/strict";
import test from "node:test";
import { hasSourceEvaluationCriteria } from "../lib/engine/evaluation-criteria-presence";

test("preserves qualitative evaluation criteria when weights are absent", () => {
  assert.equal(hasSourceEvaluationCriteria({
    files: [{ extractedText: `SELECTION CRITERIA\n- Comparable assignment experience\n- Proposed methodology\n- Qualifications of key personnel\nWeights are not published.` }],
  }), true);
});

test("recognises structurally different award factors without percentages", () => {
  assert.equal(hasSourceEvaluationCriteria({
    files: [{ extractedText: `4. AWARD FACTORS\na) Technical merit and responsiveness\nb) Delivery capacity\nc) Quality assurance approach` }],
  }), true);
});

test("does not turn an explicit absence statement into extracted criteria", () => {
  assert.equal(hasSourceEvaluationCriteria({
    files: [{ extractedText: "Evaluation criteria were not provided in the source package." }],
  }), false);
});

test("accepts source-grounded structured criteria with null weights", () => {
  assert.equal(hasSourceEvaluationCriteria({
    evaluationCriteriaSourceJson: JSON.stringify([
      { criterion: "Relevant project experience", weight: null, sourcePage: 5 },
    ]),
  }), true);
});
