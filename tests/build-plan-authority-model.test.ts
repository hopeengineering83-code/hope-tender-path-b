/**
 * Authority model — behavioral tests for the BuildPlan validator's
 * draft-vs-final distinction.
 *
 * Verifies that:
 *   1. DRAFT mode: USER_EDITED on critical fields is accepted without grounding.
 *   2. FINAL mode: USER_EDITED on critical fields is accepted WITH sufficient audit.
 *   3. FINAL mode: USER_EDITED on critical fields is REJECTED without sufficient audit.
 *   4. DRAFT mode: ungrounded critical fields without override are still blocked.
 *   5. FINAL mode: ungrounded critical fields without override are blocked.
 *   6. The validator loads authority columns from the overrides array.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { validateCriticalMetadataEvidenceForBuildPlan } from "../lib/engine/build-plan";

function makeTender(overrides: Record<string, unknown> = {}) {
  return {
    title: "Test Tender",
    titleSourceFileId: "file-1",
    titleSourcePage: 1,
    titleSourceQuote: "Test Tender Title",
    clientName: "Ministry of Test",
    clientNameSourceFileId: "file-1",
    clientNameSourcePage: 1,
    clientNameSourceQuote: "Ministry of Test",
    deadline: new Date("2026-12-15"),
    deadlineSourceFileId: "file-1",
    deadlineSourcePage: 1,
    deadlineSourceQuote: "Deadline: 15 December 2026",
    submissionMethod: "Email",
    submissionMethodSourceFileId: "file-1",
    submissionMethodSourcePage: 1,
    submissionMethodSourceQuote: "Submit by email",
    submissionEmails: "test@example.com",
    submissionEmailSourceFileId: "file-1",
    submissionEmailSourcePage: 1,
    submissionEmailSourceQuote: "test@example.com",
    reference: null,
    submissionAddress: null,
    submissionEmailSubject: null,
    contactDetailsSourceJson: null,
    ...overrides,
  };
}

const activeFiles = [
  {
    id: "file-1",
    extractedText: "Test Tender Title Ministry of Test Deadline: 15 December 2026 Submit by email test@example.com",
    totalPages: 5,
  },
];

describe("build-plan validator — authority model draft vs final", () => {
  it("DRAFT mode: grounded critical fields pass (baseline)", () => {
    const result = validateCriticalMetadataEvidenceForBuildPlan(
      makeTender() as any,
      activeFiles,
      [],
      "draft",
    );
    assert.equal(result.ok, true, `Draft should pass with grounded fields: ${result.blockers.join("; ")}`);
  });

  it("DRAFT mode: USER_EDITED on critical field without grounding PASSES", () => {
    // The user manually entered a clientName that's not in the tender source.
    // Under the authority model, draft work proceeds.
    const result = validateCriticalMetadataEvidenceForBuildPlan(
      makeTender({
        clientName: null,
        clientNameSourceFileId: null,
        clientNameSourcePage: null,
        clientNameSourceQuote: null,
      }) as any,
      activeFiles,
      [{
        field: "clientName",
        fieldState: "USER_EDITED",
        overrideValue: "Manual Client Name",
        reason: "Entered manually",
        confirmationBasis: null,
      }],
      "draft",
    );
    assert.equal(result.ok, true, `Draft should pass with USER_EDITED critical field: ${result.blockers.join("; ")}`);
  });

  it("FINAL mode: USER_EDITED on critical field WITHOUT audit FAILS", () => {
    // The user manually entered a clientName but didn't provide a confirmationBasis.
    // Final export should be blocked.
    const result = validateCriticalMetadataEvidenceForBuildPlan(
      makeTender({
        clientName: null,
        clientNameSourceFileId: null,
        clientNameSourcePage: null,
        clientNameSourceQuote: null,
      }) as any,
      activeFiles,
      [{
        field: "clientName",
        fieldState: "USER_EDITED",
        overrideValue: "Manual Client Name",
        reason: "Entered manually", // < 10 chars after trim? No, it's 16 chars. But no confirmationBasis.
        confirmationBasis: null,
      }],
      "final",
    );
    assert.equal(result.ok, false, "Final should fail without confirmationBasis");
  });

  it("FINAL mode: USER_EDITED on critical field WITH sufficient audit PASSES", () => {
    // The user manually entered a clientName with a meaningful reason + confirmationBasis.
    // Final export should pass.
    const result = validateCriticalMetadataEvidenceForBuildPlan(
      makeTender({
        clientName: null,
        clientNameSourceFileId: null,
        clientNameSourcePage: null,
        clientNameSourceQuote: null,
      }) as any,
      activeFiles,
      [{
        field: "clientName",
        fieldState: "USER_EDITED",
        overrideValue: "Manual Client Name",
        reason: "Client confirmed the name during the pre-bid meeting on 2026-07-05.",
        confirmationBasis: "PRE_BID_MEETING",
      }],
      "final",
    );
    assert.equal(result.ok, true, `Final should pass with sufficient audit: ${result.blockers.join("; ")}`);
  });

  it("FINAL mode: USER_EDITED on critical field with boilerplate reason FAILS", () => {
    // The user manually entered a clientName with a boilerplate reason.
    // Final export should be blocked (isMeaningfulReason rejects boilerplate).
    const result = validateCriticalMetadataEvidenceForBuildPlan(
      makeTender({
        clientName: null,
        clientNameSourceFileId: null,
        clientNameSourcePage: null,
        clientNameSourceQuote: null,
      }) as any,
      activeFiles,
      [{
        field: "clientName",
        fieldState: "USER_EDITED",
        overrideValue: "Manual Client Name",
        reason: "Manual value entered by user.", // boilerplate
        confirmationBasis: "PRE_BID_MEETING",
      }],
      "final",
    );
    assert.equal(result.ok, false, "Final should fail with boilerplate reason");
  });

  it("DRAFT mode: missing critical field without override FAILS", () => {
    // No value, no override — the field is genuinely missing.
    // Draft work should be blocked (this is a real gap, not a manual entry).
    const result = validateCriticalMetadataEvidenceForBuildPlan(
      makeTender({
        clientName: null,
        clientNameSourceFileId: null,
        clientNameSourcePage: null,
        clientNameSourceQuote: null,
      }) as any,
      activeFiles,
      [],
      "draft",
    );
    assert.equal(result.ok, false, "Draft should fail with missing critical field and no override");
  });

  it("DRAFT mode: placeholder value FAILS (even with override)", () => {
    // A placeholder value is rejected regardless of mode.
    const result = validateCriticalMetadataEvidenceForBuildPlan(
      makeTender({
        clientName: "TBD",
        clientNameSourceFileId: null,
        clientNameSourcePage: null,
        clientNameSourceQuote: null,
      }) as any,
      activeFiles,
      [{
        field: "clientName",
        fieldState: "USER_EDITED",
        overrideValue: "TBD",
        reason: "Entered manually",
        confirmationBasis: "PRE_BID_MEETING",
      }],
      "draft",
    );
    assert.equal(result.ok, false, "Draft should fail with placeholder value");
  });

  it("FINAL mode: USER_CONFIRMED on critical field with sufficient audit PASSES", () => {
    const result = validateCriticalMetadataEvidenceForBuildPlan(
      makeTender({
        deadline: null,
        deadlineSourceFileId: null,
        deadlineSourcePage: null,
        deadlineSourceQuote: null,
      }) as any,
      activeFiles,
      [{
        field: "deadline",
        fieldState: "USER_CONFIRMED",
        overrideValue: "2026-12-15",
        reason: "Client confirmed the deadline during the pre-bid meeting.",
        confirmationBasis: "PRE_BID_MEETING",
      }],
      "final",
    );
    assert.equal(result.ok, true, `Final should pass with USER_CONFIRMED + audit: ${result.blockers.join("; ")}`);
  });

  it("DRAFT mode: default mode parameter is draft (backward compatible)", () => {
    // When mode is omitted, the default is "draft".
    const result = validateCriticalMetadataEvidenceForBuildPlan(
      makeTender({
        clientName: null,
        clientNameSourceFileId: null,
        clientNameSourcePage: null,
        clientNameSourceQuote: null,
      }) as any,
      activeFiles,
      [{
        field: "clientName",
        fieldState: "USER_EDITED",
        overrideValue: "Manual Client Name",
        reason: "Entered manually",
        confirmationBasis: null,
      }],
      // mode omitted — default is "draft"
    );
    assert.equal(result.ok, true, "Default mode should be draft (accepts manual values)");
  });
});
