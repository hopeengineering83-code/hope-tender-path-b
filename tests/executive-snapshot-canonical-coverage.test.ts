// Regression test for the ExecutiveSnapshot evidence-coverage migration.
//
// The dashboard's "Evidence coverage" metric used to count any matrix
// row with supportLevel SUPPORTED / EVIDENCE_PENDING_REVIEW / PARTIAL
// — a lenient view that made coverage look healthier than it actually
// was. The snapshot now computes "strong" coverage from FULL /
// SUBSTANTIAL links and delegates final GO/REVIEW/NO_GO authority to the
// canonical final-package readiness model.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { computeEvidenceCoverage } from "../lib/engine/requirement-evidence-profile";

function snapshotShape(reqs: Array<{ id: string; rows?: Array<{ id: string; supportLevel: string }> }>) {
  return reqs.map((requirement) => ({
    id: requirement.id,
    title: `r-${requirement.id}`,
    description: "",
    requirementType: "TECHNICAL",
    priority: "MANDATORY",
    complianceMatrixRows: requirement.rows ?? [],
  }));
}

describe("canonical evidence coverage (lib/engine/requirement-evidence-profile)", () => {
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

// app/dashboard/tenders/[id]/executive-snapshot.tsx was removed entirely —
// it was a fourth independent GO/REVIEW/NO_GO verdict on the tender detail
// page (built on the canonical-tender-readiness.ts engine), now superseded
// by the canonical Tender Release State's verdict. The property this test
// protected — never trust the stale scalar tender.readinessScore column —
// still holds structurally in the replacement: lib/engine/tender-release-state.ts's
// readinessScore is derived exclusively from the gated evaluateBidDecision()
// result and never reads the tender.readinessScore column.
describe("canonical Tender Release State never reads the stale tender.readinessScore column", () => {
  it("readinessScore is derived from the gated bid-decision result, not a scalar column", () => {
    const source = readFileSync("lib/engine/tender-release-state.ts", "utf8");
    assert.match(source, /readinessScore = decision\.score/);
    assert.doesNotMatch(source, /tender\.readinessScore/);
  });
});
