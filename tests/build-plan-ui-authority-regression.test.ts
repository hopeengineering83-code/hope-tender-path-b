import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("Build Plan has one automatic status owner", () => {
  const status = read("components/build-submission-plan-button.tsx");
  const completeness = read("components/submission-plan-completeness-panel.tsx");

  it("reads the canonical Build Plan status without posting a third action", () => {
    assert.match(status, /\/api\/tenders\/\$\{tenderId\}\/build-plan`/);
    assert.match(status, /method:\s*"GET"/);
    assert.doesNotMatch(status, /method:\s*"POST"/);
    assert.doesNotMatch(status, /\/build-plan\/confirm/);
    assert.doesNotMatch(status, /submission-plan\/build/);
    assert.doesNotMatch(status, /<button/);
  });

  it("shows ordered plan contents and explicit automatic authority", () => {
    assert.match(status, /items\.map/);
    assert.match(status, /exactOrder/);
    assert.match(status, /exactFileName/);
    assert.match(status, /waiting for automatic Engine processing/);
    assert.match(status, /automatically source-verified/);
    assert.match(status, /No separate Build Plan confirmation is required/);
    assert.doesNotMatch(status, /checked=\{reviewed\}/);
    assert.doesNotMatch(status, /Confirm reviewed Build Plan/);
  });

  it("renders exactly one status surface in the one Build Plan panel", () => {
    assert.equal((completeness.match(/<BuildSubmissionPlanButton/g) ?? []).length, 1);
    assert.doesNotMatch(completeness, /submission-plan\/build/);
    assert.doesNotMatch(completeness, /Build Plan<\/button>/);
  });

  it("routes generic blocker actions to the owner instead of a hidden mutation", () => {
    const recovery = read("lib/recovery-command-actions.ts");
    const actionBlock = recovery.slice(
      recovery.indexOf("BUILD_SUBMISSION_PLAN:"),
      recovery.indexOf("RUN_ENGINE:", recovery.indexOf("BUILD_SUBMISSION_PLAN:")),
    );
    assert.match(actionBlock, /kind: "scroll"/);
    assert.match(actionBlock, /anchorId: "submission-plan-completeness"/);
    assert.doesNotMatch(actionBlock, /method: "POST"/);

    const stages = read("lib/tender-workflow-stages.ts");
    assert.match(stages, /stage: 6,\s*label: "Source-verified Build Plan",\s*targets: \["#submission-plan-completeness"/);
  });

  it("does not mutate or auto-classify documents during page load", () => {
    assert.doesNotMatch(completeness, /autoRunDone/);
    assert.doesNotMatch(completeness, /autoClassify/);
    assert.doesNotMatch(completeness, /submission-plan\/auto-classify/);
  });
});

describe("automatic submission scope is presented truthfully", () => {
  const truth = read("components/submission-plan-truth-panel.tsx");
  const completeness = read("components/submission-plan-completeness-panel.tsx");

  it("labels pending authority as automatic, not human-confirmed", () => {
    assert.match(truth, /Automatic Build Plan pending/);
    assert.match(truth, /href="#submission-plan-completeness"/);
    assert.doesNotMatch(truth, /Review and confirm Build Plan/);
  });

  it("keeps derived scope visibly non-authoritative until verification", () => {
    assert.match(completeness, /Unconfirmed tender scope/);
    assert.match(completeness, /Unconfirmed derived scope/);
    assert.match(completeness, /Unverified submission scope preview/);
    assert.match(completeness, /Preview only:/);
  });

  it("role-gates row recovery mutations", () => {
    const page = read("app/dashboard/tenders/[id]/page.tsx");
    assert.match(page, /<SubmissionPlanCompletenessPanel tenderId=\{tender\.id\} canMutate=\{canMutate\} \/>/);
    assert.match(completeness, /const canAct = canMutate &&/);
    assert.match(completeness, /Read-only: changing submission-scope rows requires ADMIN or PROPOSAL_MANAGER/);
  });
});

describe("canonical Build Plan endpoint distinguishes authority states", () => {
  const route = read("app/api/tenders/[id]/build-plan/route.ts");

  it("returns explicit authority states", () => {
    for (const state of ["NOT_BUILT", "DRAFT", "CONFIRMED", "STALE_CONFIRMED"]) {
      assert.match(route, new RegExp(`state: "${state}"`));
    }
  });

  it("validates CONFIRMED state through the strict current-plan gate", () => {
    assert.match(route, /getCurrentConfirmedBuildPlan/);
    assert.match(route, /authorizesGeneration: true/);
    assert.match(route, /authorizesGeneration: false/);
    assert.match(route, /buildAndVerifyBuildPlan/);
  });
});
