// Tests for fix-remaining-gaps: placeholder detection and outside-plan suggestions.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectDocumentPlaceholders,
  looksLikeMetadataPlaceholder,
  DOCUMENT_PLACEHOLDER_PATTERNS,
} from "../lib/engine/tender-metadata-completeness";

// ── Placeholder detection ────────────────────────────────────────────────────

describe("detectDocumentPlaceholders", () => {
  it("returns 0 for null/empty content", () => {
    assert.strictEqual(detectDocumentPlaceholders(null), 0);
    assert.strictEqual(detectDocumentPlaceholders(""), 0);
    assert.strictEqual(detectDocumentPlaceholders(undefined), 0);
  });

  it("counts [INSERT placeholder hits", () => {
    const content = "Please [INSERT company name] and [INSERT date].";
    const count = detectDocumentPlaceholders(content);
    assert.ok(count >= 2, `Expected >= 2, got ${count}`);
  });

  it("counts Bid-Team to confirm occurrences", () => {
    const content = "The deadline is Bid-Team to confirm. Payment: Bid-Team to confirm.";
    const count = detectDocumentPlaceholders(content);
    assert.ok(count >= 2, `Expected >= 2, got ${count}`);
  });

  it("counts TBC/TBD hits", () => {
    const content = "Reference: TBC. Budget: TBD.";
    const count = detectDocumentPlaceholders(content);
    assert.ok(count >= 2, `Expected >= 2, got ${count}`);
  });

  it("returns 0 for clean proposal text", () => {
    const content = "This technical proposal presents our approach to deliver the project on time and within budget.";
    assert.strictEqual(detectDocumentPlaceholders(content), 0);
  });
});

describe("looksLikeMetadataPlaceholder", () => {
  it("detects Bid-Team to confirm", () => {
    assert.ok(looksLikeMetadataPlaceholder("Bid-Team to confirm"));
  });

  it("detects TBC", () => {
    assert.ok(looksLikeMetadataPlaceholder("TBC"));
  });

  it("detects N/A", () => {
    assert.ok(looksLikeMetadataPlaceholder("N/A"));
  });

  it("returns false for real values", () => {
    assert.ok(!looksLikeMetadataPlaceholder("Nairobi, Kenya"));
    assert.ok(!looksLikeMetadataPlaceholder("Ministry of Finance"));
    assert.ok(!looksLikeMetadataPlaceholder("2025-12-31"));
  });

  it("returns false for null/empty", () => {
    assert.ok(!looksLikeMetadataPlaceholder(null));
    assert.ok(!looksLikeMetadataPlaceholder(""));
    assert.ok(!looksLikeMetadataPlaceholder(undefined));
  });
});

describe("DOCUMENT_PLACEHOLDER_PATTERNS superset", () => {
  it("includes [Company Name] pattern not in metadata set", () => {
    const companyPattern = DOCUMENT_PLACEHOLDER_PATTERNS.find((rx) => /Company Name/.test(rx.source));
    assert.ok(companyPattern !== undefined, "[Company Name] pattern should be in DOCUMENT_PLACEHOLDER_PATTERNS");
  });
});

// ── Outside-plan suggestions ─────────────────────────────────────────────────

