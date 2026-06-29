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
    assert.match(source, /status: extState === "READY" \? "PASS" : extState === "BLOCKED" \? "FAIL" : "WARN"/);
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

  it("MetadataCompletionPanel displays canonical status icon", () => {
    const source = readFileSync(resolve(process.cwd(), "components/metadata-completion-panel.tsx"), "utf8");
    assert.match(source, /<CanonicalStatusIcon status={canonicalReadiness\.modules\.metadata\.state} \/>/);
  });

  it("MetadataTruthPanel displays canonical status icon", () => {
    const source = readFileSync(resolve(process.cwd(), "components/metadata-truth-panel.tsx"), "utf8");
    assert.match(source, /<CanonicalStatusIcon status={canonicalReadiness\.modules\.metadata\.state} \/>/);
  });

  it("SubmissionPlanReconciliationPanel displays canonical status icon", () => {
    const source = readFileSync(resolve(process.cwd(), "components/submission-plan-reconciliation-panel.tsx"), "utf8");
    assert.match(source, /<CanonicalStatusIcon status={canonicalReadiness\.modules\.submissionPlan\.state} \/>/);
  });

  it("ExportReadinessPanel displays canonical status icon", () => {
    const source = readFileSync(resolve(process.cwd(), "components/export-readiness-panel.tsx"), "utf8");
    assert.match(source, /<CanonicalStatusIcon status={canonicalReadiness\.modules\.export\.state} \/>/);
  });
});
