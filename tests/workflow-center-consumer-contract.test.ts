// Locks the /api/tenders/[id]/workflow-center response contract against
// every client component that consumes it and verifies that all tender control
// centers synchronize after canonical workflow state changes.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  canonicalWorkflowFingerprint,
  workflowHasInProgressStage,
} from "../lib/ui/tender-workflow-sync";

const ROUTE_PATH = "app/api/tenders/[id]/workflow-center/route.ts";
const route = readFileSync(ROUTE_PATH, "utf8");

// The route's single success response shape.
const ALLOWED_TOP_LEVEL_KEYS = new Set([
  "ok", "snapshot", "workflow", "decision", "stages", "classification", "pageLedgers",
  // error responses
  "error",
]);

describe("workflow-center consumer contract", () => {
  it("the route still returns the expected top-level keys", () => {
    for (const key of ["ok: true", "snapshot,", "workflow,", "stages,", "classification: classificationSummary", "pageLedgers: pageLedgerSummary"]) {
      assert.ok(route.includes(key), `route response must include ${key}`);
    }
  });

  it("no component reads a top-level workflow-center key the route does not return", () => {
    const componentsDir = "components";
    const offenders: string[] = [];
    for (const file of readdirSync(componentsDir)) {
      if (!file.endsWith(".tsx") && !file.endsWith(".ts")) continue;
      // Strip line comments so historical notes about the old (broken)
      // contract don't count as reads, then only scan files that actually
      // FETCH workflow-center in live code.
      const src = readFileSync(join(componentsDir, file), "utf8")
        .split("\n")
        .map((line) => line.replace(/^\s*\/\/.*$/, ""))
        .join("\n");
      if (!/fetch\([^)]*workflow-center/.test(src)) continue;
      // Direct top-level reads in the fetch handler: json.<key>
      for (const match of src.matchAll(/\bjson\??\.([a-zA-Z]+)/g)) {
        const key = match[1];
        if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
          offenders.push(`${file}: json.${key}`);
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `components read top-level workflow-center keys the route never returns: ${offenders.join(", ")}`,
    );
  });

  it("SubmissionPlanTruthPanel consumes the dedicated route and remains synchronized", () => {
    const src = readFileSync("components/submission-plan-truth-panel.tsx", "utf8");
    assert.match(src, /fetch\(`\/api\/tenders\/\$\{tenderId\}\/submission-plan`/);
    assert.match(src, /json\.summary/);
    assert.match(src, /planState/);
    assert.match(src, /requiresUserConfirmation/);
    assert.match(src, /subscribeTenderWorkflowSync/);
    // Anchor stability: id="submission-plan" must be attached in every
    // branch (it is a NextActionPanel scroll target).
    const branchCount = (src.match(/id="submission-plan"/g) ?? []).length;
    assert.ok(branchCount >= 3, `id="submission-plan" must exist in loading, error, and loaded branches (found ${branchCount})`);
  });

  it("AuthorityReviewTruthPanel consumes the dedicated route, keeps its anchor, and synchronizes", () => {
    const src = readFileSync("components/authority-review-truth-panel.tsx", "utf8");
    assert.match(src, /fetch\(`\/api\/tenders\/\$\{tenderId\}\/authority-review`/);
    assert.match(src, /authorityReview/);
    assert.match(src, /primaryBlockerReason/);
    assert.match(src, /subscribeTenderWorkflowSync/);
    const branchCount = (src.match(/id="authority-review"/g) ?? []).length;
    assert.ok(branchCount >= 3, `id="authority-review" must exist in loading, error, and loaded branches (found ${branchCount})`);
  });

  it("RequirementTruthBanner reads canonical analysis state and synchronizes the whole page", () => {
    const src = readFileSync("components/requirement-truth-banner.tsx", "utf8");
    assert.match(src, /setStatus\(json\.snapshot\?\.analysis\?\.state \?\? null\)/);
    assert.doesNotMatch(src, /setStatus\(json\.analysis\.state\)/);
    assert.match(src, /canonicalWorkflowFingerprint/);
    assert.match(src, /emitTenderWorkflowSync/);
    assert.match(src, /workflowHasInProgressStage/);
    assert.match(src, /window\.setInterval/);
    assert.match(src, /Refresh all centers/);
    assert.match(src, /SECTION_DETECTED_REQUIREMENTS_NOT_STRUCTURED/);
  });

  it("canonical fingerprint changes only when workflow-driving facts change", () => {
    const base = {
      snapshot: {
        extraction: { activeFileCount: 1, overallOk: true },
        analysis: { state: "AI_SUCCEEDED" },
        requirements: { total: 8, groundedMandatory: 5 },
        buildPlan: { gateValid: false, gateBlocker: "Confirm plan" },
        generationEligible: false,
        generationBlockers: ["Confirm plan"],
        exportEligible: false,
        exportBlockers: ["Generation incomplete"],
      },
      decision: {
        currentBlockingStage: "BUILD_PLAN_REQUIRED",
        nextRequiredAction: "BUILD_SUBMISSION_PLAN",
        stageStates: { BUILD_SUBMISSION_PLAN: "BLOCKED" },
      },
      stages: [{ stage: 6, status: "BLOCKED", actionName: "BUILD_SUBMISSION_PLAN" }],
    };

    const first = canonicalWorkflowFingerprint(base);
    const timestampOnly = canonicalWorkflowFingerprint({ ...base, generatedAt: "ignored" } as typeof base);
    assert.equal(first, timestampOnly, "timestamp-only fields must not trigger a synchronization loop");

    const changed = canonicalWorkflowFingerprint({
      ...base,
      snapshot: { ...base.snapshot, buildPlan: { gateValid: true } },
    });
    assert.notEqual(first, changed, "a Build Plan gate transition must refresh every control center");
  });

  it("does not interrupt visibly in-progress workflow work", () => {
    assert.equal(workflowHasInProgressStage({ snapshot: { analysis: { state: "RUNNING" } } }), true);
    assert.equal(workflowHasInProgressStage({ stages: [{ stage: 3, status: "IN_PROGRESS" }] }), true);
    assert.equal(workflowHasInProgressStage({ snapshot: { analysis: { state: "AI_SUCCEEDED" } }, stages: [] }), false);
  });

  it("Workflow Control Center reports errors, subscribes to shared changes, and keeps blocked shortcuts usable", () => {
    const src = readFileSync("components/tender-workflow-action-center.tsx", "utf8");
    assert.match(src, /subscribeTenderWorkflowSync/);
    assert.match(src, /emitTenderWorkflowSync/);
    assert.match(src, /if \(!response\.ok\) throw new Error/);
    assert.match(src, /role="alert"/);
    assert.match(src, /disabled=\{actionStage !== null\}/);
    assert.doesNotMatch(src, /disabled=\{s\.status === "BLOCKED"/);
    // The component resolves its per-stage shortcut map from the canonical
    // lib/tender-workflow-stage-targets.ts registry (shared with
    // WorkflowStepLinks) instead of an inline copy — assert against that.
    assert.match(src, /TENDER_WORKFLOW_STAGE_TARGETS\[stage\.stage\]/);
    const stageTargets = readFileSync("lib/tender-workflow-stage-targets.ts", "utf8");
    for (const anchor of [
      "#tender-files",
      "#extraction-quality",
      "#ai-analyze-section",
      "#requirement-coverage",
      "#tender-edit-form",
      "#submission-plan",
      "#match-evidence",
      "#generated-documents",
      "#authority-review",
      "#export-readiness",
      "#final-package-manifest",
    ]) {
      assert.ok(stageTargets.includes(anchor), `workflow shortcut map must include ${anchor}`);
    }
  });

  it("tender detail composes the five end-to-end workflow stages in authority order", () => {
    const page = readFileSync("app/dashboard/tenders/[id]/page.tsx", "utf8");
    const orderedComponents = [
      "TenderSourceFilesPanel",
      "AIAnalyzePanel",
      "EngineActionPanel",
      "MatchingQualityPanel",
      "EvidenceCoveragePanel",
      "GenerationActionPanel",
      "AuthorityReviewPanel",
      "FinalPackageManifestPanel",
      "ExportReadinessPanel",
    ];
    let previous = -1;
    for (const component of orderedComponents) {
      const next = page.indexOf(`<${component}`);
      assert.ok(next > previous, `${component} must appear after the prior workflow authority stage`);
      previous = next;
    }
    for (const center of [
      "TenderWorkflowActionCenter",
      "TenderRecoveryCommandCenter",
      "TenderReleaseStatePanel",
      "FinalSubmissionControlCenter",
    ]) {
      assert.ok(page.includes(`<${center}`), `${center} must remain wired into the tender workspace`);
    }
  });
});
