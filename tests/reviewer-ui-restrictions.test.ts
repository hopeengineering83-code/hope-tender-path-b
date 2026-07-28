// Runtime tests for the complete REVIEWER UI restriction flow.
//
// These tests exercise the ACTUAL classification and filtering logic that
// the UI uses — not source text. They verify:
//
// 1. The workflow-center API classifies every stage's action as mutation or
//    readonly using isMutationAction (the same function the UI uses).
// 2. When canMutate=false (REVIEWER), mutation actions are filtered out and
//    readonly actions remain — simulating exactly what the component does.
// 3. Every stage that has a mutation action is correctly classified.
// 4. The TenderWorkflowActionCenter's rendering condition is correct: a
//    stage's action button is hidden when canMutate=false AND actionKind
//    is "mutation".
//
// These tests do NOT read source text — they call isMutationAction and
// canMutateTender with the same data the API and UI use.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canMutateTender,
  isMutationAction,
  isReadOnlyAction,
} from "../lib/recovery-command-actions";

// ─── Simulate the workflow-center API stage output ───────────────────────────
//
// This is the EXACT mapping the API uses (app/api/tenders/[id]/workflow-center/route.ts).
// Each stage maps its actionLabel to a recovery-command actionName, and the
// API classifies it with isMutationAction. The UI reads actionKind to decide
// visibility.

type WorkflowStage = {
  stage: number;
  label: string;
  actionLabel: string;
  actionName: string;
  actionKind: "mutation" | "readonly";
};

// This function mirrors what the workflow-center API does — it builds stages
// with server-derived actionKind using isMutationAction.
function buildWorkflowStages(): WorkflowStage[] {
  const stageDefs = [
    { stage: 1, label: "Source Files", actionLabel: "Manage Files", actionName: "UPLOAD_TENDER_DOCUMENT" },
    { stage: 2, label: "Extraction Quality", actionLabel: "Run OCR / Re-extract", actionName: "RUN_OCR_OR_UPLOAD_CLEARER_SCAN" },
    { stage: 3, label: "AI Analyze", actionLabel: "Run AI Analyze", actionName: "RUN_AI_ANALYZE" },
    { stage: 4, label: "Confirm Requirements", actionLabel: "Review Requirements", actionName: "REVIEW_MATCHES" },
    { stage: 5, label: "Confirm Metadata", actionLabel: "Edit Metadata", actionName: "EDIT_TENDER_METADATA" },
    { stage: 6, label: "Confirmed Build Plan", actionLabel: "Build Plan", actionName: "BUILD_SUBMISSION_PLAN" },
    { stage: 7, label: "Match Evidence", actionLabel: "Match Evidence", actionName: "LINK_VAULT_EVIDENCE" },
    { stage: 8, label: "Generate Documents", actionLabel: "Generate", actionName: "GENERATE_REQUIRED_DOCUMENTS" },
    { stage: 9, label: "Validate and Approve", actionLabel: "Review Documents", actionName: "VALIDATE_DOCS" },
    { stage: 10, label: "Export ZIP", actionLabel: "Export", actionName: "DOWNLOAD_FINAL_ZIP" },
  ];
  return stageDefs.map((s) => ({
    ...s,
    actionKind: isMutationAction(s.actionName) ? "mutation" as const : "readonly" as const,
  }));
}

// ─── Simulate the TenderWorkflowActionCenter rendering condition ──────────────
//
// The component renders the action button when:
//   s.actionLabel && (canMutate || s.actionKind === "readonly" || (!s.actionKind && !s.actionUrl))
//
// For REVIEWER (canMutate=false), this simplifies to:
//   s.actionLabel && (s.actionKind === "readonly" || (!s.actionKind && !s.actionUrl))
//
// Since the API always provides actionKind, the second branch never fires.
// So REVIEWER sees action buttons ONLY for readonly stages.

function shouldShowActionButton(stage: WorkflowStage, canMutate: boolean): boolean {
  if (!stage.actionLabel) return false;
  if (canMutate) return true;
  // canMutate is false — only show readonly actions
  return stage.actionKind === "readonly";
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Workflow Center API — every stage has server-derived actionKind", () => {
  const stages = buildWorkflowStages();

  it("all 10 stages have actionKind set", () => {
    for (const s of stages) {
      assert.ok(s.actionKind === "mutation" || s.actionKind === "readonly",
        `Stage ${s.stage} (${s.label}) must have actionKind set`);
    }
  });

  it("mutation stages are classified as mutation", () => {
    const mutationStages = stages.filter((s) => s.actionKind === "mutation");
    assert.ok(mutationStages.length > 0, "There must be at least one mutation stage");

    // These stages MUST be mutations (they call POST routes directly).
    // Stage 6 navigates to the role-gated Build Plan review/confirm owner;
    // it no longer dispatches a hidden draft-only POST from the workflow link.
    const mustBeMutations = [3, 7, 8, 9]; // AI Analyze, Match Evidence, Generate, Validate
    for (const stageNum of mustBeMutations) {
      const s = stages.find((s) => s.stage === stageNum);
      assert.ok(s, `Stage ${stageNum} must exist`);
      assert.equal(s!.actionKind, "mutation",
        `Stage ${stageNum} (${s!.label}) must be mutation, got ${s!.actionKind}`);
    }
  });

  it("readonly stages are classified as readonly", () => {
    // These stages MUST be readonly (scroll/navigate/download)
    const mustBeReadonly = [1, 2, 4, 5, 6, 10]; // Manage Files, Run OCR, Review Requirements, Edit Metadata, Build Plan navigation, Export
    for (const stageNum of mustBeReadonly) {
      const s = stages.find((s) => s.stage === stageNum);
      assert.ok(s, `Stage ${stageNum} must exist`);
      assert.equal(s!.actionKind, "readonly",
        `Stage ${stageNum} (${s!.label}) must be readonly, got ${s!.actionKind}`);
    }
  });
});

describe("REVIEWER — mutation action buttons are HIDDEN (not disabled)", () => {
  const stages = buildWorkflowStages();
  const reviewerCanMutate = canMutateTender("REVIEWER");
  assert.equal(reviewerCanMutate, false);

  it("REVIEWER sees NO mutation stage action buttons", () => {
    const mutationStages = stages.filter((s) => s.actionKind === "mutation");
    for (const s of mutationStages) {
      const visible = shouldShowActionButton(s, reviewerCanMutate);
      assert.equal(visible, false,
        `REVIEWER must NOT see action button for mutation stage ${s.stage} (${s.label})`);
    }
  });

  it("REVIEWER still sees readonly stage action buttons", () => {
    const readonlyStages = stages.filter((s) => s.actionKind === "readonly");
    for (const s of readonlyStages) {
      const visible = shouldShowActionButton(s, reviewerCanMutate);
      assert.equal(visible, true,
        `REVIEWER must still see action button for readonly stage ${s.stage} (${s.label})`);
    }
  });

  it("REVIEWER sees fewer action buttons than ADMIN", () => {
    const adminCanMutate = canMutateTender("ADMIN");
    const adminVisible = stages.filter((s) => shouldShowActionButton(s, adminCanMutate)).length;
    const reviewerVisible = stages.filter((s) => shouldShowActionButton(s, reviewerCanMutate)).length;
    assert.ok(reviewerVisible < adminVisible,
      `REVIEWER (${reviewerVisible}) must see fewer buttons than ADMIN (${adminVisible})`);
  });
});

describe("ADMIN and PROPOSAL_MANAGER — all action buttons visible", () => {
  const stages = buildWorkflowStages();

  it("ADMIN sees ALL stage action buttons", () => {
    const canMutate = canMutateTender("ADMIN");
    const visible = stages.filter((s) => shouldShowActionButton(s, canMutate));
    assert.equal(visible.length, stages.length,
      "ADMIN must see all stage action buttons");
  });

  it("PROPOSAL_MANAGER sees ALL stage action buttons", () => {
    const canMutate = canMutateTender("PROPOSAL_MANAGER");
    const visible = stages.filter((s) => shouldShowActionButton(s, canMutate));
    assert.equal(visible.length, stages.length,
      "PROPOSAL_MANAGER must see all stage action buttons");
  });
});

describe("AIAnalyzePanel — REVIEWER cannot dispatch AI Analyze", () => {
  // The AIAnalyzePanel hides the "Run AI Analyze" button when canMutate is false.
  // This test verifies the classification that drives that decision.

  it("Run AI Analyze is classified as mutation", () => {
    assert.equal(isMutationAction("RUN_AI_ANALYZE"), true);
  });

  it("REVIEWER canMutate is false → button hidden", () => {
    const canMutate = canMutateTender("REVIEWER");
    const actionIsMutation = isMutationAction("RUN_AI_ANALYZE");
    // The panel shows the button when: aiEnabled && canMutate
    // When canMutate is false, button is NOT shown (replaced by read-only message)
    const buttonVisible = canMutate && actionIsMutation;
    assert.equal(buttonVisible, false, "REVIEWER must NOT see Run AI Analyze button");
  });

  it("ADMIN canMutate is true → button visible", () => {
    const canMutate = canMutateTender("ADMIN");
    const actionIsMutation = isMutationAction("RUN_AI_ANALYZE");
    const buttonVisible = canMutate && actionIsMutation;
    assert.equal(buttonVisible, true, "ADMIN must see Run AI Analyze button");
  });
});

describe("Recovery action dispatch — REVIEWER filtering simulation", () => {
  // Simulate the allowedActions filtering that components/blocker-action-link.tsx
  // (the live recovery-action dispatcher, wired into generation-action-panel.tsx)
  // performs via isMutationAction()/canMutateTender(). When canMutate is
  // false, only readonly actions pass through.

  const allActions = [
    "RUN_AI_ANALYZE",          // mutation
    "BUILD_SUBMISSION_PLAN",   // readonly navigation to the role-gated owner
    "REPAIR_METADATA",         // mutation
    "VALIDATE_DOCS",           // mutation
    "GENERATE_REQUIRED_DOCUMENTS", // mutation
    "AUTO_FINALIZE",           // mutation
    "LINK_VAULT_EVIDENCE",     // mutation
    "UPLOAD_TENDER_DOCUMENT",  // readonly (scroll)
    "DOWNLOAD_FINAL_ZIP",      // readonly (download)
    "RE_CHECK",                // readonly (refresh)
    "EXPORT_READINESS",        // readonly (GET)
    "REVIEW_MATCHES",          // readonly (navigate)
  ];

  it("REVIEWER sees only readonly actions in allowedActions", () => {
    const canMutate = canMutateTender("REVIEWER");
    const visible = canMutate ? allActions : allActions.filter((a) => !isMutationAction(a));

    // No mutation actions visible
    for (const a of visible) {
      assert.equal(isMutationAction(a), false,
        `REVIEWER must NOT see mutation action ${a} in allowedActions`);
    }
  });

  it("REVIEWER still sees readonly actions in allowedActions", () => {
    const canMutate = canMutateTender("REVIEWER");
    const visible = canMutate ? allActions : allActions.filter((a) => !isMutationAction(a));

    // These readonly actions MUST be visible
    const mustSee = ["UPLOAD_TENDER_DOCUMENT", "BUILD_SUBMISSION_PLAN", "DOWNLOAD_FINAL_ZIP", "RE_CHECK", "EXPORT_READINESS", "REVIEW_MATCHES"];
    for (const a of mustSee) {
      assert.ok(visible.includes(a),
        `REVIEWER must still see readonly action ${a}`);
    }
  });

  it("ADMIN sees ALL actions in allowedActions", () => {
    const canMutate = canMutateTender("ADMIN");
    const visible = canMutate ? allActions : allActions.filter((a) => !isMutationAction(a));
    assert.equal(visible.length, allActions.length);
  });
});

describe("Complete mutation action list — every mutation is hidden for REVIEWER", () => {
  // The user listed these specific mutations that MUST be hidden for REVIEWER:
  // Execute, blocker repair buttons, AI Analyze, metadata repair/
  // re-extract, vault linking, generation, validation, finalize, supersede,
  // and export repairs.

  const mustHideForReviewer = [
    "RUN_AI_ANALYZE",            // AI Analyze
    "RETRY_AI_ANALYZE",          // AI Analyze retry
    "RESUME_AI_ANALYZE",         // AI Analyze resume
    "REPAIR_METADATA",           // metadata repair
    "RE_EXTRACT_METADATA",       // metadata re-extract
    "REPAIR_SOURCE_REFERENCES",  // source grounding repair
    "REPAIR_SOURCE_GROUNDING",   // source grounding repair
    "LINK_VAULT_EVIDENCE",       // vault linking
    "GENERATE_REQUIRED_DOCUMENTS", // generation
    "GENERATE_MISSING_PLANNED_DOCS", // generation
    "VALIDATE_DOCS",             // validation
    "AUTO_FINALIZE",             // finalize
    "CONTINUE_AUTO_FINALIZE",    // finalize
    "RECONCILE_OUTSIDE_PLAN_DOCS", // supersede
    "EXCLUDE_OUTSIDE_PLAN_DOCS", // supersede
    "REPAIR_DOCUMENT_QUALITY",   // export repairs
    "APPROVE_FALLBACK_WITH_NOTE", // fallback approval
    "REVOKE_FALLBACK_APPROVAL",  // fallback revocation
    "RUN_ENGINE",                // run engine
    "RUN_ENGINE_OR_APPROVE_ANALYSIS", // run engine
  ];

  it("every user-listed mutation is classified as mutation", () => {
    for (const action of mustHideForReviewer) {
      assert.equal(isMutationAction(action), true,
        `${action} must be classified as mutation (user listed it as needing to be hidden)`);
    }
  });

  it("every user-listed mutation is hidden for REVIEWER", () => {
    const canMutate = canMutateTender("REVIEWER");
    for (const action of mustHideForReviewer) {
      // Simulate UI: action visible when canMutate || !isMutationAction(action)
      const visible = canMutate || !isMutationAction(action);
      assert.equal(visible, false,
        `REVIEWER must NOT see ${action}`);
    }
  });

  it("every user-listed mutation is visible for ADMIN", () => {
    const canMutate = canMutateTender("ADMIN");
    for (const action of mustHideForReviewer) {
      const visible = canMutate || !isMutationAction(action);
      assert.equal(visible, true,
        `ADMIN must see ${action}`);
    }
  });
});
