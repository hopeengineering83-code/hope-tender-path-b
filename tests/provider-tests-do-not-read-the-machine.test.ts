/**
 * A provider test must mean the same thing on every machine.
 *
 * Two suites passed on a clean CI runner and failed on a developer machine
 * that had provider configuration in its environment:
 *
 *   ai-provider-attempt-budget      "Cerebras must be attempted at rank 5"
 *   ai-analysis-capacity-...        "CASE E: ... configured Groq"
 *
 * Neither was a routing defect. Both were the test reading its own machine:
 *
 * - The attempt-budget harness cleared `*_API_KEY` and two `*_PROPOSAL_MODEL`
 *   variables but not `*_BASE_URL`. With a Cerebras-compatible gateway
 *   configured, the router contacted that gateway - correctly, at rank 5 -
 *   and an assertion matching the vendor's hostname failed.
 *
 * - CASE E built its environment as `{ ...process.env, GROQ..., OPENAI... }`,
 *   so a third configured provider joined the chain. With Cerebras set,
 *   `configuredProviders` became `["groq", "cerebras", "openai"]` and an
 *   assertion of `slice(0, 2)` against `["groq", "openai"]` failed - even
 *   though that IS the canonical order, cerebras being rank 5, between groq
 *   at 2 and openai at 7.
 *
 * Both are now built through tests/helpers/provider-env, which clears every
 * provider-scoped variable for every provider in the chain and lets a case
 * name exactly the providers it depends on.
 *
 * This test pins the property rather than the two files: the canonical order
 * is a contract, and evidence about it must not depend on which keys the
 * person running the suite happens to hold.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { planAnalysisChunks } from "../lib/ai";
import { providerEnv, providerEnvVarNames, isolateProviderEnv } from "./helpers/provider-env";
import { CANONICAL_AI_PROVIDER_ORDER } from "../lib/ai-provider-catalog.cjs";

const CANONICAL = CANONICAL_AI_PROVIDER_ORDER as string[];

describe("provider test isolation", () => {
  it("covers every provider in the canonical chain", () => {
    const names = providerEnvVarNames();
    for (const provider of CANONICAL) {
      const prefix = provider.toUpperCase();
      for (const suffix of ["_API_KEY", "_BASE_URL", "_ANALYSIS_MODEL", "_PROPOSAL_MODEL", "_FAST_MODEL"]) {
        assert.ok(
          names.includes(`${prefix}${suffix}`),
          `${prefix}${suffix} must be cleared, or a machine holding it changes what a test observes`,
        );
      }
    }
  });

  it("removes a configured provider that the case did not name", () => {
    const restore = isolateProviderEnv({
      CEREBRAS_API_KEY: "leftover",
      CEREBRAS_BASE_URL: "https://gateway.example.invalid/v1",
      ZAI_API_KEY: "leftover",
    });
    try {
      const env = providerEnv({ GROQ_API_KEY: "k", GROQ_PROPOSAL_MODEL: "openai/gpt-oss-120b" });
      assert.equal(env.CEREBRAS_API_KEY, undefined);
      assert.equal(env.CEREBRAS_BASE_URL, undefined);
      assert.equal(env.ZAI_API_KEY, undefined);
      assert.equal(env.GROQ_API_KEY, "k");
    } finally {
      restore();
    }
  });

  it("gives the same chain whether or not the machine holds other keys", () => {
    // The exact failure, both ways round. The verdict must not move.
    // Groq carries no registry default model, so the proposal slot is named
    // too — otherwise the provider is legitimately absent and this case would
    // be measuring the fixture rather than the isolation.
    const named = {
      GROQ_API_KEY: "k",
      GROQ_PROPOSAL_MODEL: "openai/gpt-oss-120b",
      GROQ_ANALYSIS_MODEL: "openai/gpt-oss-120b",
      OPENAI_API_KEY: "k",
      OPENAI_ANALYSIS_MODEL: "gpt-4.1",
    };
    const source = "x".repeat(20_000);

    const clean = isolateProviderEnv();
    let onCleanMachine;
    try {
      onCleanMachine = planAnalysisChunks(source, providerEnv(named));
    } finally {
      clean();
    }

    const loaded = isolateProviderEnv({
      CEREBRAS_API_KEY: "leftover",
      CEREBRAS_BASE_URL: "https://gateway.example.invalid/v1",
      ANTHROPIC_API_KEY: "leftover",
      GEMINI_API_KEY: "leftover",
    });
    let onLoadedMachine;
    try {
      onLoadedMachine = planAnalysisChunks(source, providerEnv(named));
    } finally {
      loaded();
    }

    assert.deepEqual(onLoadedMachine.configuredProviders, onCleanMachine.configuredProviders);
    assert.equal(onLoadedMachine.reason, onCleanMachine.reason);
    assert.deepEqual(onLoadedMachine.configuredProviders, ["groq", "openai"]);
  });

  it("restores the machine's own configuration afterwards", () => {
    // A test that ate a developer's keys for the rest of the process would be
    // its own defect.
    const before = { ...process.env };
    const restore = isolateProviderEnv({ GROQ_API_KEY: "k" });
    restore();
    for (const name of providerEnvVarNames()) {
      assert.equal(process.env[name], before[name], `${name} must be restored`);
    }
  });

  it("orders any configured subset by canonical rank", () => {
    // The contract itself, independent of which providers a case configures.
    //
    // Each provider is configured the way that provider actually requires,
    // which is not uniform and is deliberately so — established by probing the
    // runtime while investigating the two failures above, and each documented
    // at its definition:
    //
    //   groq, openrouter  no registry default model, so a model must be named.
    //                     Groq's retired 70B default must never be reached, and
    //                     an OpenRouter identifier selects the vendor and the
    //                     price, so neither can be guessed for an operator.
    //   zai               the model identifier is shape-checked (^glm-…) before
    //                     an attempt is spent, so another vendor's identifier
    //                     pasted into ZAI_*_MODEL is refused rather than sent.
    //   everything else   the registry default applies when nothing is set.
    //
    // None of that reorders the chain, which is what this case asserts. A
    // provider whose configuration cannot build a request is absent, never
    // moved, and its model string is never substituted — an unrecognised model
    // keeps its exact value and takes the conservative capability profile.
    const modelFor: Record<string, string> = {
      groq: "openai/gpt-oss-120b",
      openrouter: "google/gemini-2.0-flash-exp",
      zai: "glm-4.6",
    };
    const subsets = [
      ["groq", "openai"],
      ["gemini", "cerebras", "anthropic"],
      ["mistral", "zai", "together", "deepseek"],
      CANONICAL,
    ];
    for (const subset of subsets) {
      const overrides: Record<string, string> = {};
      for (const provider of subset) {
        const prefix = provider.toUpperCase();
        overrides[`${prefix}_API_KEY`] = "k";
        const model = modelFor[provider];
        if (model) {
          overrides[`${prefix}_PROPOSAL_MODEL`] = model;
          overrides[`${prefix}_ANALYSIS_MODEL`] = model;
        }
      }
      const plan = planAnalysisChunks("x".repeat(4_000), providerEnv(overrides));
      const expected = CANONICAL.filter((provider) => subset.includes(provider));
      assert.deepEqual(
        plan.configuredProviders,
        expected,
        `configured subset ${JSON.stringify(subset)} must resolve in canonical order`,
      );
    }
  });

  it("keeps an unrecognised model exactly as configured", () => {
    // The contract's other half: a model this app does not recognise must not
    // be silently replaced. It keeps its exact identifier and falls back only
    // in capability profile, so the provider still participates and the
    // provider itself remains the authority on whether the model exists.
    const restore = isolateProviderEnv();
    try {
      const { resolveModelProfile } = require("../lib/ai-model-profiles");
      const profile = resolveModelProfile("cerebras", "some-model-shipped-after-this-release");
      assert.equal(profile.model, "some-model-shipped-after-this-release");
      assert.equal(profile.source, "conservative");

      const plan = planAnalysisChunks(
        "x".repeat(4_000),
        providerEnv({
          CEREBRAS_API_KEY: "k",
          CEREBRAS_ANALYSIS_MODEL: "some-model-shipped-after-this-release",
          CEREBRAS_PROPOSAL_MODEL: "some-model-shipped-after-this-release",
        }),
      );
      assert.deepEqual(
        plan.configuredProviders,
        ["cerebras"],
        "an unrecognised model must not remove a configured provider from the chain",
      );
    } finally {
      restore();
    }
  });

  it("keeps the two repaired suites off the ambient environment", () => {
    for (const file of [
      "tests/ai-provider-attempt-budget.test.ts",
      "tests/ai-analysis-capacity-concurrency-regression.test.ts",
    ]) {
      const source = readFileSync(file, "utf8");
      assert.doesNotMatch(
        source,
        /\.\.\.process\.env/,
        `${file} must not inherit the machine's provider configuration`,
      );
      assert.match(source, /provider-env/, `${file} must build its environment through the helper`);
    }
  });
});
