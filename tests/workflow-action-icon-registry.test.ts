import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertConsistentActionIcons,
  assertUniqueMutationOwners,
  getTenderAction,
  listTenderActions,
} from "../lib/ui/action-registry";
import {
  WORKFLOW_ACTION_ICONS,
  assertNoWorkflowActionIconCollisions,
  findWorkflowActionIconCollisions,
  getWorkflowActionIcon,
  getWorkflowActionLabel,
  listWorkflowActionIconNames,
} from "../lib/ui/workflow-action-icons";

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("canonical workflow action registry", () => {
  it("has one owner per mutation and one icon meaning per verb", () => {
    assert.doesNotThrow(() => assertUniqueMutationOwners());
    assert.doesNotThrow(() => assertConsistentActionIcons());
    assert.deepEqual(findWorkflowActionIconCollisions(), []);
    assert.doesNotThrow(() => assertNoWorkflowActionIconCollisions());
  });

  it("defines every normal and recovery action with an explicit owner and target", () => {
    for (const [actionId, action] of listTenderActions()) {
      assert.ok(action.owner, `${actionId} is missing a mutation/navigation owner`);
      assert.match(action.anchor, /^#/);
      assert.ok(action.label.trim().length > 0);
      assert.ok(["NORMAL", "RECOVERY", "NAVIGATION"].includes(action.availability));
      if (action.availability === "RECOVERY") {
        assert.ok(action.mutation, `${actionId} is a recovery action without an active mutation`);
      }
    }
  });

  it("marks AI Analyze, evidence matching, and Engine as recovery-only", () => {
    assert.equal(getTenderAction("AI_ANALYZE").availability, "RECOVERY");
    assert.equal(getTenderAction("MATCH_EVIDENCE").availability, "RECOVERY");
    assert.equal(getTenderAction("RUN_ENGINE").availability, "RECOVERY");
  });

  it("keeps normal workflow actions available without manual Analyze, Match, or Engine clicks", () => {
    const normal = listTenderActions()
      .filter(([, action]) => action.availability === "NORMAL")
      .map(([actionId]) => actionId);
    assert.deepEqual(normal, [
      "UPLOAD_TENDER_FILES",
      "BUILD_SUBMISSION_PLAN",
      "GENERATE_REQUIRED_DOCUMENTS",
      "FINAL_APPROVAL",
      "DOWNLOAD_FINAL_ZIP",
    ]);
  });
});

describe("workflow icon compatibility projection", () => {
  it("is derived from action-registry rather than defining a second registry", () => {
    const source = read("lib/ui/workflow-action-icons.ts");
    assert.match(source, /from "\.\/action-registry"/);
    assert.match(source, /listTenderActions\(\)\.map/);
    assert.doesNotMatch(source, /export const WORKFLOW_ACTION_ICONS[^=]*=\s*\[/);
    assert.equal(WORKFLOW_ACTION_ICONS.length, listTenderActions().length);
  });

  it("resolves legacy component aliases to the canonical action meaning", () => {
    assert.equal(getWorkflowActionIcon("execute", "engine-action"), getTenderAction("RUN_ENGINE").iconName);
    assert.equal(getWorkflowActionLabel("execute", "engine-action"), getTenderAction("RUN_ENGINE").label);
    assert.equal(getWorkflowActionIcon("resume", "recovery-command-center"), getTenderAction("AI_ANALYZE").iconName);
    assert.equal(getWorkflowActionLabel("resume", "recovery-command-center"), getTenderAction("AI_ANALYZE").label);
  });

  it("returns null for an unregistered verb and surface pair", () => {
    assert.equal(getWorkflowActionIcon("upload", "engine-action"), null);
    assert.equal(getWorkflowActionIcon("generate", "tender-files"), null);
  });

  it("references only exported SVG icons", () => {
    const iconsSource = read("components/icons.tsx");
    for (const iconName of listWorkflowActionIconNames()) {
      assert.match(
        iconsSource,
        new RegExp(`export function ${iconName}\\b`),
        `Icon ${iconName} is not exported from components/icons.tsx`,
      );
    }
  });
});

describe("Workflow Center ownership", () => {
  it("derives labels and targets from the canonical registry and executes no mutation", () => {
    const source = read("app/api/tenders/[id]/workflow-center/route.ts");
    assert.match(source, /getTenderAction/);
    assert.match(source, /actionKind:\s*"navigation"/);
    assert.match(source, /mutationOwner:\s*action\.owner/);
    assert.doesNotMatch(source, /isMutationAction/);
    assert.doesNotMatch(source, /fetch\s*\(/);
  });
});
