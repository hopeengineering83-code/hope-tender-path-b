// Runtime tests for REVIEWER restrictions under the automatic tender pipeline.
// Routine AI Analyze, Engine, and Build Plan entries are status/navigation only.
// Exceptional retries, repairs, generation, validation, and finalization remain
// role-gated mutations and must be hidden from REVIEWER and VIEWER users.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canMutateTender,
  isMutationAction,
  getRecoveryCommandActionSpec,
} from "../lib/recovery-command-actions";

type WorkflowStage = {
  stage: number;
  label: string;
  actionName: string;
  actionKind: "mutation" | "readonly";
};

function buildWorkflowStages(): WorkflowStage[] {
  const stageDefs = [
    { stage: 1, label: "Source Files", actionName: "UPLOAD_TENDER_DOCUMENT" },
    { stage: 2, label: "Extraction Quality", actionName: "RUN_OCR_OR_UPLOAD_CLEARER_SCAN" },
    { stage: 3, label: "AI Analyze", actionName: "RUN_AI_ANALYZE" },
    { stage: 4, label: "Confirm Requirements", actionName: "REVIEW_MATCHES" },
    { stage: 5, label: "Confirm Metadata", actionName: "EDIT_TENDER_METADATA" },
    { stage: 6, label: "Confirmed Build Plan", actionName: "BUILD_SUBMISSION_PLAN" },
    { stage: 7, label: "Match Evidence", actionName: "LINK_VAULT_EVIDENCE" },
    { stage: 8, label: "Generate Documents", actionName: "GENERATE_REQUIRED_DOCUMENTS" },
    { stage: 9, label: "Validate and Approve", actionName: "VALIDATE_DOCS" },
    { stage: 10, label: "Export ZIP", actionName: "DOWNLOAD_FINAL_ZIP" },
  ];
  return stageDefs.map((stage) => ({
    ...stage,
    actionKind: isMutationAction(stage.actionName) ? "mutation" : "readonly",
  }));
}

function shouldShowAction(stage: WorkflowStage, role: string): boolean {
  return canMutateTender(role) || stage.actionKind === "readonly";
}

const ROUTINE_AUTOMATIC_STATUS = [
  "RUN_AI_ANALYZE",
  "AI_ANALYZE",
  "REVIEW_ANALYSIS",
  "RUN_ENGINE",
  "RUN_ENGINE_OR_APPROVE_ANALYSIS",
  "BUILD_SUBMISSION_PLAN",
] as const;

const ROLE_GATED_MUTATIONS = [
  "RETRY_AI_ANALYZE",
  "RESUME_AI_ANALYZE",
  "REPAIR_METADATA",
  "RE_EXTRACT_METADATA",
  "REPAIR_SOURCE_REFERENCES",
  "REPAIR_SOURCE_GROUNDING",
  "LINK_VAULT_EVIDENCE",
  "GENERATE_REQUIRED_DOCUMENTS",
  "GENERATE_MISSING_PLANNED_DOCS",
  "VALIDATE_DOCS",
  "AUTO_FINALIZE",
  "CONTINUE_AUTO_FINALIZE",
  "RECONCILE_OUTSIDE_PLAN_DOCS",
  "EXCLUDE_OUTSIDE_PLAN_DOCS",
  "REPAIR_DOCUMENT_QUALITY",
  "APPROVE_FALLBACK_WITH_NOTE",
  "REVOKE_FALLBACK_APPROVAL",
] as const;

describe("Workflow Center API — server-derived actionKind", () => {
  const stages = buildWorkflowStages();

  it("classifies every stage", () => {
    assert.equal(stages.length, 10);
    for (const stage of stages) {
      assert.ok(stage.actionKind === "mutation" || stage.actionKind === "readonly");
    }
  });

  it("keeps automatic Analyze and Build Plan stages read-only", () => {
    for (const stageNumber of [1, 2, 3, 4, 5, 6, 10]) {
      const stage = stages.find((candidate) => candidate.stage === stageNumber);
      assert.equal(stage?.actionKind, "readonly", `Stage ${stageNumber} must be status/navigation only`);
    }
  });

  it("keeps evidence linking, generation, and validation role-gated", () => {
    for (const stageNumber of [7, 8, 9]) {
      const stage = stages.find((candidate) => candidate.stage === stageNumber);
      assert.equal(stage?.actionKind, "mutation", `Stage ${stageNumber} must remain a mutation`);
    }
  });
});

describe("REVIEWER and VIEWER restrictions", () => {
  const stages = buildWorkflowStages();

  for (const role of ["REVIEWER", "VIEWER"]) {
    it(`${role} sees status/navigation but no mutation stage controls`, () => {
      assert.equal(canMutateTender(role), false);
      for (const stage of stages) {
        assert.equal(
          shouldShowAction(stage, role),
          stage.actionKind === "readonly",
          `${role} visibility mismatch for stage ${stage.stage}`,
        );
      }
    });
  }

  it("ADMIN and PROPOSAL_MANAGER retain mutation recovery controls", () => {
    for (const role of ["ADMIN", "PROPOSAL_MANAGER"]) {
      assert.equal(canMutateTender(role), true);
      assert.equal(stages.every((stage) => shouldShowAction(stage, role)), true);
    }
  });
});

describe("AIAnalyzePanel authority", () => {
  it("has no routine Run AI Analyze mutation for any role", () => {
    const spec = getRecoveryCommandActionSpec("RUN_AI_ANALYZE");
    assert.ok(spec);
    assert.equal(spec?.kind, "scroll");
    assert.equal(isMutationAction("RUN_AI_ANALYZE"), false);
    assert.equal(shouldShowAction(buildWorkflowStages()[2], "REVIEWER"), true);
    assert.equal(shouldShowAction(buildWorkflowStages()[2], "ADMIN"), true);
  });

  it("keeps explicit retry and resume operations role-gated", () => {
    for (const action of ["RETRY_AI_ANALYZE", "RESUME_AI_ANALYZE"]) {
      assert.equal(isMutationAction(action), true);
      assert.equal(canMutateTender("REVIEWER") || !isMutationAction(action), false);
      assert.equal(canMutateTender("ADMIN") || !isMutationAction(action), true);
    }
  });
});

describe("complete role-gated mutation list", () => {
  it("classifies every actual mutation as a mutation", () => {
    for (const action of ROLE_GATED_MUTATIONS) {
      assert.equal(isMutationAction(action), true, `${action} must remain role-gated`);
    }
  });

  it("hides every actual mutation from REVIEWER", () => {
    for (const action of ROLE_GATED_MUTATIONS) {
      assert.equal(canMutateTender("REVIEWER") || !isMutationAction(action), false, `REVIEWER must not see ${action}`);
    }
  });

  it("keeps automatic status actions visible to all roles", () => {
    for (const action of ROUTINE_AUTOMATIC_STATUS) {
      assert.equal(isMutationAction(action), false, `${action} must not trigger routine work`);
      assert.ok(getRecoveryCommandActionSpec(action), `${action} must resolve to a status surface`);
      assert.equal(canMutateTender("REVIEWER") || !isMutationAction(action), true);
    }
  });
});
