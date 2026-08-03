// One Build Plan panel, reading one resolver.
//
// The tender detail page rendered two panels, stacked adjacent inside the same
// diagnostics disclosure, that both answered "how many required files exist
// and how many are done":
//
//   submission-plan-reconciliation-panel.tsx  — re-derived the counts itself
//       via findMissingGeneratedDocuments, which treats ANY non-SUPERSEDED row
//       as satisfying its plan file.
//   submission-plan-completeness-panel.tsx    — reads
//       /api/tenders/[id]/submission-plan, whose resolver first asks
//       isFinalExportCandidateDocument.
//
// Reproduced divergence: plan requires "Technical Proposal.docx"; a document
// exists with generationStatus GENERATED and reviewStatus NOT_EXPORTABLE.
// Reconciliation reported 1/1 and "Submission file plan is reconciled" in
// green; completeness reported Current outputs 0 and the row as
// REPLACE_WITH_ORIGINAL. NOT_EXPORTABLE is set by the row action in the
// completeness panel itself, so a user could set it and watch the panel
// directly above disagree.
//
// The reconciliation panel is gone. Its three mutations moved to the surviving
// panel, driven by the canonical counts, so the buttons and the numbers that
// justify them now come from one place.
//
// The assertion that matters is the one below on the resolvers themselves: it
// fails if a second local count ever reappears in a Build Plan surface.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

import { findMissingGeneratedDocuments } from "../lib/engine/submission-plan";
import { resolveSubmissionPlanCompleteness } from "../lib/engine/submission-plan-completeness";

const PANEL = readFileSync("components/submission-plan-completeness-panel.tsx", "utf8");
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
    assert.equal(existsSync("components/submission-plan-reconciliation-panel.tsx"), false,
      "a deleted panel that is merely unrendered still invites re-wiring");
  });

  it("leaves exactly one Build Plan panel on the tender detail page", () => {
    assert.doesNotMatch(PAGE, /SubmissionPlanReconciliationPanel/);
    assert.equal((PAGE.match(/<SubmissionPlanCompletenessPanel/g) ?? []).length, 1);
  });

  it("leaves no dangling #submission-plan-reconciliation anchor anywhere", () => {
    // Scan every tracked source file rather than a hand-listed set. The first
    // version of this test listed six files and passed while
    // e2e/workflow-control-center-action-buttons.spec.ts still pointed stage 6
    // at the deleted anchor — an allowlist can only catch the sites its author
    // already thought of, which is precisely the mistake being guarded against.
    const tracked = execFileSync("git", ["ls-files", "*.ts", "*.tsx"], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      // This file names the dead anchor deliberately, to explain the rule.
      .filter((path) => path !== "tests/build-plan-single-panel-authority.test.ts");

    const offenders = tracked.filter((path) => {
      const source = readFileSync(path, "utf8");
      // Comments may reference the deleted panel by filename as history; only
      // a live anchor reference is a defect.
      return /["'#]submission-plan-reconciliation["']?/.test(source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ""));
    });
    assert.deepEqual(offenders, [], `these files still point at the deleted panel's anchor: ${offenders.join(", ")}`);
    assert.match(PANEL, /id="submission-plan-completeness"/);
  });

  it("keeps the workflow stage-6 shortcut pointed at a target that exists", () => {
    const stages = readFileSync("lib/tender-workflow-stages.ts", "utf8");
    const spec = readFileSync("e2e/workflow-control-center-action-buttons.spec.ts", "utf8");
    assert.match(stages, /stage: 6,[^}]*targets: \["#submission-plan-completeness"/);
    assert.match(spec, /\[6, "Confirmed Build Plan", "#submission-plan-completeness"\]/);
  });
});

describe("the surviving panel owns the three plan mutations", () => {
  it("hosts build and reconcile-stale (generate-missing removed — runs automatically)", () => {
    assert.match(PANEL, /<BuildSubmissionPlanButton/);
    assert.match(PANEL, /<ReconcileStaleFilesButton/);
    assert.doesNotMatch(PANEL, /<GenerateMissingPlanFilesButton/);
  });

  it("drives each one from the canonical summary, not a local recount", () => {
    assert.match(PANEL, /data\.summary\.automaticPlanPending/);
    assert.match(PANEL, /staleCount=\{data\.summary\.totalOutsidePlan\}/);
    // The panel must never import the raw reconciliation helpers and start a
    // second count of its own — that is exactly what was just removed. Match
    // imports and calls, not prose: the comment at the top of the panel names
    // these helpers deliberately, to record why they must not come back.
    assert.doesNotMatch(PANEL, /import[^;]*\bfind(?:Missing|Extra)GeneratedDocuments\b[^;]*from/s);
    assert.doesNotMatch(PANEL, /\bfind(?:Missing|Extra)GeneratedDocuments\s*\(/);
  });

  it("re-reads its counts after a mutation instead of leaving them stale", () => {
    // The buttons live in a client panel that holds its own fetched summary,
    // so router.refresh() alone would re-render the server tree while this
    // panel kept offering the action that just ran.
    assert.match(PANEL, /subscribeTenderWorkflowSync\(tenderId, \(\) => \{ void load\(\); \}\)/);
    for (const path of [
      "components/reconcile-stale-files-button.tsx",
      "components/build-submission-plan-button.tsx",
    ]) {
      assert.match(readFileSync(path, "utf8"), /emitTenderWorkflowSync\(\{ tenderId/,
        `${path} must announce its mutation so the hosting panel re-reads`);
    }
  });
});

describe("the divergence that motivated the merge is real and now unreachable", () => {
  it("the two implementations genuinely disagreed on a NOT_EXPORTABLE document", () => {
    const doc = docWith({ reviewStatus: "NOT_EXPORTABLE" });

    // The deleted panel's implementation: satisfied, nothing missing.
    const missing = findMissingGeneratedDocuments({ files: [PLAN_ITEM] } as never, [doc] as never);
    assert.equal(missing.length, 0, "the old local count treated the row as done");

    // The canonical resolver the surviving panel reads: not a current output.
    const report = canonicalReport(doc);
    assert.equal(report.totalGenerated, 0);
    assert.equal(report.rows[0].status, "REPLACE_WITH_ORIGINAL");
  });

  it("agrees with itself on an ordinary generated document", () => {
    const report = canonicalReport(docWith({ reviewStatus: "READY_FOR_EXPORT" }));
    assert.equal(report.totalGenerated, 1);
    assert.equal(report.totalMissing, 0);
    assert.equal(report.rows[0].status, "GENERATED");
  });

  it("only one implementation is reachable from the UI now", () => {
    // Server gates may still use the raw helper — they pre-filter through
    // filterFinalExportCandidateDocuments. No Build Plan *panel* may.
    assert.doesNotMatch(PANEL, /submission-plan"\s*;/);
    assert.match(PANEL, /\/api\/tenders\/\$\{tenderId\}\/submission-plan/);
  });
});
