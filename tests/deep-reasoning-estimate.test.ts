// Unit tests for the pre-generation cost estimator (round 7).

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  estimateDeepReasoningCost,
  defaultMaxRefinementAttempts,
  defaultRefinementThreshold,
} from "../lib/engine/deep-reasoning-estimate";

function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(overrides)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe("estimateDeepReasoningCost — preconditions", () => {
  it("reports willRun=false with a blocker when TENDER_DEEP_REASONING is off", () => {
    const result = withEnv(
      { TENDER_DEEP_REASONING: undefined, ANTHROPIC_API_KEY: "sk-ant-test" },
      () => estimateDeepReasoningCost({
        tenderTextLength: 5000,
        expertCount: 3,
        projectCount: 4,
      }),
    );
    assert.equal(result.willRun, false);
    assert.match(result.blocker ?? "", /not enabled/i);
    assert.equal(result.typicalCalls, 0);
  });

  it("recognizes every canonical provider key, including Z.ai and Cerebras", () => {
    for (const providerKey of ["ZAI_API_KEY", "CEREBRAS_API_KEY", "MISTRAL_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY", "TOGETHER_API_KEY", "DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY"]) {
      const allKeys = {
        ZAI_API_KEY: undefined, CEREBRAS_API_KEY: undefined, MISTRAL_API_KEY: undefined,
        GROQ_API_KEY: undefined, OPENROUTER_API_KEY: undefined, GEMINI_API_KEY: undefined,
        OPENAI_API_KEY: undefined, TOGETHER_API_KEY: undefined, DEEPSEEK_API_KEY: undefined,
        ANTHROPIC_API_KEY: undefined, TENDER_DEEP_REASONING: "true",
      } as Record<string, string | undefined>;
      allKeys[providerKey] = "test-key";
      const result = withEnv(allKeys, () => estimateDeepReasoningCost({
        tenderTextLength: 500,
        expertCount: 0,
        projectCount: 0,
        maxRefinementAttempts: 0,
      }));
      assert.equal(result.willRun, true, `${providerKey} should enable the estimator gate`);
    }
  });

  it("uses the canonical provider environment list in the no-provider blocker", () => {
    const result = withEnv({
      TENDER_DEEP_REASONING: "true",
      ZAI_API_KEY: undefined, CEREBRAS_API_KEY: undefined, MISTRAL_API_KEY: undefined,
      GROQ_API_KEY: undefined, OPENROUTER_API_KEY: undefined, GEMINI_API_KEY: undefined,
      OPENAI_API_KEY: undefined, TOGETHER_API_KEY: undefined, DEEPSEEK_API_KEY: undefined,
      ANTHROPIC_API_KEY: undefined,
    }, () => estimateDeepReasoningCost({ tenderTextLength: 500, expertCount: 0, projectCount: 0 }));
    assert.equal(result.willRun, false);
    assert.match(result.blocker ?? "", /ZAI_API_KEY, CEREBRAS_API_KEY, MISTRAL_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, TOGETHER_API_KEY, DEEPSEEK_API_KEY, ANTHROPIC_API_KEY/);
  });
});

describe("estimateDeepReasoningCost — step composition", () => {
  it("includes comprehension + alignment + generation steps when all preconditions are met", () => {
    const result = withEnv(
      {
        TENDER_DEEP_REASONING: "true",
        ANTHROPIC_API_KEY: "sk-ant-test",
        PROPOSAL_GENERATION_MODE: "parallel",
        MAX_REFINEMENT_ATTEMPTS: "0",
      },
      () => estimateDeepReasoningCost({
        tenderTextLength: 5000,
        expertCount: 3,
        projectCount: 4,
        expectedInitialScore: 95, // above threshold; no refinement
      }),
    );
    assert.equal(result.willRun, true);
    assert.equal(result.blocker, null);
    const stepNames = result.steps.map((s) => s.step);
    assert.ok(stepNames.includes("comprehension"));
    assert.ok(stepNames.includes("alignment"));
    assert.ok(stepNames.some((n) => n.includes("generation")));
  });

  it("skips comprehension on tiny tender text (<200 chars)", () => {
    const result = withEnv(
      { TENDER_DEEP_REASONING: "true", ANTHROPIC_API_KEY: "sk-ant-test" },
      () => estimateDeepReasoningCost({
        tenderTextLength: 50,
        expertCount: 0,
        projectCount: 0,
      }),
    );
    assert.equal(result.steps.some((s) => s.step === "comprehension"), false);
    assert.equal(result.steps.some((s) => s.step === "alignment"), false);
  });

  it("skips alignment when no experts and no projects are selected", () => {
    const result = withEnv(
      { TENDER_DEEP_REASONING: "true", ANTHROPIC_API_KEY: "sk-ant-test" },
      () => estimateDeepReasoningCost({
        tenderTextLength: 5000,
        expertCount: 0,
        projectCount: 0,
      }),
    );
    assert.equal(result.steps.some((s) => s.step === "comprehension"), true);
    assert.equal(result.steps.some((s) => s.step === "alignment"), false);
  });

  it("adds critique + rewrite steps when initial score is below threshold", () => {
    const result = withEnv(
      {
        TENDER_DEEP_REASONING: "true",
        ANTHROPIC_API_KEY: "sk-ant-test",
        MAX_REFINEMENT_ATTEMPTS: "2",
        QUALITY_REFINEMENT_THRESHOLD: "90",
      },
      () => estimateDeepReasoningCost({
        tenderTextLength: 5000,
        expertCount: 3,
        projectCount: 4,
        expectedInitialScore: 60,
      }),
    );
    const stepNames = result.steps.map((s) => s.step);
    assert.ok(stepNames.some((n) => n.startsWith("critique")));
    assert.ok(stepNames.some((n) => n.startsWith("rewrite")));
  });

  // NOTE: the tool-use generation fan-out test is intentionally not
  // included here. `isClaudeEnabled()` reads ANTHROPIC_API_KEY at
  // module load via a captured constant, so the env override that
  // enables it cannot take effect at runtime. The branch is reachable
  // in production when ANTHROPIC_API_KEY is set at deploy time.

  it("parallel mode reports 4 generation calls; single mode reports 1", () => {
    const parallel = withEnv(
      { TENDER_DEEP_REASONING: "true", ANTHROPIC_API_KEY: "sk-ant-test", PROPOSAL_GENERATION_MODE: "parallel", MAX_REFINEMENT_ATTEMPTS: "0" },
      () => estimateDeepReasoningCost({
        tenderTextLength: 5000,
        expertCount: 3,
        projectCount: 4,
        expectedInitialScore: 95,
      }),
    );
    const single = withEnv(
      { TENDER_DEEP_REASONING: "true", ANTHROPIC_API_KEY: "sk-ant-test", PROPOSAL_GENERATION_MODE: "single", MAX_REFINEMENT_ATTEMPTS: "0" },
      () => estimateDeepReasoningCost({
        tenderTextLength: 5000,
        expertCount: 3,
        projectCount: 4,
        expectedInitialScore: 95,
      }),
    );
    const parallelGen = parallel.steps.find((s) => s.step.includes("generation"));
    const singleGen = single.steps.find((s) => s.step.includes("generation"));
    assert.equal(parallelGen?.calls, 4);
    assert.equal(singleGen?.calls, 1);
  });
});

describe("estimateDeepReasoningCost — cost guard surfacing", () => {
  it("reports the cost-guard cap when TENDER_DEEP_REASONING_MAX_CALLS is set", () => {
    const result = withEnv(
      { TENDER_DEEP_REASONING: "true", ANTHROPIC_API_KEY: "sk-ant-test", TENDER_DEEP_REASONING_MAX_CALLS: "5" },
      () => estimateDeepReasoningCost({
        tenderTextLength: 5000,
        expertCount: 3,
        projectCount: 4,
      }),
    );
    assert.equal(result.costGuard.capped, true);
    assert.equal(result.costGuard.maxCalls, 5);
  });

  it("reports cost guard NOT set when the env var is missing", () => {
    const result = withEnv(
      { TENDER_DEEP_REASONING: "true", ANTHROPIC_API_KEY: "sk-ant-test", TENDER_DEEP_REASONING_MAX_CALLS: undefined },
      () => estimateDeepReasoningCost({
        tenderTextLength: 5000,
        expertCount: 3,
        projectCount: 4,
      }),
    );
    assert.equal(result.costGuard.capped, false);
    assert.equal(result.costGuard.maxCalls, null);
  });
});

describe("defaultMaxRefinementAttempts / defaultRefinementThreshold — tier defaults", () => {
  it("Tier 1 defaults: 0 attempts, threshold 82", () => {
    withEnv({ ANTHROPIC_TIER: "1", MAX_REFINEMENT_ATTEMPTS: undefined, QUALITY_REFINEMENT_THRESHOLD: undefined }, () => {
      assert.equal(defaultMaxRefinementAttempts(), 0);
      assert.equal(defaultRefinementThreshold(), 82);
    });
  });

  it("Tier 2 (or unset) defaults: 1 attempt, threshold 90", () => {
    withEnv({ ANTHROPIC_TIER: undefined, MAX_REFINEMENT_ATTEMPTS: undefined, QUALITY_REFINEMENT_THRESHOLD: undefined }, () => {
      assert.equal(defaultMaxRefinementAttempts(), 1);
      assert.equal(defaultRefinementThreshold(), 90);
    });
  });

  it("Tier 3 defaults: 2 attempts, threshold 92", () => {
    withEnv({ ANTHROPIC_TIER: "3", MAX_REFINEMENT_ATTEMPTS: undefined, QUALITY_REFINEMENT_THRESHOLD: undefined }, () => {
      assert.equal(defaultMaxRefinementAttempts(), 2);
      assert.equal(defaultRefinementThreshold(), 92);
    });
  });

  it("explicit env-var overrides take precedence", () => {
    withEnv({ ANTHROPIC_TIER: "2", MAX_REFINEMENT_ATTEMPTS: "5", QUALITY_REFINEMENT_THRESHOLD: "75" }, () => {
      assert.equal(defaultMaxRefinementAttempts(), 5);
      assert.equal(defaultRefinementThreshold(), 75);
    });
  });
});
