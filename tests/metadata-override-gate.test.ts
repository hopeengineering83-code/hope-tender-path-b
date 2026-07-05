// Metadata override gate integration tests.
//
// Tests that the generate route gate logic correctly uses overrides
// to unblock or block generation for specific metadata field combinations.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assessTenderMetadataCompleteness, type MetadataCompletenessInput } from "../lib/engine/tender-metadata-completeness";

function fullInput(overrides: Partial<MetadataCompletenessInput> = {}): MetadataCompletenessInput {
  return {
    clientName: "Test Authority",
    title: "Road Rehabilitation Project",
    submissionMethod: "EMAIL",
    submissionEmails: "bids@authority.go.ke",
    submissionAddress: null,
    deadline: new Date("2026-09-15"),
    requirementCount: 8,
    hasEvaluationMethodology: true,
    technicalWeight: 70,
    financialWeight: 30,
    country: "Kenya",
    clientContactName: "Jane Doe",
    clientContactEmail: "jane@authority.go.ke",
    clientContactPhone: "+254-700-000000",
    reference: "PRJ-2026-001",
    ...overrides,
  };
}

describe("metadata-override-gate", () => {
  it("submissionEmails missing, method is EMAIL, no override → endpoint check blocking", () => {
    const input = fullInput({
      submissionMethod: "EMAIL",
      submissionEmails: null,
      submissionAddress: null,
    });

    const report = assessTenderMetadataCompleteness(input);
    assert.ok(report.missingCritical.some((f) => f.field === "submissionEndpoint"));
    assert.ok(report.blockingForGeneration);
  });

  it("submissionEmails missing, method is PHYSICAL with address, NOT_APPLICABLE → not blocking", () => {
    const input = fullInput({
      submissionMethod: "PHYSICAL",
      submissionEmails: null,
      submissionAddress: "Government Procurement Office, Room 101, Nairobi",
    });

    // submissionEndpoint satisfied by address, not in missingCritical
    const report1 = assessTenderMetadataCompleteness(input);
    assert.ok(!report1.missingCritical.some((f) => f.field === "submissionEndpoint"));
    assert.ok(!report1.blockingForGeneration);

    // submissionEmails non-critical warning is removed with override
    const report2 = assessTenderMetadataCompleteness(input, [
      { field: "submissionEmails", fieldState: "NOT_APPLICABLE" },
    ]);
    assert.ok(!report2.missingNonCritical.some((f) => f.field === "submissionEmails"));
    assert.ok(!report2.blockingForGeneration);
  });

  it("manual override is a pure function — no side effects, audit log is external", () => {
    const input = fullInput({ clientName: null });

    const before = assessTenderMetadataCompleteness(input);
    assert.ok(before.missingCritical.some((f) => f.field === "clientName"));

    // Simulate what happens after an override is saved and the gate is re-run
    const after = assessTenderMetadataCompleteness(input, [
      { field: "clientName", fieldState: "USER_EDITED", overrideValue: "Nairobi City Council" },
    ]);
    assert.ok(!after.missingCritical.some((f) => f.field === "clientName"));
    assert.ok(!after.blockingForGeneration);
  });

  it("multiple overrides can unblock multiple critical fields simultaneously", () => {
    const input = fullInput({
      clientName: null,
      submissionEmails: null,
      submissionAddress: null,
    });

    const beforeReport = assessTenderMetadataCompleteness(input);
    assert.ok(beforeReport.missingCritical.length > 0);
    assert.ok(beforeReport.blockingForGeneration);

    const afterReport = assessTenderMetadataCompleteness(input, [
      { field: "clientName", fieldState: "USER_EDITED", overrideValue: "Ministry of Works" },
      { field: "submissionEndpoint", fieldState: "NOT_APPLICABLE" },
    ]);

    assert.ok(!afterReport.missingCritical.some((f) => f.field === "clientName"));
    assert.ok(!afterReport.missingCritical.some((f) => f.field === "submissionEndpoint"));
  });

  it("overrides do not suppress placeholder field detection in invalidFields", () => {
    // If a field has a placeholder value AND an override, the placeholder is still flagged
    // in invalidFields. The override affects missingCritical/missingNonCritical only.
    const input = fullInput({ clientName: "Bid-Team to confirm" });

    const report = assessTenderMetadataCompleteness(input, [
      { field: "clientName", fieldState: "USER_CONFIRMED" },
    ]);

    // clientName has placeholder language → still in invalidFields
    assert.ok(report.invalidFields.some((f) => f.field === "clientName"));
    // blockingForGeneration is true because of the placeholder (invalidFields.length > 0)
    assert.ok(report.blockingForGeneration);
  });
});
