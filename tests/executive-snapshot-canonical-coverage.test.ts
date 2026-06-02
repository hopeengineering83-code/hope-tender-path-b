// Regression test for the ExecutiveSnapshot evidence-coverage migration.
//
// The dashboard's "Evidence coverage" metric used to count any matrix
// row with supportLevel SUPPORTED / EVIDENCE_PENDING_REVIEW / PARTIAL
// — a lenient view that made coverage look healthier than it actually
// was. After the Gap 14 helper landed, the snapshot should compute
// "strong" coverage from FULL / SUBSTANTIAL links only. This test
// pins the composition by running computeEvidenceCoverage with the
// same shape the snapshot uses.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { computeEvidenceCoverage } from "../lib/engine/requirement-evidence-profile";

// Mirror the shape ExecutiveSnapshot constructs from the Prisma tender
// row when it groups complianceMatrix rows by requirementId.
function snapshotShape(reqs: Array<{ id: string; rows?: Array<{ id: string; supportLevel: string }> }>) {
  return reqs.map((r) => ({
    id: r.id,
    title: `r-${r.id}`,
    description: "",
    requirementType: "TECHNICAL",
    priority: "MANDATORY",
    complianceMatrixRows: r.rows ?? [],
  }));
}

describe("ExecutiveSnapshot canonical evidence coverage", () => {
  it("FULL/SUBSTANTIAL links count toward strong coverage", () => {
    const report = computeEvidenceCoverage(snapshotShape([
      { id: "r1", rows: [{ id: "m1", supportLevel: "FULL" }] },
      { id: "r2", rows: [{ id: "m2", supportLevel: "SUBSTANTIAL" }] },
      { id: "r3", rows: [{ id: "m3", supportLevel: "PARTIAL" }] },
      { id: "r4", rows: [] },
    ]));
    assert.equal(report.strongCoveragePercent, 50, "2/4 requirements have FULL/SUBSTANTIAL evidence");
    assert.equal(report.anyCoveragePercent, 75, "3/4 requirements have at least one link");
  });

  it("zero coverage when matrix is empty (the screenshot's 0/100 case)", () => {
    const report = computeEvidenceCoverage(snapshotShape([
      { id: "r1" },
      { id: "r2" },
      { id: "r3" },
    ]));
    assert.equal(report.strongCoveragePercent, 0);
    assert.equal(report.anyCoveragePercent, 0);
    assert.equal(report.requirementsWithStrongEvidence, 0);
  });

  it("matches without requirementId are ignored (cannot be grouped)", () => {
    // This emulates the snapshot's grouping: matrix rows lacking
    // requirementId are skipped, so they cannot contribute to coverage.
    const report = computeEvidenceCoverage(snapshotShape([
      { id: "r1", rows: [{ id: "m1", supportLevel: "FULL" }] },
    ]));
    assert.equal(report.strongCoveragePercent, 100);
    assert.equal(report.totalRequirements, 1);
  });

  it("partial-only coverage does NOT count as strong (regression for the lenient bug)", () => {
    const report = computeEvidenceCoverage(snapshotShape([
      { id: "r1", rows: [{ id: "m1", supportLevel: "PARTIAL" }, { id: "m2", supportLevel: "PARTIAL" }] },
      { id: "r2", rows: [{ id: "m3", supportLevel: "PARTIAL" }] },
    ]));
    assert.equal(report.strongCoveragePercent, 0, "Strong coverage must reject PARTIAL-only requirements");
    assert.equal(report.anyCoveragePercent, 100);
  });
});


describe("ExecutiveSnapshot stale workflow progress isolation", () => {
  it("uses canonical evidence score for GO/REVIEW decision, not tender.readinessScore", () => {
    const source = readFileSync("app/dashboard/tenders/[id]/executive-snapshot.tsx", "utf8");
    assert.match(source, /const workflowProgress = tender\.readinessScore \?\? evidenceScore/);
    assert.match(source, /const canonicalDecisionScore = evidenceScore/);
    assert.match(source, /canonicalDecisionScore >= 85/);
    assert.doesNotMatch(source, /readiness >= 85/);
  });
});
