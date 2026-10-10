import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const aiMatcher = readFileSync("lib/engine/ai-multi-perspective-matcher.ts", "utf8");

describe("currency authority current contracts", () => {
  it("does not default project rematch contract values to USD when currency is missing", () => {
    assert.doesNotMatch(aiMatcher, /p\.currency \|\| "USD"/);
    assert.doesNotMatch(aiMatcher, /p\.currency \?\? "USD"/);
    // The matcher uses || fallback with "currency unresolved" (lowercase).
    assert.match(aiMatcher, /currency\?\.\s*trim\(\)\s*\|\|\s*"currency unresolved"/);
  });

  it("does not instruct AI rematch to select weak best-available references", () => {
    assert.doesNotMatch(aiMatcher, /weak but best-available candidate can still be useful/);
    assert.doesNotMatch(aiMatcher, /weak but best-available reference can still be selected/);
    // The SYSTEM_PROMPT instructs the AI not to recommend unsafe/mandatory-ineligible records.
    assert.match(aiMatcher, /must not be recommended/i);
  });
});
