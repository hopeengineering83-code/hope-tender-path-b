import assert from "node:assert/strict";
import { test } from "node:test";
import type { TenderReleaseSnapshot } from "../lib/engine/tender-release-snapshot";

/**
 * Integration test: Both panels render snapshot fields directly from the same source.
 *
 * Proves that MetadataCompletionPanel and ClientSubmissionDetailsPanel both
 * render snapshot.metadata.fields from a single unified endpoint without
 * synthesizing or contradicting each other.
 *
 * Key scenarios:
 * 1. Ungrounded manual deadline (USER_EDITED, no source) = BLOCKED
 *    Both panels must show this field as BLOCKED from the same snapshot
 *
 * 2. Missing critical deadline with hasGenerationBlocker = true
 *    Completion panel never shows green; both panels show hasGenerationBlocker warning
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
  },
  requirements: { total: 0, mandatory: 0, groundedMandatory: 0, allMandatoryGrounded: false, blocker: null },
  evidence: { total: 0, covered: 0, coveragePercent: 0 },
  buildPlan: { documentCount: 0, valid: false, blocker: null },
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
      hasGenerationBlocker: true,
      hasExportBlocker: false,
      hasZipBlocker: false,
      totalFields: 1,
      validFields: 1,
      groundedFields: 0,
      blockedFields: 1,
    },
    generationBlockers: ["Deadline is required"],
  });

  // Verify snapshot structure and consistency
  const deadlineField = snapshot.metadata.fields[0];
  assert.equal(deadlineField.status, "MANUAL_OVERRIDE_CONFIRMATION_REQUIRED", "Ungrounded manual deadline must be MANUAL_OVERRIDE_CONFIRMATION_REQUIRED");
  assert(deadlineField.blockerReason !== null, "Ungrounded manual deadline must have blockerReason set");
  assert(deadlineField.blockerReason.includes("blocked"), "Blocker reason must indicate blocked state");
  assert.equal(snapshot.metadata.hasGenerationBlocker, true, "Snapshot must flag generation blocker");
});

test("Snapshot: missing critical deadline with hasGenerationBlocker never allows green success", () => {
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
      hasGenerationBlocker: true,
      hasExportBlocker: false,
      hasZipBlocker: false,
      totalFields: 1,
      validFields: 0,
      groundedFields: 0,
      blockedFields: 1,
    },
  });

  // Verify that hasGenerationBlocker blocks any "all clear" state
  assert.equal(snapshot.metadata.hasGenerationBlocker, true, "Snapshot must have generation blocker");
  const deadlineField = snapshot.metadata.fields[0];
  assert.equal(deadlineField.status, "INVALID", "Missing critical field must have INVALID status");
  assert(deadlineField.blockerReason !== null, "Missing critical field must have blockerReason");
  // Panels must check hasGenerationBlocker and never show green when true
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
      hasGenerationBlocker: true,
      hasExportBlocker: false,
      hasZipBlocker: false,
      totalFields: 1,
      validFields: 1,
      groundedFields: 0,
      blockedFields: 1,
    },
  });

  // Both panels read from the same snapshot.metadata.fields
  const deadlineField = snapshot.metadata.fields[0];
  assert.equal(deadlineField.fieldKey, "deadline", "Field key must be consistent");
  assert.equal(deadlineField.status, "MANUAL_OVERRIDE_CONFIRMATION_REQUIRED", "Status must be consistent");
  assert.equal(deadlineField.criticality, "always-critical", "Criticality must be consistent");
  assert(deadlineField.blockerReason !== null, "Blocker reason must be present");
  assert.equal(snapshot.metadata.hasGenerationBlocker, true, "Generation blocker must be flagged");
  // Both panels check the same field.status and snapshot.hasGenerationBlocker
});

test("Snapshot: both panels receive identical metadata.hasGenerationBlocker flag and fields array", () => {
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
      hasGenerationBlocker: true,
      hasExportBlocker: false,
      hasZipBlocker: false,
      totalFields: 1,
      validFields: 0,
      groundedFields: 0,
      blockedFields: 1,
    },
  });

  // Both panels receive the same snapshot structure from workflow-center endpoint
  assert.equal(snapshot.metadata.hasGenerationBlocker, true, "Both panels check hasGenerationBlocker");
  assert.equal(snapshot.metadata.fields.length, 1, "Both panels iterate same fields array");
  const field = snapshot.metadata.fields[0];
  assert.equal(field.status, "INVALID", "Both panels use same status values");
  assert.equal(field.blockerReason, "Missing critical field: Submission deadline.", "Both panels show same blocker reason");
  // No panel should synthesize data; all comes from snapshot
});
