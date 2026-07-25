// Locks the canonical workflow response contract and single-owner tender page.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  canonicalWorkflowFingerprint,
  workflowHasInProgressStage,
} from "../lib/ui/tender-workflow-sync";

const route = readFileSync("app/api/tenders/[id]/workflow-center/route.ts", "utf8");
const ALLOWED_TOP_LEVEL_KEYS = new Set(["ok", "snapshot", "workflow", "decision", "stages", "classification", "pageLedgers", "error"]);

describe("workflow-center consumer contract", () => {
  it("returns the expected canonical top-level keys", () => {
    for (const key of ["ok: true", "snapshot,", "workflow,", "decision: decision", "stages,", "classification: classificationSummary", "pageLedgers: pageLedgerSummary"]) {
      assert.ok(route.includes(key), `route response must include ${key}`);
    }
  });

  it("no component reads a top-level workflow-center key the route does not return", () => {
    const offenders: string[] = [];
    for (const file of readdirSync("components")) {
      if (!file.endsWith(".tsx") && !file.endsWith(".ts")) continue;
      const source = readFileSync(join("components", file), "utf8")
        .split("\n").map((line) => line.replace(/^\s*\/\/.*$/, "")).join("\n");
      if (!/fetch\([^)]*workflow-center/.test(source)) continue;
      for (const match of source.matchAll(/\bjson\??\.([a-zA-Z]+)/g)) {
        if (!ALLOWED_TOP_LEVEL_KEYS.has(match[1])) offenders.push(`${file}: json.${match[1]}`);
      }
    }
    assert.deepEqual(offenders, []);
  });

  it("SubmissionPlanTruthPanel consumes its dedicated route and preserves every anchor state", () => {
    const source = readFileSync("components/submission-plan-truth-panel.tsx", "utf8");
    assert.match(source, /fetch\(`\/api\/tenders\/\$\{tenderId\}\/submission-plan`/);
    assert.match(source, /subscribeTenderWorkflowSync/);
    assert.ok((source.match(/id="submission-plan"/g) ?? []).length >= 3);
  });

  it("AuthorityReviewPanel consumes its dedicated route and persistent anchor", () => {
    const source = readFileSync("components/authority-review-panel.tsx", "utf8");
    assert.match(source, /fetch\(`\/api\/tenders\/\$\{tenderId\}\/authority-review`/);
    assert.match(source, /primaryBlockerReason/);
    assert.equal((source.match(/id="authority-review"/g) ?? []).length, 1);
  });

  it("RequirementTruthBanner synchronizes the whole workspace from canonical state", () => {
    const source = readFileSync("components/requirement-truth-banner.tsx", "utf8");
    assert.match(source, /setStatus\(json\.snapshot\?\.analysis\?\.state \?\? null\)/);
    assert.match(source, /canonicalWorkflowFingerprint/);
    assert.match(source, /emitTenderWorkflowSync/);
    assert.match(source, /workflowHasInProgressStage/);
    assert.match(source, /window\.setInterval/);
    assert.match(source, /Refresh workspace/);
    assert.match(source, /SECTION_DETECTED_REQUIREMENTS_NOT_STRUCTURED/);
  });

  it("canonical fingerprint changes only for workflow-driving facts", () => {
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
    assert.equal(first, canonicalWorkflowFingerprint({ ...base, generatedAt: "ignored" } as typeof base));
    assert.notEqual(first, canonicalWorkflowFingerprint({ ...base, snapshot: { ...base.snapshot, buildPlan: { gateValid: true } } }));
  });

  it("does not interrupt visibly in-progress work", () => {
    assert.equal(workflowHasInProgressStage({ snapshot: { analysis: { state: "RUNNING" } } }), true);
    assert.equal(workflowHasInProgressStage({ stages: [{ stage: 3, status: "IN_PROGRESS" }] }), true);
    assert.equal(workflowHasInProgressStage({ snapshot: { analysis: { state: "AI_SUCCEEDED" } }, stages: [] }), false);
  });

  // "retired Workflow Control Center remains internally synchronized" test
  // removed -- tender-workflow-action-center.tsx itself was deleted as
  // unrendered dead code (nothing imports or renders it).

  it("the normal tender page composes five workflow stages in authority order without competing centers", () => {
    const page = readFileSync("app/dashboard/tenders/[id]/page.tsx", "utf8");
    const orderedComponents = [
      "TenderSourceFilesPanel", "AIAnalyzePanel", "EngineActionPanel",
      "MatchingQualityPanel", "EvidenceCoveragePanel", "GenerationActionPanel",
      "AuthorityReviewPanel", "FinalPackageManifestPanel", "ExportReadinessPanel",
    ];
    let previous = -1;
    for (const component of orderedComponents) {
      const index = page.indexOf(`<${component}`);
      assert.ok(index > previous, `${component} must follow the prior authority stage`);
      previous = index;
    }
    for (const center of ["TenderWorkflowActionCenter", "TenderRecoveryCommandCenter", "TenderReleaseStatePanel", "FinalSubmissionControlCenter"]) {
      assert.ok(!page.includes(`<${center}`), `${center} must not compete on the normal tender page`);
    }
    for (const stage of [1, 2, 3, 4, 5]) assert.match(page, new RegExp(`<WorkflowStage number=\\{${stage}\\}`));
  });
});
