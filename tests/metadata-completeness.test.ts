// Regression tests for metadata-completeness placeholder blocking and
// generate-gate integration. Proves that placeholder values, contaminated
// client names, and missing critical fields all block generation.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  assessTenderMetadataCompleteness,
  type MetadataCompletenessInput,
} from "../lib/engine/tender-metadata-completeness";

// Minimal "passing" input — used as a base for mutation tests below.
const PASSING_INPUT: MetadataCompletenessInput = {
  clientName: "Ministry of Health",
  title: "Medical Equipment Supply",
  submissionMethod: "EMAIL",
  submissionEmails: "procurement@moh.gov",
  submissionAddress: null,
  deadline: new Date(Date.now() + 86_400_000),
  requirementCount: 5,
  hasEvaluationMethodology: true,
  technicalWeight: 70,
  financialWeight: 30,
};

describe("metadata completeness — placeholder blocking", () => {
  it("flags N/A clientName as blocking", () => {
    const result = assessTenderMetadataCompleteness({
      ...PASSING_INPUT,
      clientName: "N/A",
    });
    assert.ok(
      result.blockingForGeneration,
      "N/A clientName should block generation",
    );
    assert.ok(
      result.invalidFields.some((f) => f.field === "clientName"),
      "invalidFields should include clientName",
    );
  });

  it("flags 'unknown' clientName as blocking", () => {
    const result = assessTenderMetadataCompleteness({
      ...PASSING_INPUT,
      clientName: "unknown",
    });
    assert.ok(result.blockingForGeneration, "'unknown' clientName should block");
    assert.ok(result.invalidFields.some((f) => f.field === "clientName"));
  });

  it("flags 'not specified' clientName as blocking", () => {
    const result = assessTenderMetadataCompleteness({
      ...PASSING_INPUT,
      clientName: "not specified",
    });
    assert.ok(result.blockingForGeneration);
    assert.ok(result.invalidFields.some((f) => f.field === "clientName"));
  });

  it("flags 'TBD' clientName as blocking", () => {
    const result = assessTenderMetadataCompleteness({
      ...PASSING_INPUT,
      clientName: "TBD",
    });
    assert.ok(result.blockingForGeneration, "TBD should block");
  });

  it("flags 'TBC' clientName as blocking", () => {
    const result = assessTenderMetadataCompleteness({
      ...PASSING_INPUT,
      clientName: "TBC",
    });
    assert.ok(result.blockingForGeneration, "TBC should block");
  });

  it("flags 'Bid-Team to confirm' clientName as blocking", () => {
    const result = assessTenderMetadataCompleteness({
      ...PASSING_INPUT,
      clientName: "Bid-Team to confirm",
    });
    assert.ok(result.blockingForGeneration);
    assert.ok(result.invalidFields.some((f) => f.field === "clientName"));
  });

  it("flags placeholder in clientContactEmail (non-critical warning via invalidFields)", () => {
    const result = assessTenderMetadataCompleteness({
      ...PASSING_INPUT,
      clientContactEmail: "N/A",
    });
    // N/A in a contact email is an invalid placeholder
    assert.ok(
      result.invalidFields.some((f) => f.field === "clientContactEmail"),
      "N/A clientContactEmail should appear in invalidFields",
    );
  });

  it("flags placeholder in clientContactPhone", () => {
    const result = assessTenderMetadataCompleteness({
      ...PASSING_INPUT,
      clientContactPhone: "TBD",
    });
    assert.ok(
      result.invalidFields.some((f) => f.field === "clientContactPhone"),
      "TBD clientContactPhone should appear in invalidFields",
    );
  });

  it("flags placeholder in submissionAddress", () => {
    const result = assessTenderMetadataCompleteness({
      ...PASSING_INPUT,
      submissionAddress: "to be confirmed",
    });
    assert.ok(
      result.invalidFields.some((f) => f.field === "submissionAddress"),
      "'to be confirmed' submissionAddress should appear in invalidFields",
    );
    // submissionAddress placeholder makes it invalid → blocks
    assert.ok(result.blockingForGeneration);
  });

  it("passes with real client name and complete metadata", () => {
    const result = assessTenderMetadataCompleteness(PASSING_INPUT);
    assert.ok(
      !result.blockingForGeneration,
      "real metadata should not block generation",
    );
    assert.equal(result.invalidFields.length, 0, "no invalid fields expected");
  });

  it("blocks when deadline is missing", () => {
    const result = assessTenderMetadataCompleteness({
      ...PASSING_INPUT,
      deadline: null,
    });
    assert.ok(result.blockingForGeneration);
    assert.ok(result.missingCritical.some((f) => f.field === "deadline"));
  });

  it("blocks when no requirements extracted", () => {
    const result = assessTenderMetadataCompleteness({
      ...PASSING_INPUT,
      requirementCount: 0,
    });
    assert.ok(result.blockingForGeneration);
    assert.ok(result.missingCritical.some((f) => f.field === "requiredDocuments"));
  });

  it("blocks when no submission endpoint is available", () => {
    const result = assessTenderMetadataCompleteness({
      ...PASSING_INPUT,
      submissionEmails: null,
      submissionAddress: null,
    });
    assert.ok(result.blockingForGeneration);
    assert.ok(result.missingCritical.some((f) => f.field === "submissionEndpoint"));
  });

  it("passes with physical address instead of email as submission endpoint", () => {
    const result = assessTenderMetadataCompleteness({
      ...PASSING_INPUT,
      submissionEmails: null,
      submissionAddress: "Ministry HQ, Addis Ababa",
    });
    assert.ok(!result.blockingForGeneration);
  });
});
