// Workflow live-state registry — collision, coverage, and contract tests.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  WORKFLOW_LIVE_STATES,
  getWorkflowLiveStateSpec,
  coarseStatusToLiveState,
  listWorkflowLiveStateIconNames,
  type WorkflowLiveState,
} from "../lib/ui/workflow-live-state";

function readIcons(): string {
  return readFileSync(resolve(process.cwd(), "components", "icons.tsx"), "utf8");
}

describe("workflow live-state registry — coverage", () => {
  it("defines all 10 precise states required by the task brief", () => {
    const required: WorkflowLiveState[] = [
      "queued",
      "extracting",
      "analyzing",
      "matching",
      "generating",
      "validating",
      "blocked_with_reason",
      "awaiting_approval",
      "ready",
      "failed_with_recovery",
    ];
    for (const state of required) {
      assert.ok(state in WORKFLOW_LIVE_STATES, `State "${state}" missing from registry`);
    }
  });

  it("every state has a non-empty label, description, and icon name", () => {
    for (const [state, spec] of Object.entries(WORKFLOW_LIVE_STATES)) {
      assert.ok(spec.label.length > 0, `State "${state}" has empty label`);
      assert.ok(spec.description.length > 0, `State "${state}" has empty description`);
      assert.ok(spec.iconName.length > 0, `State "${state}" has empty iconName`);
      assert.ok(spec.badgeClassName.length > 0, `State "${state}" has empty badgeClassName`);
    }
  });

  it("blocked_with_reason and failed_with_recovery require user action", () => {
    assert.equal(WORKFLOW_LIVE_STATES.blocked_with_reason.requiresUserAction, true);
    assert.equal(WORKFLOW_LIVE_STATES.failed_with_recovery.requiresUserAction, true);
    assert.equal(WORKFLOW_LIVE_STATES.awaiting_approval.requiresUserAction, true);
  });

  it("queued / extracting / analyzing / matching / generating / validating do not require user action", () => {
    for (const state of ["queued", "extracting", "analyzing", "matching", "generating", "validating"] as WorkflowLiveState[]) {
      assert.equal(WORKFLOW_LIVE_STATES[state].requiresUserAction, false, `State "${state}" should not require user action`);
    }
  });

  it("failed_with_recovery is terminal", () => {
    assert.equal(WORKFLOW_LIVE_STATES.failed_with_recovery.terminal, true);
  });

  it("queued is NOT terminal", () => {
    assert.equal(WORKFLOW_LIVE_STATES.queued.terminal, false);
  });
});

describe("workflow live-state registry — icon export contract", () => {
  it("every referenced icon is exported from components/icons.tsx", () => {
    const iconsSource = readIcons();
    for (const iconName of listWorkflowLiveStateIconNames()) {
      assert.match(
        iconsSource,
        new RegExp(`export function ${iconName}\\b`),
        `Icon "${iconName}" is referenced by WORKFLOW_LIVE_STATES but not exported from components/icons.tsx`,
      );
    }
  });
});

describe("workflow live-state registry — coarse-to-precise mapping", () => {
  it("COMPLETE → ready", () => {
    assert.equal(coarseStatusToLiveState("COMPLETE", 1), "ready");
  });

  it("READY on stage 9 (validate/approve) → awaiting_approval", () => {
    assert.equal(coarseStatusToLiveState("READY", 9), "awaiting_approval");
  });

  it("READY on other stages → ready", () => {
    assert.equal(coarseStatusToLiveState("READY", 6), "ready");
    assert.equal(coarseStatusToLiveState("READY", 10), "ready");
  });

  it("IN_PROGRESS maps to the correct precise state by stage", () => {
    assert.equal(coarseStatusToLiveState("IN_PROGRESS", 2), "extracting");
    assert.equal(coarseStatusToLiveState("IN_PROGRESS", 3), "analyzing");
    assert.equal(coarseStatusToLiveState("IN_PROGRESS", 7), "matching");
    assert.equal(coarseStatusToLiveState("IN_PROGRESS", 8), "generating");
    assert.equal(coarseStatusToLiveState("IN_PROGRESS", 9), "validating");
    // Unknown stage defaults to queued.
    assert.equal(coarseStatusToLiveState("IN_PROGRESS", 99), "queued");
  });

  it("BLOCKED / BLOCKED_BY_PRIOR_STEP → blocked_with_reason", () => {
    assert.equal(coarseStatusToLiveState("BLOCKED", 6), "blocked_with_reason");
    assert.equal(coarseStatusToLiveState("BLOCKED_BY_PRIOR_STEP", 6), "blocked_with_reason");
  });

  it("WARNING → failed_with_recovery", () => {
    assert.equal(coarseStatusToLiveState("WARNING", 5), "failed_with_recovery");
  });

  it("WAITING_ON_PRIOR_STEP / PENDING / unknown → queued", () => {
    assert.equal(coarseStatusToLiveState("WAITING_ON_PRIOR_STEP", 4), "queued");
    assert.equal(coarseStatusToLiveState("PENDING", 1), "queued");
    assert.equal(coarseStatusToLiveState("UNKNOWN_STATUS", 1), "queued");
  });
});

describe("workflow live-state registry — lookup API", () => {
  it("getWorkflowLiveStateSpec returns the spec for a known state", () => {
    const spec = getWorkflowLiveStateSpec("analyzing");
    assert.equal(spec.state, "analyzing");
    assert.equal(spec.iconName, "SparklesIcon");
    assert.equal(spec.label, "Analyzing");
  });

  it("getWorkflowLiveStateSpec throws for an unknown state", () => {
    // @ts-expect-error — testing runtime guard against typos
    assert.throws(() => getWorkflowLiveStateSpec("definitely_not_a_state"));
  });
});
