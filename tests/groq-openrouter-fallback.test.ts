import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("Groq and OpenRouter wiring", () => {
  it("uses the canonical order in lib/ai.ts", () => {
    const source = readFileSync("lib/ai.ts", "utf8");
    assert.match(source, /CANONICAL_AI_PROVIDER_ORDER/);
  });

  it("exposes fallback ranks in health route", () => {
    const source = readFileSync("app/api/ai/health/route.ts", "utf8");
    assert.match(source, /fallbackRank: meta\.rank/);
  });
});
