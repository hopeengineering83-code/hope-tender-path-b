// Build Plan UI authority regressions.
//
// The preview previously exposed three contradictory facts at once:
// - "Submission Plan: EXPLICIT TENDER PLAN"
// - "No current confirmed Build Plan"
// - two separate "Build Plan" buttons, both of which created only a DRAFT
//
// These checks keep one explicit build/review/confirm owner and ensure
// unconfirmed derived/tender scope is labelled as a preview, never authority.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("Build Plan has one explicit action owner", () => {
  const action = read("components/build-submission-plan-button.tsx");
  const completeness = read("components/submission-plan-completeness-panel.tsx");
  const reconciliation = read("components/submission-plan-reconciliation-panel.tsx");

  it("uses the canonical draft route and the confirmation route", () => {
    assert.match(action, /\/api\/tenders\/\$\{tenderId\}\/build-plan`/);
    assert.match(action, /\/api\/tenders\/\$\{tenderId\}\/build-plan\/confirm`/);
    assert.doesNotMatch(action, /submission-plan\/build/);
  });

  it("shows the complete ordered draft and requires review acknowledgement before confirmation", () => {
    assert.match(action, /draftItems\.map/);
    assert.match(action, /exactOrder/);
    assert.match(action, /exactFileName/);
    assert.match(action, /checked=\{reviewed\}/);
    assert.match(action, /disabled=\{!reviewed \|\| running \|\| isPending\}/);
    assert.match(action, /Confirm reviewed Build Plan/);
  });

  it("keeps the action in reconciliation and removes the competing completeness action", () => {
    assert.equal((reconciliation.match(/<BuildSubmissionPlanButton/g) ?? []).length, 1);
    assert.doesNotMatch(completeness, /submission-plan\/build/);
    assert.doesNotMatch(completeness, /Build Plan<\/button>/);
  });

  it("routes generic blocker actions to the owner instead of posting a hidden draft mutation", () => {
    const recovery = read("lib/recovery-command-actions.ts");
    const actionBlock = recovery.slice(
      recovery.indexOf("BUILD_SUBMISSION_PLAN:"),
      recovery.indexOf("RUN_ENGINE:", recovery.indexOf("BUILD_SUBMISSION_PLAN:")),
    );
    assert.match(actionBlock, /kind: "scroll"/);
    assert.match(actionBlock, /anchorId: "submission-plan-reconciliation"/);
    assert.doesNotMatch(actionBlock, /method: "POST"/);
    assert.doesNotMatch(actionBlock, /submission-plan\/build/);
    for (const actionName of ["CONFIRM_SUBMISSION_PLAN", "REVIEW_REQUIREMENTS_OR_ADD_MANUAL_PLAN"]) {
      const start = recovery.indexOf(`${actionName}:`);
      const end = recovery.indexOf("\n  },", start);
      const block = recovery.slice(start, end);
      assert.match(block, /anchorId: "submission-plan-reconciliation"/);
      assert.doesNotMatch(block, /anchorId: "generated-documents"/);
    }

    const stages = read("lib/tender-workflow-stages.ts");
    assert.match(
      stages,
      /stage: 6,\s*label: "Confirmed Build Plan",\s*targets: \["#submission-plan-reconciliation"/,
    );
  });

  it("opens scroll targets even when a caller does not supply a custom scroll callback", () => {
    const blockerLink = read("components/blocker-action-link.tsx");
    assert.match(blockerLink, /document\.getElementById\(spec\.anchorId\)/);
    assert.match(blockerLink, /openParentDetailsAndScroll\(target\)/);
  });

  it("does not mutate Build Plan or auto-classify documents during page load", () => {
    assert.doesNotMatch(completeness, /autoRunDone/);
    assert.doesNotMatch(completeness, /autoClassify/);
    assert.doesNotMatch(completeness, /submission-plan\/auto-classify/);
  });
});

describe("unconfirmed submission scope is never presented as plan authority", () => {
  const truth = read("components/submission-plan-truth-panel.tsx");
  const completeness = read("components/submission-plan-completeness-panel.tsx");

  it("labels unconfirmed data as a preview and links to the canonical owner", () => {
    assert.match(truth, /Submission scope preview — not confirmed/);
    assert.match(truth, /href="#submission-plan-reconciliation"/);
    assert.match(truth, /Review and confirm Build Plan/);
  });

  it("renames explicit and derived fallback states as unconfirmed scope", () => {
    assert.match(completeness, /Unconfirmed tender scope/);
    assert.match(completeness, /Unconfirmed derived scope/);
    assert.match(completeness, /Unconfirmed submission scope preview/);
    assert.match(completeness, /Preview only:/);
  });

  it("role-gates row mutations in both the page and panel", () => {
    const page = read("app/dashboard/tenders/[id]/page.tsx");
    assert.match(page, /<SubmissionPlanCompletenessPanel tenderId=\{tender\.id\} canMutate=\{canMutate\} \/>/);
    assert.match(completeness, /const canAct = canMutate &&/);
    assert.match(completeness, /Read-only: changing submission-scope rows requires ADMIN or PROPOSAL_MANAGER/);
  });
});

describe("canonical Build Plan status endpoint distinguishes draft from authority", () => {
  const route = read("app/api/tenders/[id]/build-plan/route.ts");

  it("returns NOT_BUILT, DRAFT, CONFIRMED, and STALE_CONFIRMED explicitly", () => {
    for (const state of ["NOT_BUILT", "DRAFT", "CONFIRMED", "STALE_CONFIRMED"]) {
      assert.match(route, new RegExp(`state: "${state}"`));
    }
  });

  it("validates persisted CONFIRMED state through the strict current-plan gate", () => {
    assert.match(route, /getCurrentConfirmedBuildPlan/);
    assert.match(route, /authorizesGeneration: true/);
    assert.match(route, /authorizesGeneration: false/);
  });

  it("keeps diagnostics and the public status DTO on the confirmed-plan authority", () => {
    const diagnostic = read("app/api/tenders/[id]/pipeline-diagnostic/route.ts");
    assert.match(diagnostic, /getCurrentConfirmedBuildPlan/);
    assert.doesNotMatch(diagnostic, /const planFiles = safeParseJsonArray\(tender\.exactFileNaming\)/);

    const getHandler = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
    assert.doesNotMatch(getHandler, /contentHash:/);
    assert.doesNotMatch(getHandler, /status:\s*persisted\.status/);
  });
});
