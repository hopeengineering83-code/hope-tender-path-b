// Structural tests for the tender workflow interlinking fix.
//
// These are STRUCTURAL source-string tests: they read source files and assert
// on code structure (imports, JSX elements, string patterns). They do NOT
// execute routes, handlers, or HTTP paths.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("[INTERLINK] Shared workflow state module exists", () => {
  it("lib/ui/tender-workflow-sync.tsx exists and exports WorkflowStateProvider + useWorkflowState", () => {
    const src = readFileSync(resolve("lib/ui/tender-workflow-sync.tsx"), "utf8");
    assert.ok(src.includes("WorkflowStateProvider"), "must export WorkflowStateProvider");
    assert.ok(src.includes("useWorkflowState"), "must export useWorkflowState hook");
    assert.ok(src.includes("WorkflowStateContext"), "must create a context");
    assert.ok(src.includes("export-readiness"), "must fetch from /api/tenders/[id]/export-readiness");
    assert.ok(src.includes("setInterval"), "must auto-refresh on interval");
  });

  it("exports helper functions for blocker code lookup", () => {
    const src = readFileSync(resolve("lib/ui/tender-workflow-sync.tsx"), "utf8");
    assert.ok(src.includes("getPrimaryBlockerCode"), "must export getPrimaryBlockerCode");
    assert.ok(src.includes("getPrimaryNextAction"), "must export getPrimaryNextAction");
    assert.ok(src.includes("hasBlocker"), "must export hasBlocker");
  });
});

describe("[INTERLINK] Client wrapper component exists", () => {
  it("components/tender-workflow-state-wrapper.tsx wraps children in WorkflowStateProvider", () => {
    const src = readFileSync(resolve("components/tender-workflow-state-wrapper.tsx"), "utf8");
    assert.ok(src.includes("WorkflowStateProvider"), "must import WorkflowStateProvider");
    assert.ok(src.includes("tenderId"), "must accept tenderId prop");
    assert.ok(src.includes('"use client"'), "must be a client component");
  });
});

describe("[INTERLINK] Tender detail page wraps panels in shared state provider", () => {
  it("page imports and uses TenderWorkflowStateWrapper", () => {
    const src = readFileSync(resolve("app/dashboard/tenders/[id]/page.tsx"), "utf8");
    assert.ok(
      src.includes("TenderWorkflowStateWrapper"),
      "page must import TenderWorkflowStateWrapper",
    );
    assert.ok(
      src.includes("<TenderWorkflowStateWrapper"),
      "page must render <TenderWorkflowStateWrapper> in JSX",
    );
    assert.ok(
      src.includes("</TenderWorkflowStateWrapper>"),
      "page must close </TenderWorkflowStateWrapper>",
    );
  });

  it("all 5 workflow stages have anchor IDs for cross-panel navigation", () => {
    const src = readFileSync(resolve("app/dashboard/tenders/[id]/page.tsx"), "utf8");
    assert.ok(src.includes('id="stage-1"'), "Stage 1 must have id=stage-1");
    assert.ok(src.includes('id="stage-2"'), "Stage 2 must have id=stage-2");
    assert.ok(src.includes('id="stage-3"'), "Stage 3 must have id=stage-3");
    assert.ok(src.includes('id="stage-4"'), "Stage 4 must have id=stage-4");
    assert.ok(src.includes('id="stage-5"'), "Stage 5 must have id=stage-5");
  });

  it("cross-panel navigation nav links to all 5 stages", () => {
    const src = readFileSync(resolve("app/dashboard/tenders/[id]/page.tsx"), "utf8");
    assert.ok(src.includes('href="#stage-1"'), "nav must link to #stage-1");
    assert.ok(src.includes('href="#stage-2"'), "nav must link to #stage-2");
    assert.ok(src.includes('href="#stage-3"'), "nav must link to #stage-3");
    assert.ok(src.includes('href="#stage-4"'), "nav must link to #stage-4");
    assert.ok(src.includes('href="#stage-5"'), "nav must link to #stage-5");
  });
});

describe("[INTERLINK] All panels are present in the tender detail page", () => {
  it("all key panels are rendered", () => {
    const src = readFileSync(resolve("app/dashboard/tenders/[id]/page.tsx"), "utf8");
    const panels = [
      "TenderWorkflowActionCenter",
      "TenderRecoveryCommandCenter",
      "CanonicalReadinessScoreWidget",
      "TenderHealthScorePanel",
      "BidControlVerdictPanel",
      "FinalSubmissionControlCenter",
      "TenderSourceFilesPanel",
      "ExtractionQualityDashboard",
      "AIAnalyzePanel",
      "EngineActionPanel",
      "MatchingQualityPanel",
      "EvidenceCoveragePanel",
      "GenerationReadinessPanel",
      "GenerationActionPanel",
      "SubmissionPlanTruthPanel",
      "AuthorityReviewPanel",
      "ExportReadinessPanel",
      "FinalPackageManifestPanel",
      "TenderDownloadActionsPanel",
    ];
    for (const panel of panels) {
      assert.ok(src.includes(panel), `page must render ${panel}`);
    }
  });
});

describe("[INTERLINK] Client-side panels consume shared workflow state", () => {
  it("tender-workflow-action-center imports and uses useWorkflowState", () => {
    const src = readFileSync(resolve("components/tender-workflow-action-center.tsx"), "utf8");
    assert.ok(src.includes("useWorkflowState"), "must import useWorkflowState");
    assert.ok(src.includes("sharedState"), "must consume sharedState");
  });

  it("tender-recovery-command-center imports and uses useWorkflowState", () => {
    const src = readFileSync(resolve("components/tender-recovery-command-center.tsx"), "utf8");
    assert.ok(src.includes("useWorkflowState"), "must import useWorkflowState");
    assert.ok(src.includes("sharedState"), "must consume sharedState");
  });

  it("final-submission-control-center imports and uses useWorkflowState", () => {
    const src = readFileSync(resolve("components/final-submission-control-center.tsx"), "utf8");
    assert.ok(src.includes("useWorkflowState"), "must import useWorkflowState");
    assert.ok(src.includes("sharedState"), "must consume sharedState");
  });

  it("export-readiness-panel imports and uses useWorkflowState", () => {
    const src = readFileSync(resolve("components/export-readiness-panel.tsx"), "utf8");
    assert.ok(src.includes("useWorkflowState"), "must import useWorkflowState");
    assert.ok(src.includes("sharedState"), "must consume sharedState");
  });

  it("canonical-readiness-score-widget imports and uses useWorkflowState", () => {
    const src = readFileSync(resolve("components/canonical-readiness-score-widget.tsx"), "utf8");
    assert.ok(src.includes("useWorkflowState"), "must import useWorkflowState");
    assert.ok(src.includes("sharedState"), "must consume sharedState");
  });
});
