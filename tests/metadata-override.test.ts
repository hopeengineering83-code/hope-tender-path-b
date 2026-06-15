// Metadata override tests.
//
// Verifies that the assessTenderMetadataCompleteness() function correctly
// applies user overrides to reduce or eliminate blocking for fields that
// are genuinely absent from the tender but have been reviewed and confirmed.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assessTenderMetadataCompleteness, type MetadataCompletenessInput } from "../lib/engine/metadata/tender-metadata-completeness";
import {
  resolvedOverrideFields,
  isFieldBlockingWithOverride,
} from "../lib/engine/metadata/metadata-override";

function baseInput(overrides: Partial<MetadataCompletenessInput> = {}): MetadataCompletenessInput {
  return {
    clientName: "Acme Corp",
    title: "Water Supply Project",
    submissionMethod: "PORTAL",
    submissionEmails: "bid@acme.gov",
    deadline: new Date("2026-12-01"),
    requirementCount: 5,
    hasEvaluationMethodology: true,
    ...overrides,
  };
}

describe("metadata-override", () => {
  it("NOT_APPLICABLE override on submissionEmails → not in missingNonCritical", () => {
    const input = baseInput({
      submissionMethod: "PHYSICAL",
      submissionEmails: null,
      submissionAddress: "123 Bid Office, Nairobi",
    });

    // Without override: submissionEmails is in missingNonCritical
    const report1 = assessTenderMetadataCompleteness(input);
    assert.ok(report1.missingNonCritical.some((f) => f.field === "submissionEmails"));

    // With NOT_APPLICABLE override: should no longer be in missingNonCritical
    const report2 = assessTenderMetadataCompleteness(input, [
      { field: "submissionEmails", fieldState: "NOT_APPLICABLE" },
    ]);
    assert.ok(!report2.missingNonCritical.some((f) => f.field === "submissionEmails"));
  });

  it("NOT_APPLICABLE on submissionEndpoint → removed from missingCritical", () => {
    const input = baseInput({
      submissionMethod: "EMAIL",
      submissionEmails: null,
      submissionAddress: null,
    });

    const report = assessTenderMetadataCompleteness(input, [
      { field: "submissionEmails", fieldState: "NOT_APPLICABLE" },
      { field: "submissionEndpoint", fieldState: "NOT_APPLICABLE" },
    ]);

    assert.ok(!report.missingNonCritical.some((f) => f.field === "submissionEmails"));
    assert.ok(!report.missingCritical.some((f) => f.field === "submissionEndpoint"));
  });

  it("USER_EDITED override → field treated as present (not in missingNonCritical)", () => {
    const input = baseInput({ reference: null });

    const report1 = assessTenderMetadataCompleteness(input);
    assert.ok(report1.missingNonCritical.some((f) => f.field === "reference"));

    const report2 = assessTenderMetadataCompleteness(input, [
      { field: "reference", fieldState: "USER_EDITED", overrideValue: "TEN-2026-001" },
    ]);
    assert.ok(!report2.missingNonCritical.some((f) => f.field === "reference"));
  });

  it("USER_CONFIRMED override → field treated as present", () => {
    const input = baseInput({ country: null });

    const report1 = assessTenderMetadataCompleteness(input);
    assert.ok(report1.missingNonCritical.some((f) => f.field === "country"));

    const report2 = assessTenderMetadataCompleteness(input, [
      { field: "country", fieldState: "USER_CONFIRMED", overrideValue: "Kenya" },
    ]);
    assert.ok(!report2.missingNonCritical.some((f) => f.field === "country"));
  });

  it("missing clientName with no override → still blocking", () => {
    const input = baseInput({ clientName: null });

    const report = assessTenderMetadataCompleteness(input);
    assert.ok(report.missingCritical.some((f) => f.field === "clientName"));
    assert.ok(report.blockingForGeneration);
  });

  it("missing clientName with NOT_APPLICABLE override → removed from missingCritical", () => {
    const input = baseInput({ clientName: null });

    const report = assessTenderMetadataCompleteness(input, [
      { field: "clientName", fieldState: "NOT_APPLICABLE", overrideValue: null },
    ]);

    assert.ok(!report.missingCritical.some((f) => f.field === "clientName"));
    assert.ok(report.notApplicableFields.some((f) => f.field === "clientName"));
  });

  it("IGNORED_WITH_REASON on clientContactName → removes from missingNonCritical", () => {
    const input = baseInput({ clientContactName: null });

    const report1 = assessTenderMetadataCompleteness(input);
    assert.ok(report1.missingNonCritical.some((f) => f.field === "clientContactName"));

    const report2 = assessTenderMetadataCompleteness(input, [
      { field: "clientContactName", fieldState: "IGNORED_WITH_REASON", overrideValue: null },
    ]);
    assert.ok(!report2.missingNonCritical.some((f) => f.field === "clientContactName"));
  });

  it("resolvedOverrideFields returns fields with resolving states", () => {
    const overrides = [
      { field: "clientName", fieldState: "NOT_APPLICABLE" },
      { field: "reference", fieldState: "USER_EDITED" },
      { field: "country", fieldState: "USER_CONFIRMED" },
      { field: "deadline", fieldState: "MISSING" }, // not resolved
      { field: "title", fieldState: "AI_EXTRACTED" }, // not resolved
    ];

    const resolved = resolvedOverrideFields(overrides);
    assert.ok(resolved.has("clientName"));
    assert.ok(resolved.has("reference"));
    assert.ok(resolved.has("country"));
    assert.ok(!resolved.has("deadline"));
    assert.ok(!resolved.has("title"));
  });

  it("isFieldBlockingWithOverride: blocking field without override stays blocking", () => {
    assert.equal(isFieldBlockingWithOverride("clientName", true, undefined), true);
  });

  it("isFieldBlockingWithOverride: NOT_APPLICABLE override removes block", () => {
    assert.equal(isFieldBlockingWithOverride("clientName", true, { fieldState: "NOT_APPLICABLE" }), false);
  });

  it("isFieldBlockingWithOverride: USER_EDITED override removes block", () => {
    assert.equal(isFieldBlockingWithOverride("clientName", true, { fieldState: "USER_EDITED" }), false);
  });

  it("isFieldBlockingWithOverride: non-blocking field stays non-blocking regardless of override", () => {
    assert.equal(isFieldBlockingWithOverride("clientName", false, undefined), false);
    assert.equal(isFieldBlockingWithOverride("clientName", false, { fieldState: "NOT_APPLICABLE" }), false);
  });

  it("notApplicableFields is present in MetadataCompletenessReport", () => {
    const input = baseInput({ clientName: null });

    const report = assessTenderMetadataCompleteness(input, [
      { field: "clientName", fieldState: "NOT_APPLICABLE" },
    ]);

    assert.ok(Array.isArray(report.notApplicableFields));
    assert.ok(report.notApplicableFields.some((f) => f.field === "clientName"));
  });

  it("without overrides, notApplicableFields is always empty", () => {
    const report = assessTenderMetadataCompleteness(baseInput());
    assert.equal(report.notApplicableFields.length, 0);
  });
});
