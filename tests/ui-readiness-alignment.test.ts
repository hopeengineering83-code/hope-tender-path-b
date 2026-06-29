import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("UI Contradiction Alignment Audit", () => {
  it("ExecutiveSnapshot decision logic incorporates canonical export readiness", () => {
    const source = readFileSync(resolve(process.cwd(), "app/dashboard/tenders/[id]/executive-snapshot.tsx"), "utf8");
    assert.match(source, /canonicalReadiness\.modules\.export\.state === "READY"/);
  });

  it("ExecutiveSnapshot SnapshotConsistencyBadge is wired to local decision verdict", () => {
    const source = readFileSync(resolve(process.cwd(), "app/dashboard/tenders/[id]/executive-snapshot.tsx"), "utf8");
    assert.match(source, /SnapshotConsistencyBadge tenderId={tender\.id} verdict="export" localEligible={decision === "GO"}/);
  });

  it("TenderHealthScorePanel dimensions display canonical status icons", () => {
    const source = readFileSync(resolve(process.cwd(), "components/tender-health-score-panel.tsx"), "utf8");
    assert.match(source, /<CanonicalStatusIcon status={canonicalReadiness\.modules\[DIMENSION_MODULE\[d\.label\]\]\.state} \/>/);
  });

  it("TenderHealthScorePanel dimension labels are driven by canonical readiness", () => {
    const source = readFileSync(resolve(process.cwd(), "components/tender-health-score-panel.tsx"), "utf8");
    // Check Metadata dimension
    assert.match(source, /const metaStatusLabel: Dimension\["status"\] = \(\(canonicalReadiness\?\.modules\.metadata\.state === "READY"\) \? "PASS" : \(canonicalReadiness\?\.modules\.metadata\.state === "BLOCKED" \? "FAIL" : "WARN"\)\)/);
    // Check Requirements dimension
    assert.match(source, /const reqStatusLabel: Dimension\["status"\] = \(\(canonicalReadiness\?\.modules\.requirements\.state === "READY"\) \? "PASS" : \(canonicalReadiness\?\.modules\.requirements\.state === "BLOCKED" \? "FAIL" : "WARN"\)\)/);
    // Check Submission Plan dimension
    assert.match(source, /status: \(\(canonicalReadiness\?\.modules\.submissionPlan\.state === "READY"\) \? "PASS" : \(canonicalReadiness\?\.modules\.submissionPlan\.state === "BLOCKED" \? "FAIL" : "WARN"\)\)/);
    // Check Documents dimension
    assert.match(source, /const docStatusLabel: Dimension\["status"\] = \(\(canonicalReadiness\?\.modules\.documents\.state === "READY"\) \? "PASS" : \(canonicalReadiness\?\.modules\.documents\.state === "BLOCKED" \? "FAIL" : "WARN"\)\)/);
  });

  it("GenerationActionPanel is driven by canonical generation state", () => {
    const source = readFileSync(resolve(process.cwd(), "components/generation-action-panel.tsx"), "utf8");
    assert.match(source, /const canonicalGenerationState: CanonicalModuleStatus = canonicalReadiness\?.modules\.generation\.state/);
    assert.match(source, /<CanonicalStatusBadge status={canonicalGenerationState}/);
  });

  it("RequirementCoveragePanel displays canonical status icon", () => {
    const source = readFileSync(resolve(process.cwd(), "components/requirement-coverage-panel.tsx"), "utf8");
    assert.match(source, /<CanonicalStatusIcon status={canonicalReadiness\.modules\.requirements\.state} \/>/);
  });

  it("AnalysisQualityPanel displays canonical status icon", () => {
    const source = readFileSync(resolve(process.cwd(), "components/analysis-quality-panel.tsx"), "utf8");
    assert.match(source, /<CanonicalStatusIcon status={canonicalReadiness\.modules\.analysis\.state} \/>/);
  });

  it("MatchingQualityPanel displays canonical status icon", () => {
    const source = readFileSync(resolve(process.cwd(), "components/matching-quality-panel.tsx"), "utf8");
    assert.match(source, /<CanonicalStatusIcon status={canonicalReadiness\.modules\.matching\.state} \/>/);
  });

  it("ExtractionQualityPanel displays canonical status icon", () => {
    const source = readFileSync(resolve(process.cwd(), "components/extraction-quality-panel.tsx"), "utf8");
    assert.match(source, /<CanonicalStatusIcon status={canonicalReadiness\.modules\.extraction\.state} \/>/);
  });
});
