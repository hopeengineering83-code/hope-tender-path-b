import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { render, screen } from "@testing-library/react";
import { MetadataCompletionPanel } from "../components/metadata-completion-panel";
import { ClientSubmissionDetailsPanel } from "../components/client-submission-details-panel";
import type { TenderReleaseSnapshot } from "../lib/engine/tender-release-snapshot";

/**
 * Component test: Both panels render snapshot fields directly.
 *
 * Scenario 1: Ungrounded manual deadline (USER_EDITED, no source) = BLOCKED
 * - Both panels must show BLOCKED status
 * - Neither panel shows green
 *
 * Scenario 2: Missing critical deadline with hasGenerationBlocker = true
 * - Completion panel never shows green
 * - Client details panel shows all fields with blocker warning
 */

// Mock fetch globally
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

test("MetadataCompletionPanel: ungrounded manual deadline shows BLOCKED", async () => {
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

  // Mock fetch
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ snapshot }),
  }) as any;

  const { container } = render(<MetadataCompletionPanel tenderId="test-tender" />);

  // Wait for async load
  await new Promise(r => setTimeout(r, 50));

  const blockerText = container.textContent;
  assert(blockerText?.includes("blocked") || blockerText?.includes("BLOCKED"), "Panel must show blocking status");
  assert(!blockerText?.includes("All critical metadata is present"), "Panel must NOT show green success message");
});

test("MetadataCompletionPanel: never shows green when hasGenerationBlocker is true", async () => {
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

  global.fetch = async () => ({
    ok: true,
    json: async () => ({ snapshot }),
  }) as any;

  const { container } = render(<MetadataCompletionPanel tenderId="test-tender" />);

  await new Promise(r => setTimeout(r, 50));

  const text = container.textContent;
  assert(!text?.includes("All critical metadata is present"), "Must never show green when blocker exists");
  assert(text?.includes("blocked") || text?.includes("Critical"), "Must show blocker warning");
});

test("ClientSubmissionDetailsPanel: ungrounded manual deadline shows BLOCKED", async () => {
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

  global.fetch = async () => ({
    ok: true,
    json: async () => ({ snapshot }),
  }) as any;

  const { container } = render(<ClientSubmissionDetailsPanel tenderId="test-tender" />);

  await new Promise(r => setTimeout(r, 50));

  const text = container.textContent;
  assert(text?.includes("BLOCKED") || text?.includes("Blocked"), "Panel must show BLOCKED status");
  assert(text?.includes("Manual deadline must be source-grounded"), "Panel must show blocker reason");
});

test("ClientSubmissionDetailsPanel: missing critical deadline with blocker shows warning", async () => {
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

  global.fetch = async () => ({
    ok: true,
    json: async () => ({ snapshot }),
  }) as any;

  const { container } = render(<ClientSubmissionDetailsPanel tenderId="test-tender" />);

  await new Promise(r => setTimeout(r, 50));

  const text = container.textContent;
  assert(text?.includes("Critical fields are blocked"), "Must show blocker warning");
  assert(text?.includes("Deadline is required"), "Must show specific blocker reason");
});
