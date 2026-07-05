// Unit tests for the safe-mode text deduplication helper in run-tender-engine.ts.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { deduplicatePageText } from "../lib/engine/run-tender-engine";

describe("deduplicatePageText", () => {
  it("removes exact duplicate chunks", () => {
    const text =
      "Unique chunk A content here that is definitely longer than fifty characters total\n\n--- NEXT DOCUMENT ---\n\nUnique chunk A content here that is definitely longer than fifty characters total\n\n--- NEXT DOCUMENT ---\n\nUnique chunk B content here and this is different enough to keep";
    const result = deduplicatePageText(text);
    const count = (result.match(/--- NEXT DOCUMENT ---/g) ?? []).length;
    assert.ok(count < 2, `expected dedup to remove one duplicate, got ${count} separators`);
  });

  it("keeps truly unique chunks", () => {
    const text =
      "Chunk A content here is unique and has more than fifty characters in it\n\n--- NEXT DOCUMENT ---\n\nChunk B content here is different and also has more than fifty characters\n\n--- NEXT DOCUMENT ---\n\nChunk C content here is also unique and has more than fifty chars";
    const result = deduplicatePageText(text);
    assert.ok(result.includes("Chunk A"));
    assert.ok(result.includes("Chunk B"));
    assert.ok(result.includes("Chunk C"));
  });

  it("keeps short chunks (< 50 chars normalised) without deduping", () => {
    const text =
      "Short\n\n--- NEXT DOCUMENT ---\n\nShort\n\n--- NEXT DOCUMENT ---\n\nLong unique content that is definitely more than fifty characters to pass the threshold check";
    const result = deduplicatePageText(text);
    assert.ok(result.includes("Long unique content"));
  });

  it("handles empty input gracefully", () => {
    assert.equal(deduplicatePageText(""), "");
  });

  it("handles text without separator", () => {
    const text = "Just a single block of text with no document separators at all";
    const result = deduplicatePageText(text);
    assert.ok(result.includes("Just a single block"));
  });
});
