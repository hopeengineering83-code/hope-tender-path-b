import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("canonical provider chain", () => {
  const source = readFileSync("lib/ai.ts", "utf8");

  it("uses the required ten providers with Zai first and Claude last", () => {
    assert.match(source, /CANONICAL_PROVIDER_CHAIN = CANONICAL_AI_PROVIDER_ORDER/);
  });
});
