import assert from "node:assert/strict";
import test from "node:test";
import { parseTenderDocumentIntelligence } from "../lib/engine/source-driven-tender-text-parser";
import { buildCanonicalAnalysisTenderUpdate } from "../lib/engine/canonical-analysis-update";

test("source parser preserves qualitative selection criteria without weights", () => {
  const parsed = parseTenderDocumentIntelligence(`
REQUEST FOR EXPRESSIONS OF INTEREST
SELECTION CRITERIA
- Comparable assignment experience
- Qualifications of key personnel
- Quality of the proposed methodology
No numerical weights are published.
  `);
  assert.ok(parsed.evaluationMethodology);
  assert.equal(parsed.evaluationMethodology.technicalWeight, null);
  assert.equal(parsed.evaluationMethodology.financialWeight, null);
  assert.match(parsed.evaluationMethodology.methodology ?? "", /Comparable assignment experience/i);
});

test("source parser preserves structurally different award factors without weights", () => {
  const parsed = parseTenderDocumentIntelligence(`
INVITATION FOR CONSULTANCY SERVICES
AWARD CRITERIA
1. Technical Approach and Work Plan
2. Past Performance on Similar Assignments
3. Key Personnel
  `);
  assert.ok(parsed.evaluationMethodology);
  assert.match(parsed.evaluationMethodology.methodology ?? "", /Past Performance/i);
});

test("canonical AI promotion derives methodology from sourced criteria when narrative is absent", () => {
  const result = buildCanonicalAnalysisTenderUpdate({
    summary: "Source-grounded analysis summary",
    evaluationMethodology: "",
    evaluationCriteriaSource: [
      { criterion: "Relevant project experience", weight: null, sourcePage: 5, sourceQuote: "Relevant project experience" },
      { criterion: "Technical methodology", weight: 40, sourcePage: 5, sourceQuote: "Technical methodology — 40%" },
    ],
    requirements: [], exactFileNaming: [], exactFileOrder: [], submissionNotes: "",
  } as never, {});
  assert.equal(result.data.evaluationMethodology, "Relevant project experience — weight not stated\nTechnical methodology — 40%");
});
