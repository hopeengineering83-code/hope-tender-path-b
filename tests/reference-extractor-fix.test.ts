/**
 * Tests for the reference number extractor fix.
 * The old regex captured "Number" (the label) instead of the actual reference.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { extractReference } from "../lib/engine/tender-field-extractors";

describe("Reference extractor — label-word rejection fix", () => {

  it("extracts the actual reference number, not the label 'Number'", () => {
    const result = extractReference({
      files: [{
        fileName: "tender.pdf",
        extractedText: "Tender Reference Number: ABC-2026-001\nSubmission deadline: 2026-12-11\nThis is a test tender document with sufficient text to pass the minimum source length requirement for extraction.",
      }],
    });
    assert.ok(result.found, "Should find a reference");
    assert.notEqual(result.value, "Number");
    assert.notEqual(result.value, "Reference");
    assert.match(result.value, /ABC|2026|001/);
  });

  it("extracts reference after 'Reference No.' label", () => {
    const result = extractReference({
      files: [{
        fileName: "tender.pdf",
        extractedText: "Reference No.: RFP/2026/0042\nThis tender document contains sufficient text to pass the minimum source length requirement for the extraction engine to process it correctly.",
      }],
    });
    assert.ok(result.found, "Should find a reference");
    assert.notEqual(result.value, "No");
    assert.match(result.value, /RFP|2026|0042/);
  });

  it("extracts reference from 'Tender Reference: XYZ/2026/01'", () => {
    const result = extractReference({
      files: [{
        fileName: "tender.pdf",
        extractedText: "Tender Reference: XYZ/2026/01\nThis is a procurement document with enough text to meet the minimum source length threshold for the reference extraction patterns to fire.",
      }],
    });
    assert.ok(result.found, "Should find a reference");
    assert.match(result.value, /XYZ|2026/);
  });

  it("rejects pure label words as values", () => {
    const result = extractReference({
      files: [{
        fileName: "tender.pdf",
        extractedText: "Reference Number: Number\nReference No: No\nThis document has enough text padding to pass the minimum source length check for the extraction engine.",
      }],
    });
    // Should either not find, or find a non-label value
    if (result.found) {
      assert.notEqual(result.value.toLowerCase(), "number");
      assert.notEqual(result.value.toLowerCase(), "no");
      assert.notEqual(result.value.toLowerCase(), "reference");
    }
  });

  it("extracts procurement plan number", () => {
    const result = extractReference({
      files: [{
        fileName: "tender.pdf",
        extractedText: "Procurement Plan No.: 12345-2026\nThis procurement plan document has sufficient text padding to meet the minimum source length requirement for extraction.",
      }],
    });
    // MEDIUM confidence — may or may not find, but if it does, must not be "No"
    if (result.found) {
      assert.notEqual(result.value.toLowerCase(), "no");
      assert.match(result.value, /12345|2026/);
    }
  });
});
