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

  it("defines every action explicitly", () => {
    for (const [actionId, action] of listTenderActions()) {
      assert.ok(action.owner, `${actionId} is missing an owner`);
      assert.match(action.anchor, /^#/);
      assert.ok(action.label.trim().length > 0);
      assert.ok(["NORMAL", "RECOVERY", "NAVIGATION"].includes(action.availability));
      if (action.mutation) {
        assert.match(action.mutation, /^(GET|POST|PATCH|PUT|DELETE) /);
      }
    }
  });

  it("keeps AI Analyze and Run Engine recovery-only", () => {
    assert.equal(getTenderAction("AI_ANALYZE").availability, "RECOVERY");
    assert.equal(getTenderAction("AI_ANALYZE").owner, "AIAnalyzePanel");
    assert.equal(getTenderAction("AI_ANALYZE").mutation, null);
    assert.equal(getTenderAction("RUN_ENGINE").availability, "RECOVERY");
    assert.equal(getTenderAction("RUN_ENGINE").owner, "MatchingSelectedEvidencePanel");
    assert.equal(getTenderAction("RUN_ENGINE").mutation, null);
    assert.equal(getTenderAction("MATCH_EVIDENCE").availability, "NAVIGATION");
    assert.equal(getTenderAction("MATCH_EVIDENCE").mutation, null);
  });

  it("keeps Build Plan, generation and final review automatic/navigation-only", () => {
    assert.equal(getTenderAction("BUILD_SUBMISSION_PLAN").availability, "NAVIGATION");
    assert.equal(getTenderAction("BUILD_SUBMISSION_PLAN").mutation, null);
    assert.equal(getTenderAction("GENERATE_REQUIRED_DOCUMENTS").availability, "NAVIGATION");
    assert.equal(getTenderAction("GENERATE_REQUIRED_DOCUMENTS").mutation, null);
    assert.equal(getTenderAction("FINAL_APPROVAL").availability, "NAVIGATION");
    assert.equal(getTenderAction("FINAL_APPROVAL").mutation, null);
  });

  it("binds only active executable actions to canonical live routes", () => {
    assert.equal(getTenderAction("UPLOAD_TENDER_FILES").mutation, "POST /api/upload");
    assert.equal(getTenderAction("REEXTRACT_SOURCE").mutation, "POST /api/tenders/:id/files/:fileId/reextract");
    assert.equal(getTenderAction("AI_ANALYZE").mutation, null);
    assert.equal(getTenderAction("RUN_ENGINE").mutation, null);
    assert.equal(getTenderAction("DOWNLOAD_FINAL_ZIP").mutation, "GET /api/tenders/:id/download?type=zip");
    assert.equal(getTenderAction("DOWNLOAD_FINAL_ZIP").owner, "ExportReadinessPanel");
  });

  it("upload is the only normal POST workflow action", () => {
    const normalPost = listTenderActions()
      .filter(([, action]) => action.availability === "NORMAL" && action.mutation?.startsWith("POST "))
      .map(([id]) => id)
      .sort();
    assert.deepEqual(normalPost, ["UPLOAD_TENDER_FILES"]);
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

  it("resolves legacy aliases to canonical recovery meanings", () => {
    assert.equal(getWorkflowActionIcon("execute", "engine-action"), getTenderAction("RUN_ENGINE").iconName);
    assert.equal(getWorkflowActionLabel("execute", "engine-action"), getTenderAction("RUN_ENGINE").label);
    assert.equal(getWorkflowActionIcon("resume", "recovery-command-center"), getTenderAction("AI_ANALYZE").iconName);
    assert.equal(getWorkflowActionLabel("resume", "recovery-command-center"), getTenderAction("AI_ANALYZE").label);
  });

  it("returns null for an unregistered verb/surface pair", () => {
    assert.equal(getWorkflowActionIcon("upload", "engine-action"), null);
    assert.equal(getWorkflowActionIcon("generate", "tender-files"), null);
  });

  it("references only exported SVG icons", () => {
    const iconsSource = read("components/icons.tsx");
    for (const iconName of listWorkflowActionIconNames()) {
      assert.match(iconsSource, new RegExp(`export function ${iconName}\\b`));
    }
  });
});

describe("Workflow Center ownership", () => {
  it("projects registry metadata but executes no mutation", () => {
    const source = read("app/api/tenders/[id]/workflow-center/route.ts");
    assert.match(source, /getTenderAction/);
    assert.match(source, /actionKind: action\.mutation \? "mutation" as const : "navigation" as const/);
    assert.match(source, /mutationOwner:\s*action\.owner/);
    assert.match(source, /mutation:\s*action\.mutation/);
    assert.doesNotMatch(source, /fetch\s*\(|axios\./);
  });
});
