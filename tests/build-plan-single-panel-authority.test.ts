import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

import { findMissingGeneratedDocuments } from "../lib/engine/submission-plan";
import { resolveSubmissionPlanCompleteness } from "../lib/engine/submission-plan-completeness";

const PANEL = readFileSync("components/submission-plan-completeness-panel.tsx", "utf8");
const STATUS = readFileSync("components/build-submission-plan-button.tsx", "utf8");
const PAGE = readFileSync("app/dashboard/tenders/[id]/page.tsx", "utf8");

const PLAN_ITEM = {
  canonicalId: "c1",
  exactFileName: "Technical Proposal.docx",
  exactOrder: 1,
  documentType: "TECHNICAL_PROPOSAL",
  format: "DOCX",
  envelope: "TECHNICAL" as const,
  required: true,
  source: "TENDER",
};

function docWith(overrides: Record<string, unknown>) {
  return {
    id: "d1",
    name: "Technical Proposal",
    exactFileName: "Technical Proposal.docx",
    exactOrder: 1,
    documentType: "TECHNICAL_PROPOSAL",
    format: "DOCX",
    generationStatus: "GENERATED",
    validationStatus: "PASSED",
    reviewStatus: "PENDING",
    storagePath: "s/1",
    contentSummary: "x",
    fileContent: null,
    ...overrides,
  };
}

function canonicalReport(doc: Record<string, unknown>) {
  return resolveSubmissionPlanCompleteness({
    tender: { id: "t1", title: "T", exactFileNaming: null, exactFileOrder: null, pageLimit: null, requirements: [] } as never,
    generatedDocuments: [doc] as never,
    qualityFailedIds: new Set<string>(),
    confirmedPlanItems: [PLAN_ITEM] as never,
  });
}

describe("the second Build Plan panel is gone", () => {
  it("deletes the competing reconciliation panel outright", () => {
    assert.equal(existsSync("components/submission-plan-reconciliation-panel.tsx"), false);
  });

  it("leaves exactly one Build Plan panel on the tender detail page", () => {
    assert.doesNotMatch(PAGE, /SubmissionPlanReconciliationPanel/);
    assert.equal((PAGE.match(/<SubmissionPlanCompletenessPanel/g) ?? []).length, 1);
  });

  it("leaves no dangling deleted-panel anchor", () => {
    const tracked = execFileSync("git", ["ls-files", "*.ts", "*.tsx"], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .filter((path) => path !== "tests/build-plan-single-panel-authority.test.ts");
    const offenders = tracked.filter((path) => {
      const source = readFileSync(path, "utf8").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
      return /["'#]submission-plan-reconciliation["']?/.test(source);
    });
    assert.deepEqual(offenders, []);
    assert.match(PANEL, /id="submission-plan-completeness"/);
  });

  it("keeps stage 6 pointed at the surviving panel", () => {
    const stages = readFileSync("lib/tender-workflow-stages.ts", "utf8");
    const spec = readFileSync("e2e/workflow-control-center-action-buttons.spec.ts", "utf8");
    assert.match(stages, /stage: 6,[^}]*targets: \["#submission-plan-completeness"/);
    assert.match(spec, /\[6, "Confirmed Build Plan", "#submission-plan-completeness"\]/);
  });
});

describe("the surviving panel has one authority", () => {
  it("renders automatic Build Plan status and recovery-only stale reconciliation", () => {
    assert.equal((PANEL.match(/<BuildSubmissionPlanButton/g) ?? []).length, 1);
    assert.match(PANEL, /<ReconcileStaleFilesButton/);
    assert.doesNotMatch(PANEL, /<GenerateMissingPlanFilesButton/);
    assert.match(STATUS, /method:\s*"GET"/);
    assert.doesNotMatch(STATUS, /method:\s*"POST"/);
    assert.doesNotMatch(STATUS, /<button/);
  });

  it("drives counts from the canonical summary, not a local recount", () => {
    assert.match(PANEL, /data\.summary\.automaticPlanPending/);
    assert.match(PANEL, /staleCount=\{data\.summary\.totalOutsidePlan\}/);
    assert.doesNotMatch(PANEL, /import[^;]*\bfind(?:Missing|Extra)GeneratedDocuments\b[^;]*from/s);
    assert.doesNotMatch(PANEL, /\bfind(?:Missing|Extra)GeneratedDocuments\s*\(/);
  });

  it("re-reads after the remaining stale-file recovery mutation", () => {
    assert.match(PANEL, /subscribeTenderWorkflowSync\(tenderId, \(\) => \{ void load\(\); \}\)/);
    const recovery = readFileSync("components/reconcile-stale-files-button.tsx", "utf8");
    assert.match(recovery, /emitTenderWorkflowSync\(\{ tenderId/);
  });
});

describe("canonical completeness prevents the historical divergence", () => {
  it("rejects a NOT_EXPORTABLE row even though the old raw helper counted it", () => {
    const doc = docWith({ reviewStatus: "NOT_EXPORTABLE" });
    assert.equal(findMissingGeneratedDocuments({ files: [PLAN_ITEM] } as never, [doc] as never).length, 0);
    const report = canonicalReport(doc);
    assert.equal(report.totalGenerated, 0);
    assert.equal(report.rows[0].status, "MISSING_TENDER_SOURCE_FORM");
  });

  it("accepts an ordinary export-ready generated document", () => {
    const report = canonicalReport(docWith({ reviewStatus: "READY_FOR_EXPORT" }));
    assert.equal(report.totalGenerated, 1);
    assert.equal(report.totalMissing, 0);
    assert.equal(report.rows[0].status, "GENERATED");
  });
});
