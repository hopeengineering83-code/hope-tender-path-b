/**
 * The Technical Approach section must be given time to be written, and no
 * provider may be handed a request it cannot accept.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * A real owner run on the Preview generated three of four proposal sections
 * with Gemini and dropped exactly one to the deterministic fallback:
 *
 *   cover-and-summary          = gemini
 *   company-and-experience     = gemini
 *   additional-and-declaration = gemini
 *   technical-approach         = fallback
 *     section "technical-approach" timed out after 30s
 *
 * The three that succeeded are the three SMALLER sections; the one that failed
 * is the largest in every tier — and it is the section a technical proposal is
 * actually judged on. The per-section timeout was a flat 30s regardless of how
 * much writing the section was asked for, so the largest section had to finish
 * in the time the smallest one needs. Measured on the live API, gemini-2.5-flash
 * emitted ~3,800 output tokens in 38,488ms (~10ms/token), so a 2,800-token
 * section could not fit in 30s: the timeout was unreachable by construction.
 *
 * Then the fallback attempt sent Groq ~12,154 tokens against its 8,000 TPM
 * limit — a request that cannot succeed. The section path called callProvider()
 * directly and so never ran the preflight gate that callAiWithFallback applies
 * before every attempt.
 *
 * These tests pin the two properties, not the numbers: bigger sections get more
 * time than smaller ones, and a payload over a provider's limit is refused
 * BEFORE dispatch rather than after wasting the call.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sectionTimeoutMsFor } from "../lib/ai";
import { preflightProvider } from "../lib/ai-preflight";
import {
  PROPOSAL_SECTION_TIMEOUT_MS,
  PROPOSAL_SECTION_TIMEOUT_CEILING_MS,
  PROPOSAL_SECTION_STITCH_RESERVE_MS,
  PROPOSAL_AI_TIMEOUT_MS,
} from "../lib/timeout-config";

describe("a section's time budget follows the writing it is asked for", () => {
  it("gives the Technical Approach section more time than the sections it outweighs", () => {
    // The exact tier budgets may change; the ordering must not. This is the
    // property whose absence produced the observed failure.
    const cover = sectionTimeoutMsFor({ maxOutputTokens: 1700 });
    const closing = sectionTimeoutMsFor({ maxOutputTokens: 1300 });
    const technicalApproach = sectionTimeoutMsFor({ maxOutputTokens: 2800 });

    assert.ok(
      technicalApproach > cover && technicalApproach > closing,
      "the largest section must not be held to the smallest section's budget",
    );
  });

  it("allows the real failing case to actually finish", () => {
    // 2,800 output tokens at the measured ~10ms/token needs ~28s of generation
    // plus time-to-first-token. The old flat 30s left nothing for TTFT, which
    // is why it fired every time.
    assert.ok(
      sectionTimeoutMsFor({ maxOutputTokens: 2800 }) > 30_000,
      "the section that timed out at 30s must now be given more than 30s",
    );
  });

  it("never shortens a section below the previous flat budget", () => {
    // Small sections were not failing. This change must not make them start.
    for (const maxOutputTokens of [0, 100, 800, 1300, 1700]) {
      assert.ok(
        sectionTimeoutMsFor({ maxOutputTokens }) >= PROPOSAL_SECTION_TIMEOUT_MS,
        `a ${maxOutputTokens}-token section must keep at least the floor budget`,
      );
    }
  });

  it("stays under the ceiling even for the largest chunked budget", () => {
    // Generation is not the whole job: validation, PDF conversion and
    // AUTO_FINALIZE run after it inside the same worker budget.
    for (const maxOutputTokens of [6500, 10_000, 100_000]) {
      assert.ok(
        sectionTimeoutMsFor({ maxOutputTokens }) <= PROPOSAL_SECTION_TIMEOUT_CEILING_MS,
        "no single section may claim more than the ceiling",
      );
    }
  });

  it("treats a missing budget as the floor rather than as zero", () => {
    assert.equal(sectionTimeoutMsFor({}), PROPOSAL_SECTION_TIMEOUT_MS);
  });

  it("leaves the caller's wrapper time to stitch the sections together", () => {
    // withProposalAiTimeout() wraps the WHOLE generation and the four sections
    // run concurrently inside it, so the slowest section sets the wall clock.
    // A section allowed to run right up to that guard leaves nothing for
    // stitching, canonical reorder and the DOCX build that follow in the same
    // wrapper — and would abort the entire proposal rather than one section.
    for (const maxOutputTokens of [2800, 6500, 10_000]) {
      const budget = sectionTimeoutMsFor({ maxOutputTokens });
      assert.ok(
        budget <= Math.max(PROPOSAL_SECTION_TIMEOUT_MS, PROPOSAL_AI_TIMEOUT_MS - PROPOSAL_SECTION_STITCH_RESERVE_MS),
        `a ${maxOutputTokens}-token section must leave the wrapper room to finish`,
      );
    }
  });
});

describe("a provider is not handed a request it cannot accept", () => {
  it("refuses the real Groq overrun before the call is dispatched", () => {
    // Roughly the payload the observed run sent: ~12,154 tokens. Groq's
    // context window is 8,192 tokens, so the binding limit is the window
    // rather than the 8,000 tokens-per-minute figure the run reported against
    // — the request was over BOTH. What matters for the defect is that the
    // refusal happens here, before the call is made, whichever limit binds.
    const oversizedPrompt = "x ".repeat(24_000); // ~12k tokens at ~4 chars/token
    const verdict = preflightProvider("groq", oversizedPrompt, { useCase: "proposal" });

    assert.equal(verdict.eligible, false, "an oversized payload must be refused before dispatch");
    assert.ok(
      verdict.reason === "CONTEXT_OVERFLOW" || verdict.reason === "TPM_LIMIT",
      `expected a capacity refusal, got ${verdict.reason}`,
    );
    assert.equal(verdict.maxOutputTokens, 0, "a refused provider must offer no output budget");
  });

  it("still admits a payload that fits", () => {
    // The gate must not become a blanket refusal — that would starve the chain.
    const verdict = preflightProvider("groq", "Write the technical approach section.", {
      useCase: "proposal",
    });
    assert.equal(verdict.eligible, true);
    assert.ok(verdict.maxOutputTokens > 0);
  });
});

describe("the section writer runs the preflight gate", () => {
  const SRC = readFileSync(path.join(process.cwd(), "lib/ai.ts"), "utf8");

  function sectionWriterSource(): string {
    const start = SRC.indexOf("async function generateOneSection(");
    assert.ok(start > 0, "generateOneSection must exist");
    const end = SRC.indexOf("\n}", SRC.indexOf("all AI providers failed or unavailable for this section"));
    return SRC.slice(start, end);
  }

  it("preflights each provider before calling it", () => {
    // The behavioural tests above prove the gate WOULD refuse the payload;
    // this proves the section path actually consults it. Calling callProvider
    // directly without preflight is the defect itself.
    const src = sectionWriterSource();
    assert.ok(src.includes("preflightProvider("), "the section path must run preflightProvider");
    // Compare against the DISPATCH call specifically. Plain "callProvider("
    // also matches this function's own explanatory comment above the loop,
    // which made an earlier version of this assertion fail on prose.
    assert.ok(
      src.indexOf("preflightProvider(") < src.indexOf("callProvider(provider,"),
      "preflight must run BEFORE dispatch, not after",
    );
  });

  it("keeps walking the canonical provider order", () => {
    // A preflight skip must move to the next provider, never reorder or
    // restrict the chain.
    const src = sectionWriterSource();
    assert.ok(src.includes("getAutomaticProviderOrder()"), "canonical order must still drive the loop");
    assert.ok(!/PROVIDER_ORDER\s*=\s*\[/.test(src), "the section path must not hardcode its own chain");
  });

  it("clamps the requested output to what preflight allows", () => {
    assert.ok(
      /Math\.min\(spec\.maxOutputTokens \?\? 4096, preflight\.maxOutputTokens/.test(sectionWriterSource()),
      "the dispatched output cap must respect the provider's own headroom",
    );
  });

  it("falls back to attempting the chain when no provider has headroom", () => {
    // Skipping an over-capacity provider is only an improvement while some
    // OTHER provider can still write the section. If the only configured
    // provider has a small context window, a preflight-ONLY loop skips
    // everything and hands the section to the deterministic fallback — the
    // exact outcome this change exists to prevent, and strictly worse than
    // letting the provider try. Provider profiles are conservative estimates,
    // not guarantees.
    //
    // Caught by tests/pipeline-produces-real-zip-end-to-end.test.ts, which
    // configures Groq alone: the first version of this fix turned that run's
    // Technical Proposal into fallback prose carrying "Bid-Team to confirm".
    const src = sectionWriterSource();
    assert.ok(/capacity-checked/.test(src) && /last-resort/.test(src), "both passes must exist");
    assert.ok(
      /pass === "capacity-checked"/.test(src),
      "the capacity filter must apply only to the first pass",
    );
  });

  it("walks the canonical order in both passes rather than reordering", () => {
    const src = sectionWriterSource();
    // Count the LOOP, not mentions of the helper — the explanatory comments
    // name it too, which made a naive count read 4.
    const loops = src.split("for (const provider of getAutomaticProviderOrder())").length - 1;
    assert.equal(loops, 1, "one loop over the canonical order, reused by both passes");
  });
});
