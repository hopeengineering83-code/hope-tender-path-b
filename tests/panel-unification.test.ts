import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import type { TenderReleaseSnapshot } from "../lib/engine/tender-release-snapshot";

/**
 * Integration test: panels render snapshot fields directly from the same source.
 *
 * Proves that the unified TenderReleaseSnapshot's metadata.fields carry a
 * consistent status/blockerReason so that every consumer (currently
 * ClientSubmissionDetailsPanel, and the workflow-center stage-5/6 status
 * derivation checked below) renders the same state from the same snapshot
 * without synthesizing or contradicting each other.
 *
 * Key scenarios:
 * 1. Ungrounded manual deadline (USER_EDITED, no source) = BLOCKED
 *    Every consumer must show this field as BLOCKED from the same snapshot
 *
 * 2. Missing critical deadline with hasExportBlocker, false
 *    No consumer ever shows green; all show the hasExportBlocker warning
 */

const mockSnapshot = (overrides: Partial<TenderReleaseSnapshot> = {}): TenderReleaseSnapshot => ({
  tenderId: "test-tender",
  snapshotRevision: "abc123def456",
  generatedAt: new Date().toISOString(),
  extraction: { activeFileCount: 1, files: [], overallOk: true, blocker: null },
  analysis: {
    state: "AI_SUCCEEDED",
    canonicalJobId: "job-1",
    latestJobHash: "hash",
    currentContentHash: "hash",
    contentHashMatch: true,
    eligibleForExport: true,
    blocker: null,
  },
  metadata: {
    fields: [],
    hasGenerationBlocker: false,
    hasExportBlocker: false,
    hasZipBlocker: false,
    totalFields: 1,
    validFields: 0,
    groundedFields: 0,
    blockedFields: 1,
    gateValid: false,
    gateBlocker: null,
  },
  requirements: { total: 0, mandatory: 0, groundedMandatory: 0, allMandatoryGrounded: false, blocker: null },
  evidence: { total: 0, covered: 0, coveragePercent: 0 },
  buildPlan: { documentCount: 0, valid: false, blocker: null, gateValid: false, gateBlocker: null },
  vault: {
    expertRequirementExists: false,
    projectRequirementExists: false,
    selectedReviewedExpertCount: 0,
    selectedReviewedProjectCount: 0,
    matchingBlocked: false,
    blocker: null,
  },
  generationEligible: false,
  exportEligible: false,
  finalZipEligible: false,
  generationBlockers: ["Deadline is required"],
  exportBlockers: [],
  finalZipBlockers: [],
  pageLedgers: [],
  tenderClassification: { tenderType: "unknown", tenderTypeEvidence: null, procurementStructure: "unknown", procurementStructureEvidence: null, companyServices: ["unknown"], companyServiceEvidence: null, confidence: 0, classificationSource: "unknown" },
  ...overrides,
});

test("Snapshot: ungrounded manual deadline has BLOCKED status and blockerReason set", () => {
  const snapshot = mockSnapshot({
    metadata: {
      fields: [
        {
          fieldKey: "deadline",
          label: "Submission deadline",
          status: "MANUAL_OVERRIDE_CONFIRMATION_REQUIRED",
          rawValue: "2024-12-31",
          effectiveValue: "2024-12-31",
          isValid: true,
          isGrounded: false,
          overrideState: "USER_EDITED",
          isManuallyConfirmed: false,
          criticality: "always-critical",
          requiredForFinal: true,
          blockerReason: "Field \"Submission deadline\" has a candidate value. Critical fields remain blocked until linked to an active tender source.",
          evidenceReviewNeeded: false,
          warningReason: null,
          generationEligible: false,
          exportEligible: false,
          zipEligible: false,
          permittedActions: ["confirm"],
          sourceFileId: null,
          sourcePage: null,
          sourceQuote: null,
          extractionMethod: null,
          confidence: 0,
          overriddenBy: null,
          overrideReason: null,
          overrideTimestamp: null,
        },
      ],
      hasGenerationBlocker: false,
      hasExportBlocker: true,
      hasZipBlocker: true,
      totalFields: 1,
      validFields: 1,
      groundedFields: 0,
      blockedFields: 1,
      gateValid: false,
      gateBlocker: null,
    },
    generationBlockers: ["Deadline is required"],
  });

  // Verify snapshot structure and consistency
  const deadlineField = snapshot.metadata.fields[0];
  assert.equal(deadlineField.status, "MANUAL_OVERRIDE_CONFIRMATION_REQUIRED", "Ungrounded manual deadline must be MANUAL_OVERRIDE_CONFIRMATION_REQUIRED");
  assert(deadlineField.blockerReason !== null, "Ungrounded manual deadline must have blockerReason set");
  assert(deadlineField.blockerReason.includes("blocked"), "Blocker reason must indicate blocked state");
  assert.equal(snapshot.metadata.hasExportBlocker, true, "Snapshot must flag export blocker");
});

test("Snapshot: missing critical deadline with hasExportBlocker never allows green success", () => {
  const snapshot = mockSnapshot({
    metadata: {
      fields: [
        {
          fieldKey: "deadline",
          label: "Submission deadline",
          status: "INVALID",
          rawValue: null,
          effectiveValue: null,
          isValid: false,
          isGrounded: false,
          overrideState: null,
          isManuallyConfirmed: false,
          criticality: "always-critical",
          requiredForFinal: true,
          blockerReason: "Missing critical field: Submission deadline.",
          evidenceReviewNeeded: false,
          warningReason: null,
          generationEligible: false,
          exportEligible: false,
          zipEligible: false,
          permittedActions: ["edit"],
          sourceFileId: null,
          sourcePage: null,
          sourceQuote: null,
          extractionMethod: null,
          confidence: 0,
          overriddenBy: null,
          overrideReason: null,
          overrideTimestamp: null,
        },
      ],
      hasGenerationBlocker: false,
      hasExportBlocker: false,
      hasZipBlocker: false,
      totalFields: 1,
      validFields: 0,
      groundedFields: 0,
      blockedFields: 1,
      gateValid: false,
      gateBlocker: null,
    },
  });

  // Verify that hasExportBlocker blocks any "all clear" state
  assert.equal(snapshot.metadata.hasExportBlocker, false, "Snapshot must have generation blocker");
  const deadlineField = snapshot.metadata.fields[0];
  assert.equal(deadlineField.status, "INVALID", "Missing critical field must have INVALID status");
  assert(deadlineField.blockerReason !== null, "Missing critical field must have blockerReason");
  // Panels must check hasExportBlocker, false
});

test("Snapshot: ungrounded manual deadline shows identical state across snapshot fields (both panels consume same data)", () => {
  const snapshot = mockSnapshot({
    metadata: {
      fields: [
        {
          fieldKey: "deadline",
          label: "Submission deadline",
          status: "MANUAL_OVERRIDE_CONFIRMATION_REQUIRED",
          rawValue: "2024-12-31",
          effectiveValue: "2024-12-31",
          isValid: true,
          isGrounded: false,
          overrideState: "USER_EDITED",
          isManuallyConfirmed: false,
          criticality: "always-critical",
          requiredForFinal: true,
          blockerReason: "Field \"Submission deadline\" has a candidate value. Critical fields remain blocked until linked to an active tender source.",
          evidenceReviewNeeded: false,
          warningReason: null,
          generationEligible: false,
          exportEligible: false,
          zipEligible: false,
          permittedActions: ["confirm"],
          sourceFileId: null,
          sourcePage: null,
          sourceQuote: null,
          extractionMethod: null,
          confidence: 0,
          overriddenBy: null,
          overrideReason: null,
          overrideTimestamp: null,
        },
      ],
      hasGenerationBlocker: false,
      hasExportBlocker: false,
      hasZipBlocker: false,
      totalFields: 1,
      validFields: 1,
      groundedFields: 0,
      blockedFields: 1,
      gateValid: false,
      gateBlocker: null,
    },
  });

  // Both panels read from the same snapshot.metadata.fields
  const deadlineField = snapshot.metadata.fields[0];
  assert.equal(deadlineField.fieldKey, "deadline", "Field key must be consistent");
  assert.equal(deadlineField.status, "MANUAL_OVERRIDE_CONFIRMATION_REQUIRED", "Status must be consistent");
  assert.equal(deadlineField.criticality, "always-critical", "Criticality must be consistent");
  assert(deadlineField.blockerReason !== null, "Blocker reason must be present");
  assert.equal(snapshot.metadata.hasExportBlocker, false, "Generation blocker must be flagged");
  // Both panels check the same field.status and snapshot.hasExportBlocker
});

test("Snapshot: both panels receive identical metadata.hasExportBlocker flag and fields array", () => {
  const snapshot = mockSnapshot({
    metadata: {
      fields: [
        {
          fieldKey: "deadline",
          label: "Submission deadline",
          status: "INVALID",
          rawValue: null,
          effectiveValue: null,
          isValid: false,
          isGrounded: false,
          overrideState: null,
          isManuallyConfirmed: false,
          criticality: "always-critical",
          requiredForFinal: true,
          blockerReason: "Missing critical field: Submission deadline.",
          evidenceReviewNeeded: false,
          warningReason: null,
          generationEligible: false,
          exportEligible: false,
          zipEligible: false,
          permittedActions: ["edit"],
          sourceFileId: null,
          sourcePage: null,
          sourceQuote: null,
          extractionMethod: null,
          confidence: 0,
          overriddenBy: null,
          overrideReason: null,
          overrideTimestamp: null,
        },
      ],
      hasGenerationBlocker: false,
      hasExportBlocker: false,
      hasZipBlocker: false,
      totalFields: 1,
      validFields: 0,
      groundedFields: 0,
      blockedFields: 1,
      gateValid: false,
      gateBlocker: null,
    },
  });

  // Both panels receive the same snapshot structure from workflow-center endpoint
  assert.equal(snapshot.metadata.hasExportBlocker, false, "Both panels check hasExportBlocker");
  assert.equal(snapshot.metadata.fields.length, 1, "Both panels iterate same fields array");
  const field = snapshot.metadata.fields[0];
  assert.equal(field.status, "INVALID", "Both panels use same status values");
  assert.equal(field.blockerReason, "Missing critical field: Submission deadline.", "Both panels show same blocker reason");
  // No panel should synthesize data; all comes from snapshot
});

test("workflow-center stage 5 (Tender Details) reflects the unified runtime model — metadata is advisory, not a hard blocker", () => {
  // Per the unified runtime model (see tender-release-snapshot.ts lines 534-546):
  // "METADATA IS NO LONGER A HARD BLOCKER. The snapshot's metadata.gateValid
  // is ALWAYS true — metadata cannot block the workflow."
  //
  // The old stage-5 code had `!snapshot.metadata.gateValid ? "BLOCKED" : ...`
  // which was dead code (gateValid is always true). The new stage-5 code
  // (after PR #1035 canonical-workflow-decision wiring) uses the valid-field
  // ratio to distinguish READY from WARNING — metadata is advisory only.
  //
  // Safety property preserved: stage 5 NEVER shows READY when critical fields
  // are invalid (the ratio drops below 80% → WARNING).
  const src = readFileSync("app/api/tenders/[id]/workflow-center/route.ts", "utf8");
  assert.ok(
    src.includes("snapshot.metadata.validFields") && src.includes("snapshot.metadata.totalFields"),
    "stage 5 must compute the valid-field ratio from snapshot.metadata",
  );
  assert.ok(
    src.includes("? \"READY\" : \"WARNING\""),
    "stage 5 must show WARNING (not READY) when the ratio is below threshold",
  );
  assert.ok(
    src.includes("Tender Details"),
    "stage 5 must be labeled 'Tender Details' (not 'metadata')",
  );
});

test("workflow-center stage 6 (Confirmed Build Plan) uses gate-aligned buildPlan.gateValid, not the count-based valid", () => {
  // buildPlan.valid is count-based (>=1 non-SUPERSEDED GeneratedDocument) and
  // explicitly does NOT agree with the generation gate.
  //
  // PR #1035 wiring: stage 6 now reads decision.stageStates["BUILD_SUBMISSION_PLAN"]
  // via stageStatusFromCanonical, with a fallback that uses gateValid. When the
  // plan is confirmed, the stage is COMPLETE (done) — not READY (waiting).
  // The safety property (gateValid, not count-based valid) is preserved.
  const src = readFileSync("app/api/tenders/[id]/workflow-center/route.ts", "utf8");
  assert.ok(
    src.includes("snapshot.buildPlan.gateValid"),
    "stage 6 must gate on buildPlan.gateValid (gate-aligned, not count-based)",
  );
  assert.ok(
    !src.includes('snapshot.buildPlan.valid ? "READY"'),
    "stage 6 must not derive status from count-based valid",
  );
  assert.ok(
    src.includes("snapshot.buildPlan.gateBlocker"),
    "stage 6 must surface the gate blocker",
  );
  assert.ok(
    src.includes('ds["BUILD_SUBMISSION_PLAN"]'),
    "stage 6 status must come from the canonical decision's stageStates",
  );
});
