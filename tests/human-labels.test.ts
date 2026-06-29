/**
 * Tests for the human-readable label utility.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { fieldLabel, errorCodeLabel, formatRevision } from "../lib/ui/human-labels";

describe("Human labels utility", () => {

  it("translates camelCase field names to human-readable labels", () => {
    assert.equal(fieldLabel("evaluationMethodology"), "Evaluation criteria / scoring");
    assert.equal(fieldLabel("clientContactTitle"), "Contact title");
    assert.equal(fieldLabel("referenceNumber"), "Reference number");
    assert.equal(fieldLabel("clientName"), "Client / procuring entity");
  });

  it("falls back to the original key for unknown fields", () => {
    assert.equal(fieldLabel("unknownField"), "unknownField");
  });

  it("translates error codes to human-readable messages", () => {
    assert.equal(errorCodeLabel("MISSING_REQUIRED_SECTION"), "Required document is missing");
    assert.equal(errorCodeLabel("BLOCKED_REGEX_FALLBACK"), "AI analysis used regex fallback — re-run AI analysis");
    assert.equal(errorCodeLabel("PLACEHOLDER_DETECTED"), "Placeholder text found in document");
  });

  it("falls back to the original code for unknown codes", () => {
    assert.equal(errorCodeLabel("UNKNOWN_CODE"), "UNKNOWN_CODE");
  });

  it("formats revision hashes for user display", () => {
    assert.equal(formatRevision("5f950b7c1234567890abcdef"), "Snapshot 5f950b7c");
    assert.equal(formatRevision(null), null);
    assert.equal(formatRevision(undefined), null);
    assert.equal(formatRevision("short"), null);
  });
});
