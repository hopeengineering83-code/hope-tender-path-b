import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("AI provider health order alignment", () => {
  it("uses the canonical order in health route", () => {
    const source = readFileSync("app/api/ai/health/route.ts", "utf8");
    assert.match(source, /CANONICAL_AI_PROVIDER_ORDER/);
  });
});
