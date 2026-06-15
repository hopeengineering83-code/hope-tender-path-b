// Regression tests for quality gap fixes from phase 8.
//
// Phase 8 addresses:
//   compliance-matrix-builder.ts: RequirementLite lacked sourcePageNumber,
//   so the Section E Compliance Matrix rows had no source page traceability.
//   Evaluators and bid teams could not verify requirements against the
//   original tender document — breaking source-traceability requirements.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { buildComplianceMatrixSection } from "../lib/engine/compliance/compliance-matrix-builder";

describe("buildComplianceMatrixSection — source page citations", () => {
  it("appends [p.N] to requirement text when sourcePageNumber is set", () => {
    const result = buildComplianceMatrixSection({
      requirements: [
        { id: "r1", title: "Technical Methodology", priority: "MANDATORY", requirementType: "METHODOLOGY", sourcePageNumber: 14 },
      ],
      matrixRows: [],
      gaps: [],
    });
    assert.ok(result !== null, "result must not be null");
    assert.ok(result!.includes("[p.14]"), "requirement cell must include [p.14] citation");
  });

  it("does NOT append a page citation when sourcePageNumber is null", () => {
    const result = buildComplianceMatrixSection({
      requirements: [
        { id: "r2", title: "Audited Financial Statements", priority: "MANDATORY", requirementType: "FINANCIAL", sourcePageNumber: null },
      ],
      matrixRows: [],
      gaps: [],
    });
    assert.ok(result !== null);
    assert.ok(!result!.includes("[p."), "null sourcePageNumber must not produce a [p.N] citation");
  });

  it("does NOT append a page citation when sourcePageNumber is undefined", () => {
    const result = buildComplianceMatrixSection({
      requirements: [
        { id: "r3", title: "Company Registration Certificate", priority: "MANDATORY", requirementType: "ELIGIBILITY" },
      ],
      matrixRows: [],
      gaps: [],
    });
    assert.ok(result !== null);
    assert.ok(!result!.includes("[p."), "undefined sourcePageNumber must not produce a [p.N] citation");
  });

  it("includes [p.N] inline in the requirement text cell, not as a separate column", () => {
    const result = buildComplianceMatrixSection({
      requirements: [
        { id: "r4", title: "Key Expert CVs", priority: "MANDATORY", requirementType: "EXPERT", sourcePageNumber: 8 },
      ],
      matrixRows: [],
      gaps: [],
    });
    assert.ok(result !== null);
    // [p.8] must appear before the first pipe after the requirement content
    // (i.e., embedded in the requirement cell, not as a new column)
    const rowLine = result!.split("\n").find((l) => l.includes("[p.8]"));
    assert.ok(rowLine, "a row containing [p.8] must exist");
    // The row must still have 6 pipe delimiters (6 columns, not 7)
    const pipeCount = (rowLine!.match(/\|/g) ?? []).length;
    assert.equal(pipeCount, 7, `row must have 7 pipes (6 columns + leading pipe), got ${pipeCount}: ${rowLine}`);
  });

  it("returns null when requirements array is empty", () => {
    const result = buildComplianceMatrixSection({ requirements: [], matrixRows: [], gaps: [] });
    assert.equal(result, null);
  });
});
