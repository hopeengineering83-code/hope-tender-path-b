// Regression tests for quality gap fixes from phase 6.
//
// Phase 6 addresses:
//   bid-compliance-mapping.ts: TenderRequirementLite lacked sourcePageNumber,
//   so the E.1 compliance mapping table had no "Source Page" column.
//   Evaluators and bid teams could not trace requirements back to the
//   original tender document pages — breaking source traceability.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { buildBidComplianceMapping } from "../lib/engine/bid-compliance-mapping";

describe("buildBidComplianceMapping — source page citations", () => {
  it("includes a Source Page column header", () => {
    const result = buildBidComplianceMapping({
      requirements: [
        { title: "Firm Registration Certificate", priority: "MANDATORY", requirementType: "DOCUMENT", sourcePageNumber: 12 },
      ],
    });
    assert.ok(result !== null, "mapping must not be null");
    assert.ok(result!.includes("Source Page"), "table header must include 'Source Page'");
  });

  it("renders p.N citation when sourcePageNumber is present", () => {
    const result = buildBidComplianceMapping({
      requirements: [
        { title: "Audited Financial Statements", priority: "MANDATORY", requirementType: "DOCUMENT", sourcePageNumber: 7 },
      ],
    });
    assert.ok(result !== null);
    assert.ok(result!.includes("p.7"), "row must contain p.7 page citation");
  });

  it("renders — when sourcePageNumber is null", () => {
    const result = buildBidComplianceMapping({
      requirements: [
        { title: "Company Profile", priority: "HIGH", requirementType: "DOCUMENT", sourcePageNumber: null },
      ],
    });
    assert.ok(result !== null);
    // The dash placeholder must appear in the source-page column position
    // (between the requirement text cell and the Addressed In cell).
    assert.ok(result!.includes("| — |") || result!.includes("|—|") || result!.match(/\|\s*—\s*\|/), "null sourcePageNumber must render as — in the table");
  });

  it("renders — when sourcePageNumber is undefined", () => {
    const result = buildBidComplianceMapping({
      requirements: [
        { title: "Key Personnel CVs", priority: "HIGH", requirementType: "EXPERT" },
      ],
    });
    assert.ok(result !== null);
    assert.ok(result!.match(/\|\s*—\s*\|/), "missing sourcePageNumber must render as — in the table");
  });

  it("table has 5 columns (Priority | Type | Requirement | Source Page | Addressed In)", () => {
    const result = buildBidComplianceMapping({
      requirements: [
        { title: "Technical Methodology", priority: "MANDATORY", requirementType: "METHODOLOGY", sourcePageNumber: 15 },
      ],
    });
    assert.ok(result !== null);
    // The header row must have exactly 5 pipe-delimited columns
    const headerLine = result!.split("\n").find((l) => l.includes("Priority"));
    assert.ok(headerLine, "header line must exist");
    const columnCount = (headerLine!.match(/\|/g) ?? []).length - 1;
    assert.equal(columnCount, 5, `expected 5 columns, got ${columnCount}`);
  });

  it("returns null when requirements is empty", () => {
    const result = buildBidComplianceMapping({ requirements: [] });
    assert.equal(result, null);
  });

  it("returns null when all requirements have empty titles", () => {
    const result = buildBidComplianceMapping({
      requirements: [
        { title: "", priority: "MANDATORY", requirementType: "DOCUMENT", sourcePageNumber: 3 },
        { title: null, priority: "HIGH", requirementType: "EXPERT", sourcePageNumber: null },
      ],
    });
    assert.equal(result, null);
  });
});
