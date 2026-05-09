import test from "node:test";
import assert from "node:assert/strict";
import { getProposalRuntimeProfile } from "../lib/ai-runtime-capability";

const ENV_KEYS = [
  "ANTHROPIC_TIER",
  "ANTHROPIC_MAX_OUTPUT_TOKENS",
  "AI_PROPOSAL_TIMEOUT_MS",
  "AI_PROPOSAL_LONG_ROUTE_ENABLED",
] as const;

function withEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>, fn: () => void) {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]])) as Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) process.env[key as (typeof ENV_KEYS)[number]] = value;
  try {
    fn();
  } finally {
    for (const key of ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("proposal runtime guard flags Tier 2-style defaults on a 60s route", () => {
  withEnv({ ANTHROPIC_TIER: "2" }, () => {
    const profile = getProposalRuntimeProfile(60);
    assert.equal(profile.maxOutputTokens, 16_000);
    assert.equal(profile.proposalAiTimeoutMs, 220_000);
    assert.equal(profile.canRunLongProposalGeneration, false);
    assert.ok(profile.warnings.some((warning) => warning.includes("16K Claude output")));
    assert.ok(profile.warnings.some((warning) => warning.includes("exceeds safe route budget")));
  });
});

test("proposal runtime guard accepts Tier 1 deploy-safe defaults on a 60s route", () => {
  withEnv({ ANTHROPIC_TIER: "1" }, () => {
    const profile = getProposalRuntimeProfile(60);
    assert.equal(profile.maxOutputTokens, 8_000);
    assert.equal(profile.proposalAiTimeoutMs, 45_000);
    assert.equal(profile.canRunLongProposalGeneration, true);
    assert.deepEqual(profile.warnings, []);
  });
});

test("proposal runtime guard accepts explicit long-route mode only with a long route budget", () => {
  withEnv({ ANTHROPIC_TIER: "2", AI_PROPOSAL_LONG_ROUTE_ENABLED: "true" }, () => {
    const profile = getProposalRuntimeProfile(300);
    assert.equal(profile.longRouteExplicitlyEnabled, true);
    assert.equal(profile.maxOutputTokens, 16_000);
    assert.equal(profile.proposalAiTimeoutMs, 220_000);
    assert.equal(profile.canRunLongProposalGeneration, true);
    assert.deepEqual(profile.warnings, []);
  });
});

test("proposal runtime guard rejects explicit Tier 1 token over-allocation", () => {
  withEnv({ ANTHROPIC_TIER: "1", ANTHROPIC_MAX_OUTPUT_TOKENS: "16000" }, () => {
    const profile = getProposalRuntimeProfile(60);
    assert.equal(profile.maxOutputTokens, 16_000);
    assert.equal(profile.canRunLongProposalGeneration, false);
    assert.ok(profile.warnings.some((warning) => warning.includes("ANTHROPIC_TIER=1")));
  });
});
