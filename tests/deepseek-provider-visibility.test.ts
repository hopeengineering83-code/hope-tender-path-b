import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("DeepSeek provider visibility", () => {
  it("DeepSeek is present in the canonical order", () => {
    const policy = readFileSync("lib/ai-provider-policy.ts", "utf8");
    assert.match(policy, /"deepseek"/);
  });
});
