import assert from "node:assert/strict";
import test from "node:test";
import { hasSourceEvaluationCriteria } from "../lib/engine/evaluation-criteria-presence";

test("readiness consumes persisted qualitative criteria when weights are absent", () => {
  assert.equal(hasSourceEvaluationCriteria({
    evaluationMethodology: "Comparable assignment experience; proposed methodology; qualifications of key personnel. Weights are not published.",
  }), true);
});

test("readiness consumes structurally different persisted award factors", () => {
  assert.equal(hasSourceEvaluationCriteria({
    evaluationCriteriaSourceJson: JSON.stringify([
      { title: "Technical merit and responsiveness", weight: null },
      { title: "Delivery capacity", weight: null },
    ]),
  }), true);
});

test("readiness does not reinterpret raw source text", () => {
  assert.equal(hasSourceEvaluationCriteria({
    evaluationMethodology: null,
    evaluationCriteriaSourceJson: null,
  }), false);
});

test("accepts source-grounded structured criteria with null weights", () => {
  assert.equal(hasSourceEvaluationCriteria({
    evaluationCriteriaSourceJson: JSON.stringify([
      { criterion: "Relevant project experience", weight: null, sourcePage: 5 },
    ]),
  }), true);
});
