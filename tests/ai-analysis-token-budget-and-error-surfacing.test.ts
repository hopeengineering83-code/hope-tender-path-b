import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("lib/ai.ts", "utf8");

describe("AI analysis output-token budget", () => {
  it("defines a per-use-case output budget helper", () => {
    assert.match(source, /function maxOutputTokensForUseCase/);
  });

  it("requests a bounded (non-16K) budget for extraction/fast use cases", () => {
    const match = source.match(/function maxOutputTokensForUseCase[\s\S]*?\n}/);
    assert.ok(match, "maxOutputTokensForUseCase not found");
    const body = match[0];
    assert.match(body, /useCase === 'fast'\) return 1200/);
    assert.match(body, /return 16000/);
  });
});

describe("AI provider error surfacing", () => {
  it("surfaces per-provider reasons in the exhausted error from generateWithFallback", () => {
    const match = source.match(/export async function generateWithFallback[\s\S]*?\n}/);
    assert.ok(match, "generateWithFallback not found");
    const body = match[0];
    assert.match(body, /getProviderStateSnapshot\(provider\)/);
  });
});
