import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
const read = (p: string) => readFileSync(p, "utf8");

describe("Hobby-safe generation upgrade", () => {
  it("Z.ai uses HOBBY_SAFE_CAPS (proposal: 8000)", () => {
    const src = read("lib/ai-provider-registry.ts");
    const zaiIdx = src.indexOf("zai: {");
    const block = src.slice(zaiIdx, zaiIdx + 800);
    assert.ok(block.includes("HOBBY_SAFE_CAPS"), "Z.ai must use HOBBY_SAFE_CAPS");
  });
  it("Cerebras uses HOBBY_SAFE_CAPS (proposal: 8000)", () => {
    const src = read("lib/ai-provider-registry.ts");
    const idx = src.indexOf("cerebras: {");
    const block = src.slice(idx, idx + 800);
    assert.ok(block.includes("HOBBY_SAFE_CAPS"), "Cerebras must use HOBBY_SAFE_CAPS");
  });
  it("HOBBY_SAFE_CAPS has proposal: 8000 (NOT 16000 — too slow for 45s)", () => {
    const src = read("lib/ai-provider-registry.ts");
    assert.ok(src.includes("HOBBY_SAFE_CAPS: ProviderOutputCaps = { analysis: 8000, proposal: 8000, fast: 1200 }"));
  });
  it("generateWithZai defaults to 8000 (NOT 16000)", () => {
    const src = read("lib/ai.ts");
    const m = src.match(/async function generateWithZai[\s\S]*?maxTokens = (\d+)/);
    assert.ok(m && m[1] === "8000", "must be 8000, not 16000 (Hobby 45s limit)");
  });
  it("generateWithCerebras defaults to 8000 (NOT 16000)", () => {
    const src = read("lib/ai.ts");
    const m = src.match(/async function generateWithCerebras[\s\S]*?maxTokens = (\d+)/);
    assert.ok(m && m[1] === "8000", "must be 8000, not 16000 (Hobby 45s limit)");
  });
  it("parallel generation is the default (safe on Hobby — 4×25s = 25s wall)", () => {
    assert.ok(read("lib/engine/generate-elite.ts").includes('PROPOSAL_GENERATION_MODE || "parallel"'));
  });
  it("deep reasoning auto-trigger thresholds NOT lowered (Hobby-safe)", () => {
    const src = read("lib/engine/feature-flags.ts");
    assert.ok(src.includes("ctx.requirementCount >= 15"), "must keep 15 (not 8) — Hobby can't afford deep reasoning");
    assert.ok(src.includes("ctx.mandatoryRequirementCount >= 8"), "must keep 8 (not 5)");
  });
});
