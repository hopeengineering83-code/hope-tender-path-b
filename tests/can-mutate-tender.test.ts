// Runtime tests for server-derived mutation capability and recovery-action classification.
// Routine AI Analyze, Engine, Build Plan, and analysis-review actions are status/navigation
// surfaces. Only exceptional retries, repairs, approvals, generation, validation, and
// finalization remain mutations.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canMutateTender,
  isMutationAction,
  isReadOnlyAction,
  RECOVERY_COMMAND_ACTIONS,
  getRecoveryCommandActionSpec,
} from "../lib/recovery-command-actions";

const MUTATION_ACTIONS = [
  "RETRY_AI_ANALYZE",
  "RESUME_AI_ANALYZE",
  "RERUN_AI_ANALYZE",
  "APPROVE_FALLBACK_WITH_NOTE",
  "REVOKE_FALLBACK_APPROVAL",
  "REPAIR_SOURCE_REFERENCES",
  "REPAIR_SOURCE_GROUNDING",
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
] as const;

const AUTOMATIC_STATUS_ACTIONS = [
  "RUN_AI_ANALYZE",
  "AI_ANALYZE",
  "REVIEW_ANALYSIS",
  "RUN_ENGINE",
  "RUN_ENGINE_OR_APPROVE_ANALYSIS",
  "BUILD_SUBMISSION_PLAN",
] as const;

const READONLY_ACTIONS = [
  ...AUTOMATIC_STATUS_ACTIONS,
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
] as const;

describe("canMutateTender — server-derived capability", () => {
  it("allows only ADMIN and PROPOSAL_MANAGER", () => {
    assert.equal(canMutateTender("ADMIN"), true);
    assert.equal(canMutateTender("PROPOSAL_MANAGER"), true);
    for (const role of ["REVIEWER", "VIEWER", "GUEST", "", null, undefined]) {
      assert.equal(canMutateTender(role), false, `${String(role)} must not mutate tenders`);
    }
  });
});

describe("action classification follows automatic-pipeline authority", () => {
  it("classifies exceptional recovery and document operations as mutations", () => {
    for (const action of MUTATION_ACTIONS) {
      assert.equal(isMutationAction(action), true, `${action} must remain a mutation`);
      assert.equal(isReadOnlyAction(action), false, `${action} must not be read-only`);
    }
  });

  it("classifies routine automatic workflow actions as status/navigation", () => {
    for (const action of AUTOMATIC_STATUS_ACTIONS) {
      const spec = getRecoveryCommandActionSpec(action);
      assert.ok(spec, `${action} must resolve to a status/navigation spec`);
      assert.equal(isMutationAction(action), false, `${action} must not dispatch routine work`);
      assert.equal(isReadOnlyAction(action), true, `${action} must be read-only`);
      assert.ok(["scroll", "navigate", "refresh"].includes(spec!.kind), `${action} must navigate to status, not POST`);
    }
  });

  it("classifies the remaining public status and navigation actions as read-only", () => {
    for (const action of READONLY_ACTIONS) {
      assert.equal(isMutationAction(action), false, `${action} must be read-only`);
      assert.equal(isReadOnlyAction(action), true, `${action} must be read-only`);
    }
  });

  it("fails closed for unknown action names", () => {
    assert.equal(isMutationAction("UNKNOWN_ACTION"), false);
    assert.equal(isReadOnlyAction("UNKNOWN_ACTION"), true);
    assert.equal(getRecoveryCommandActionSpec("UNKNOWN_ACTION"), null);
  });
});

describe("role filtering hides every actual mutation from REVIEWER", () => {
  it("keeps status/navigation visible but removes mutations", () => {
    const actions = Object.keys(RECOVERY_COMMAND_ACTIONS);
    const reviewerVisible = actions.filter((action) => canMutateTender("REVIEWER") || !isMutationAction(action));
    const adminVisible = actions.filter((action) => canMutateTender("ADMIN") || !isMutationAction(action));

    for (const action of actions.filter(isMutationAction)) {
      assert.equal(reviewerVisible.includes(action), false, `REVIEWER must not see mutation ${action}`);
      assert.equal(adminVisible.includes(action), true, `ADMIN must see mutation ${action}`);
    }
    for (const action of AUTOMATIC_STATUS_ACTIONS) {
      assert.equal(reviewerVisible.includes(action), true, `REVIEWER may inspect automatic status ${action}`);
    }
    assert.ok(reviewerVisible.length < adminVisible.length, "REVIEWER must see fewer controls than ADMIN");
  });
});

describe("registry completeness", () => {
  it("every registered action resolves and has one classification", () => {
    for (const action of Object.keys(RECOVERY_COMMAND_ACTIONS)) {
      assert.ok(getRecoveryCommandActionSpec(action), `${action} must resolve`);
      assert.notEqual(isMutationAction(action), isReadOnlyAction(action), `${action} must have one classification`);
    }
  });
});
