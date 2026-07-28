// Runtime tests for canMutateTender capability and action classification.
//
// These tests exercise the ACTUAL functions — not source text. They verify:
// - canMutateTender returns true for ADMIN and PROPOSAL_MANAGER, false for REVIEWER.
// - isMutationAction correctly classifies every mutation action.
// - isReadOnlyAction correctly classifies read-only actions.
// - REVIEWER sees NO mutation actions in the registry.
// - ADMIN/PROPOSAL_MANAGER retain all actions.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canMutateTender,
  isMutationAction,
  isReadOnlyAction,
  RECOVERY_COMMAND_ACTIONS,
  getRecoveryCommandActionSpec,
} from "../lib/recovery-command-actions";

// ─── canMutateTender ─────────────────────────────────────────────────────────

describe("canMutateTender — server-derived capability", () => {
  it("returns true for ADMIN", () => {
    assert.equal(canMutateTender("ADMIN"), true);
  });

  it("returns true for PROPOSAL_MANAGER", () => {
    assert.equal(canMutateTender("PROPOSAL_MANAGER"), true);
  });

  it("returns false for REVIEWER", () => {
    assert.equal(canMutateTender("REVIEWER"), false);
  });

  it("returns false for VIEWER", () => {
    assert.equal(canMutateTender("VIEWER"), false);
  });

  it("returns false for null/undefined", () => {
    assert.equal(canMutateTender(null), false);
    assert.equal(canMutateTender(undefined), false);
  });

  it("returns false for unknown roles", () => {
    assert.equal(canMutateTender("GUEST"), false);
    assert.equal(canMutateTender(""), false);
  });
});

// ─── isMutationAction — classification ───────────────────────────────────────

describe("isMutationAction — classifies mutation actions", () => {
  // All actions that MUST be classified as mutations
  const MUTATION_ACTIONS = [
    "RUN_AI_ANALYZE",
    "RETRY_AI_ANALYZE",
    "RESUME_AI_ANALYZE",
    "AI_ANALYZE",
    "RERUN_AI_ANALYZE",
    "APPROVE_FALLBACK_WITH_NOTE",
    "REVOKE_FALLBACK_APPROVAL",
    "REPAIR_SOURCE_REFERENCES",
    "REPAIR_SOURCE_GROUNDING",
    "RUN_ENGINE",
    "RUN_ENGINE_OR_APPROVE_ANALYSIS",
    "LINK_VAULT_EVIDENCE",
    "GENERATE_REQUIRED_DOCUMENTS",
    "GENERATE_MISSING_PLANNED_DOCS",
    "REPAIR_DOCUMENT_QUALITY",
    "VALIDATE_DOCS",
    "AUTO_FINALIZE",
    "CONTINUE_AUTO_FINALIZE",
    "RECONCILE_OUTSIDE_PLAN_DOCS",
    "EXCLUDE_OUTSIDE_PLAN_DOCS",
    "REPAIR_METADATA",
    "RE_EXTRACT_METADATA",
    "REVIEW_ANALYSIS",
  ];

  for (const action of MUTATION_ACTIONS) {
    it(`classifies ${action} as a mutation`, () => {
      assert.equal(isMutationAction(action), true, `${action} MUST be a mutation`);
    });
  }

  // All actions that MUST be classified as read-only
  const READONLY_ACTIONS = [
    "UPLOAD_TENDER_DOCUMENT",
    "CONFIGURE_AI_PROVIDER",
    "DOWNLOAD_FINAL_ZIP",
    "RESOLVE_EXPORT_BLOCKERS",
    "EXPORT_READINESS",
    "RE_CHECK",
    "RECHECK_EXPORT_READINESS",
    "COMPLETE_METADATA",
    "ATTACH_OFFICIAL_ORIGINALS",
    "OPEN_EXTRACTION_QUALITY",
    "OPEN_ANALYSIS_QUALITY",
    "EDIT_TENDER",
    "EDIT_TENDER_METADATA",
    "CHANGE_BID_DECISION",
    "RUN_OCR_OR_UPLOAD_CLEARER_SCAN",
    "OPEN_COMPANY_READINESS",
    "REVIEW_MATCHES",
    "REVIEW_MATCHING_INPUTS",
    "OPEN_GENERATION_READINESS",
    "CONFIRM_SUBMISSION_PLAN",
    "REVIEW_REQUIREMENTS_OR_ADD_MANUAL_PLAN",
    "UPLOAD_TENDER_SOURCE",
    "OPEN_KNOWLEDGE_REVIEW",
    "OPEN_MATCHING_QUALITY",
    "OPEN_COMPLIANCE_REVIEW",
    "RE_UPLOAD_TENDER",
    "OPEN_SETTINGS",
    "OPEN_TENDER_DETAIL",
    "FILL_CLIENT_METADATA",
    "OPEN_DASHBOARD",
    "OPEN_TENDER_LIST",
    "SET_MANDATORY_REQUIREMENTS_OR_ADD_FILE_NAMES",
    "WAIT_FOR_CURRENT_GENERATION",
  ];

  for (const action of READONLY_ACTIONS) {
    it(`classifies ${action} as read-only`, () => {
      assert.equal(isMutationAction(action), false, `${action} MUST be read-only`);
    });
  }

  it("returns false for unknown actions", () => {
    assert.equal(isMutationAction("UNKNOWN_ACTION"), false);
    assert.equal(isMutationAction(""), false);
  });
});

// ─── isReadOnlyAction — inverse ──────────────────────────────────────────────

describe("isReadOnlyAction — inverse of isMutationAction", () => {
  it("returns true for read-only actions", () => {
    assert.equal(isReadOnlyAction("UPLOAD_TENDER_DOCUMENT"), true);
    assert.equal(isReadOnlyAction("BUILD_SUBMISSION_PLAN"), true);
    assert.equal(isReadOnlyAction("DOWNLOAD_FINAL_ZIP"), true);
    assert.equal(isReadOnlyAction("RE_CHECK"), true);
  });

  it("returns false for mutation actions", () => {
    assert.equal(isReadOnlyAction("RUN_AI_ANALYZE"), false);
    assert.equal(isReadOnlyAction("VALIDATE_DOCS"), false);
  });
});

// ─── REVIEWER sees no mutation actions ───────────────────────────────────────

describe("REVIEWER — no mutation actions visible in registry", () => {
  it("every action classified as mutation is NOT visible to REVIEWER", () => {
    const mutationActions = Object.keys(RECOVERY_COMMAND_ACTIONS).filter(isMutationAction);
    assert.ok(mutationActions.length > 0, "There must be at least one mutation action");

    // REVIEWER canMutate is false — every mutation action must be filtered out
    const reviewerCanMutate = canMutateTender("REVIEWER");
    assert.equal(reviewerCanMutate, false);

    // Simulate UI filtering: when canMutate is false, only read-only actions pass
    const visibleToReviewer = Object.keys(RECOVERY_COMMAND_ACTIONS).filter(
      (a) => reviewerCanMutate || !isMutationAction(a)
    );

    // No mutation action should be visible to REVIEWER
    for (const mutation of mutationActions) {
      assert.ok(!visibleToReviewer.includes(mutation),
        `REVIEWER must NOT see mutation action: ${mutation}`);
    }
  });

  it("ADMIN sees ALL actions including mutations", () => {
    const adminCanMutate = canMutateTender("ADMIN");
    assert.equal(adminCanMutate, true);

    const visibleToAdmin = Object.keys(RECOVERY_COMMAND_ACTIONS).filter(
      (a) => adminCanMutate || !isMutationAction(a)
    );

    // ADMIN should see every action
    assert.equal(visibleToAdmin.length, Object.keys(RECOVERY_COMMAND_ACTIONS).length);
  });

  it("PROPOSAL_MANAGER sees ALL actions including mutations", () => {
    const pmCanMutate = canMutateTender("PROPOSAL_MANAGER");
    assert.equal(pmCanMutate, true);

    const visibleToPM = Object.keys(RECOVERY_COMMAND_ACTIONS).filter(
      (a) => pmCanMutate || !isMutationAction(a)
    );

    assert.equal(visibleToPM.length, Object.keys(RECOVERY_COMMAND_ACTIONS).length);
  });
});

// ─── Read-only controls remain available for REVIEWER ────────────────────────

describe("REVIEWER — read-only controls remain available", () => {
  it("REVIEWER can still see scroll/navigate/refresh/download actions", () => {
    const reviewerCanMutate = canMutateTender("REVIEWER");
    const visibleToReviewer = Object.keys(RECOVERY_COMMAND_ACTIONS).filter(
      (a) => reviewerCanMutate || !isMutationAction(a)
    );

    // Key read-only actions that MUST remain visible
    const mustRemainVisible = [
      "UPLOAD_TENDER_DOCUMENT",   // scroll
      "CONFIGURE_AI_PROVIDER",    // navigate
      "DOWNLOAD_FINAL_ZIP",       // download (authorized)
      "RE_CHECK",                 // refresh
      "EXPORT_READINESS",         // GET api
      "RECHECK_EXPORT_READINESS", // GET api
      "OPEN_EXTRACTION_QUALITY",  // scroll
      "OPEN_ANALYSIS_QUALITY",    // scroll
      "EDIT_TENDER",              // scroll
      "REVIEW_MATCHES",           // navigate
    ];

    for (const action of mustRemainVisible) {
      assert.ok(visibleToReviewer.includes(action),
        `REVIEWER must still see read-only action: ${action}`);
    }
  });

  it("REVIEWER sees fewer actions than ADMIN (mutations removed)", () => {
    const adminVisible = Object.keys(RECOVERY_COMMAND_ACTIONS).filter(
      (a) => canMutateTender("ADMIN") || !isMutationAction(a)
    );
    const reviewerVisible = Object.keys(RECOVERY_COMMAND_ACTIONS).filter(
      (a) => canMutateTender("REVIEWER") || !isMutationAction(a)
    );

    assert.ok(reviewerVisible.length < adminVisible.length,
      `REVIEWER (${reviewerVisible.length}) must see fewer actions than ADMIN (${adminVisible.length})`);
  });
});

// ─── Every action in the registry is classifiable ────────────────────────────

describe("Registry completeness — every action is classifiable", () => {
  it("every action in RECOVERY_COMMAND_ACTIONS returns a spec from getRecoveryCommandActionSpec", () => {
    for (const action of Object.keys(RECOVERY_COMMAND_ACTIONS)) {
      const spec = getRecoveryCommandActionSpec(action);
      assert.ok(spec, `${action} must return a spec`);
    }
  });

  it("every action is either a mutation or read-only (no unclassified)", () => {
    for (const action of Object.keys(RECOVERY_COMMAND_ACTIONS)) {
      const isMutation = isMutationAction(action);
      const isReadOnly = isReadOnlyAction(action);
      assert.ok(isMutation !== isReadOnly,
        `${action} must be either mutation or read-only, got mutation=${isMutation} readonly=${isReadOnly}`);
    }
  });
});
