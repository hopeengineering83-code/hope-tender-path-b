import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const aiMatcher = readFileSync("lib/engine/ai-multi-perspective-matcher.ts", "utf8");

describe("currency authority current contracts", () => {
  it("does not default project rematch contract values to USD when currency is missing", () => {
    assert.doesNotMatch(aiMatcher, /p\.currency \|\| "USD"/);
    assert.doesNotMatch(aiMatcher, /p\.currency \?\? "USD"/);
    assert.match(aiMatcher, /p\.currency\?\.trim\(\) \? p\.currency : "Currency unresolved"/);
  });

  it("does not instruct AI rematch to select weak best-available references", () => {
    assert.doesNotMatch(aiMatcher, /weak but best-available candidate can still be useful/);
    assert.doesNotMatch(aiMatcher, /weak but best-available reference can still be selected/);
    assert.match(aiMatcher, /weak or below-threshold candidate must remain unselected/);
    assert.match(aiMatcher, /weak or below-threshold reference must remain unselected/);
  });
});
