import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  analysisChunkPreflight,
  analysisFitsOneConfiguredProvider,
  buildAnalysisPromptAsSent,
  planAnalysisChunks,
} from "../lib/ai";
import { preflightProvider } from "../lib/ai-preflight";
import { protectPrompt } from "../lib/ai-trust-boundary";

/**
 * THE DEFECT.
 * -----------
 * One request was measured twice, by two different pieces of text.
 *
 * The planner (`planAnalysisChunks`, `analysisChunkPreflight`,
 * `analysisFitsOneConfiguredProvider`) preflighted the RAW analysis prompt.
 * What `generateWithFallback` actually sends — and preflights — is that prompt
 * wrapped by `protectPrompt`: a trust-boundary header, two nonce fence markers
 * and a footer. That wrapper is not free; it costs a fixed ~198 estimated
 * input tokens on top of whatever the prompt itself costs.
 *
 * So for any request whose true size lands inside that ~198-token band, the
 * planner certified a shape the runtime then refused before contact. The chain
 * reported "Prompt exceeds the configured provider throughput budget" for a
 * request the planner had just declared that same provider could take. No
 * provider was at fault and nothing was logged as wrong: both measurements
 * were internally consistent, and they measured different strings.
 *
 * This is not about one provider or one tender. It is the general rule that a
 * capacity decision must be taken against the bytes that will be sent. The
 * numbers below are expressed as relationships, not as constants, so a future
 * change to the wrapper, the margins or the model profile cannot quietly make
 * this test vacuous.
 */

/** A provider whose ceiling is tight enough that the band is reachable. */
const GROQ_ENV = {
  NODE_ENV: "test",
  PATH: process.env.PATH,
  GROQ_API_KEY: "test-key",
  GROQ_PROPOSAL_MODEL: "openai/gpt-oss-120b",
  GROQ_EXTRACTION_MODEL: "openai/gpt-oss-120b",
  GROQ_FAST_MODEL: "openai/gpt-oss-20b",
} as NodeJS.ProcessEnv;

/** Deterministic filler — content shape is irrelevant, only its size matters. */
const filler = (chars: number) => "a".repeat(chars);

/**
 * The cost `protectPrompt` adds, measured the same way preflight measures it.
 * Derived, never hard-coded: the point of the test is the relationship.
 */
function trustBoundaryOverheadTokens(): number {
  const sample = filler(1_000);
  const naked = preflightProvider("groq", sample, { useCase: "extraction", env: GROQ_ENV });
  const fenced = preflightProvider("groq", protectPrompt(sample).protectedPrompt, {
    useCase: "extraction",
    env: GROQ_ENV,
  });
  return fenced.estimatedTokens - naked.estimatedTokens;
}

describe("the analysis planner measures the prompt the runtime will send", () => {
  it("the trust boundary costs real tokens, so ignoring it is a real error", () => {
    const overhead = trustBoundaryOverheadTokens();
    assert.ok(
      overhead > 0,
      `protectPrompt must add measurable input tokens for this class of defect to exist; measured ${overhead}`,
    );
  });

  it("counts the fence, not just the prompt inside it", () => {
    // The string the planner preflights must BE the string the runtime sends.
    // generateWithFallback preflights protectPrompt(prompt).protectedPrompt, so
    // the planner's prompt must carry the same boundary header and fence
    // markers. Asserting on the text, not on a token count, is what makes this
    // fail if the wrapper is ever dropped again: the arithmetic alone cannot,
    // because the analysis template dwarfs the wrapper.
    const sent = buildAnalysisPromptAsSent("some tender text", 0, 1);
    assert.ok(sent.includes("APPLICATION TRUST BOUNDARY:"), "the measured prompt lost its trust-boundary header");
    assert.match(sent, /BEGIN_UNTRUSTED_APPLICATION_DATA_[0-9a-f-]{36}/);
    assert.match(sent, /END_UNTRUSTED_APPLICATION_DATA_[0-9a-f-]{36}/);
    assert.ok(sent.includes("some tender text"), "the tender content must still reach the provider");

    // And the estimate must reflect it: the planner's number for a chunk is the
    // fenced number, which is strictly larger than the unfenced one.
    const content = filler(4_000);
    const planner = analysisChunkPreflight("groq", content, 0, 1, GROQ_ENV);
    const unfenced = preflightProvider("groq", buildAnalysisPromptAsSent(content, 0, 1).replace(
      /APPLICATION TRUST BOUNDARY:[\s\S]*?BEGIN_UNTRUSTED_APPLICATION_DATA_[0-9a-f-]{36}\n\n/,
      "",
    ), { useCase: "extraction", env: GROQ_ENV });
    assert.ok(
      planner.estimatedTokens > unfenced.estimatedTokens,
      `fenced estimate ${planner.estimatedTokens} must exceed unfenced ${unfenced.estimatedTokens}`,
    );
  });

  it("refuses a single request that only fits once the fence is ignored", () => {
    const ceiling = analysisChunkPreflight("groq", filler(1_000), 0, 1, GROQ_ENV);
    assert.ok(ceiling.eligible, "the small control case must be eligible, or the sweep proves nothing");

    let bandSizesFound = 0;
    for (let chars = 4_000; chars <= 14_000; chars += 200) {
      const fenced = buildAnalysisPromptAsSent(filler(chars), 0, 1);
      const naked = fenced.replace(
        /APPLICATION TRUST BOUNDARY:[\s\S]*?BEGIN_UNTRUSTED_APPLICATION_DATA_[0-9a-f-]{36}\n\n/,
        "",
      );
      const nakedFits = preflightProvider("groq", naked, { useCase: "extraction", env: GROQ_ENV }).eligible;
      const planner = analysisChunkPreflight("groq", filler(chars), 0, 1, GROQ_ENV);
      // The band: the prompt the planner used to measure fits, the prompt the
      // runtime actually sends does not. Every size here was certified runnable
      // before the fix and could never have run.
      if (nakedFits && !planner.eligible) bandSizesFound++;
      // Nothing the planner certifies may be refused once the fence is counted,
      // and whatever it certifies must leave room for an answer.
      if (planner.eligible) {
        assert.equal(planner.reason, "OK", `certified ${chars} chars with reason ${planner.reason}`);
        assert.ok(
          planner.maxOutputTokens >= 2_048,
          `certified ${chars} chars with only ${planner.maxOutputTokens} output tokens — too few to carry a structured extraction`,
        );
      }
    }
    assert.ok(
      bandSizesFound > 0,
      "expected at least one size where the unfenced prompt fits and the fenced prompt does not",
    );
  });

  it("does not claim a source fits one configured provider when the sent bytes do not", () => {
    // 12,000 characters is inside the band for this model: the raw analysis
    // prompt is under the throughput ceiling, the fenced one is over it.
    const inBand = filler(12_000);
    const planner = analysisChunkPreflight("groq", inBand, 0, 1, GROQ_ENV);
    assert.equal(planner.eligible, false, "precondition: this size must be refused once the fence is counted");
    assert.equal(planner.reason, "TPM_LIMIT");

    const previousEnv = process.env;
    try {
      process.env = GROQ_ENV;
      assert.equal(
        analysisFitsOneConfiguredProvider(inBand),
        false,
        "a source no configured provider can actually receive must not be reported as fitting one",
      );
    } finally {
      process.env = previousEnv;
    }
  });

  it("never names a provider that cannot answer the chunks it planned", () => {
    // The fix must not make the planner optimistic in the other direction:
    // whatever it lists as chunk-eligible must be able to answer every chunk,
    // input AND output inside the same budget. For an 8,000-token-per-minute
    // tier and a ~4,200-token prompt template, that means a large source has
    // no chunk size that works — the template alone is repeated per chunk — so
    // the honest answer is an empty eligible set, not a split that will fail.
    const plan = planAnalysisChunks(filler(20_000), GROQ_ENV);
    for (const provider of plan.chunkEligibleProviders) {
      plan.chunks.forEach((chunk, index) => {
        const pf = analysisChunkPreflight(provider, chunk, index, plan.chunks.length, GROQ_ENV);
        assert.ok(pf.eligible, `${provider} was named eligible but cannot answer chunk ${index}: ${pf.reason}`);
        assert.ok(
          pf.maxOutputTokens >= 2_048,
          `${provider} chunk ${index} has only ${pf.maxOutputTokens} output tokens — it would burn the budget before emitting content`,
        );
      });
    }
    // Source is preserved regardless of who can carry it.
    const reconstructed = plan.chunks.reduce(
      (all, chunk, index) => all + (index === 0 ? chunk : chunk.slice(1_000)),
      "",
    );
    assert.equal(reconstructed.length >= 20_000 || plan.chunks.length === 1, true);
  });

  it("stays deterministic: the fence nonce changes but the measured size does not", () => {
    // protectPrompt mints a fresh UUID per call. UUID length is fixed, so the
    // plan for one source and one configuration must not vary between runs —
    // chunk identity and the durable snapshot hashes depend on it.
    const content = filler(9_000);
    const first = analysisChunkPreflight("groq", content, 0, 1, GROQ_ENV);
    const second = analysisChunkPreflight("groq", content, 0, 1, GROQ_ENV);
    assert.equal(first.estimatedTokens, second.estimatedTokens);
    assert.deepEqual(
      planAnalysisChunks(content, GROQ_ENV).chunks,
      planAnalysisChunks(content, GROQ_ENV).chunks,
    );
  });

  it("is a general capacity rule, not a provider-specific or sector-specific patch", () => {
    const source = require("fs").readFileSync(require("path").join(__dirname, "..", "lib", "ai.ts"), "utf8") as string;
    const helper = source.slice(source.indexOf("function buildAnalysisPromptAsSent"));
    const body = helper.slice(0, helper.indexOf("\n}"));
    for (const forbidden of ["groq", "gemini", "mistral", "hospital", "healthcare", "medical", "pharo"]) {
      assert.ok(
        !body.toLowerCase().includes(forbidden),
        `the shared prompt-sizing helper must not name ${forbidden}`,
      );
    }
  });
});
