// Tests for generation quality upgrade — gaps 2, 3, 4.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("GAP 2: Output token caps upgraded", () => {
  it("Z.ai uses STANDARD_CAPS (proposal: 16000), not CONSERVATIVE (4000)", () => {
    const src = read("lib/ai-provider-registry.ts");
    // Find the Z.ai block and check it uses STANDARD_CAPS
    const zaiIdx = src.indexOf("zai: {");
    const zaiBlock = src.slice(zaiIdx, zaiIdx + 800);
    assert.ok(
      zaiBlock.includes("STANDARD_CAPS") && !zaiBlock.includes("CONSERVATIVE_CAPS,"),
      "Z.ai must use STANDARD_CAPS for proposal generation (16000 tokens, not 4000)",
    );
  });

  it("Cerebras uses STANDARD_CAPS (proposal: 16000), not CONSERVATIVE (4000)", () => {
    const src = read("lib/ai-provider-registry.ts");
    const cerebrasIdx = src.indexOf("cerebras: {");
    const cerebrasBlock = src.slice(cerebrasIdx, cerebrasIdx + 800);
    assert.ok(
      cerebrasBlock.includes("STANDARD_CAPS") && !cerebrasBlock.includes("CONSERVATIVE_CAPS,"),
      "Cerebras must use STANDARD_CAPS for proposal generation (16000 tokens, not 4000)",
    );
  });

  it("STANDARD_CAPS has proposal: 16000", () => {
    const src = read("lib/ai-provider-registry.ts");
    assert.ok(src.includes("proposal: 16000"), "STANDARD_CAPS must have proposal: 16000");
  });

  it("generateWithZai defaults to 16000 maxTokens", () => {
    const src = read("lib/ai.ts");
    const match = src.match(/async function generateWithZai[\s\S]*?maxTokens = (\d+)/);
    assert.ok(match, "must find generateWithZai maxTokens");
    assert.equal(match[1], "16000", "generateWithZai must default to 16000 maxTokens");
  });

  it("generateWithCerebras defaults to 16000 maxTokens", () => {
    const src = read("lib/ai.ts");
    const match = src.match(/async function generateWithCerebras[\s\S]*?maxTokens = (\d+)/);
    assert.ok(match, "must find generateWithCerebras maxTokens");
    assert.equal(match[1], "16000", "generateWithCerebras must default to 16000 maxTokens");
  });
});

describe("GAP 3: Section-parallel generation is default", () => {
  it("default generationMode is 'parallel'", () => {
    const src = read("lib/engine/generate-elite.ts");
    assert.ok(
      src.includes('PROPOSAL_GENERATION_MODE || "parallel"'),
      "default generation mode must be 'parallel'",
    );
  });

  it("generateProposalSectionsParallel function exists", () => {
    const src = read("lib/ai.ts");
    assert.ok(
      src.includes("export async function generateProposalSectionsParallel"),
      "generateProposalSectionsParallel must exist",
    );
  });

  it("useParallel is used in the generation path", () => {
    const src = read("lib/engine/generate-elite.ts");
    assert.ok(src.includes("useParallel"), "must use useParallel flag");
    assert.ok(src.includes("generateProposalSectionsParallel(aiInput)"), "must call parallel path");
  });
});

describe("GAP 4: Deep reasoning auto-trigger thresholds lowered", () => {
  it("requirement threshold is 8 (was 15)", () => {
    const src = read("lib/engine/feature-flags.ts");
    assert.ok(
      src.includes("ctx.requirementCount >= 8"),
      "requirement threshold must be 8 (was 15)",
    );
  });

  it("mandatory requirement threshold is 5 (was 8)", () => {
    const src = read("lib/engine/feature-flags.ts");
    assert.ok(
      src.includes("ctx.mandatoryRequirementCount >= 5"),
      "mandatory threshold must be 5 (was 8)",
    );
  });

  it("budget threshold is 500K (was 1M)", () => {
    const src = read("lib/engine/feature-flags.ts");
    assert.ok(
      src.includes("ctx.budget >= 500_000"),
      "budget threshold must be 500K (was 1M)",
    );
  });

  it("text length threshold is 30K (was 60K)", () => {
    const src = read("lib/engine/feature-flags.ts");
    assert.ok(
      src.includes("ctx.tenderTextLength >= 30_000"),
      "text length threshold must be 30K (was 60K)",
    );
  });

  it("page threshold is 15 (was 30)", () => {
    const src = read("lib/engine/feature-flags.ts");
    assert.ok(
      src.includes("ctx.totalPages >= 15"),
      "page threshold must be 15 (was 30)",
    );
  });

  it("shouldUseDeepReasoning combines env flag + auto-trigger", () => {
    const src = read("lib/engine/feature-flags.ts");
    assert.ok(
      src.includes("isDeepReasoningEnabled() || shouldAutoTriggerDeepReasoning"),
      "must combine env flag OR auto-trigger",
    );
  });
});
