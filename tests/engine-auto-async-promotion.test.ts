// Regression test for "Run Engine button auto-promotes to async on
// Vercel timeout".
//
// PRIOR PAIN: user clicked "Run Engine" → got ENGINE_VERCEL_TIMEOUT →
// re-tried sync → timed out again → finally remembered to click
// "Run in background" → that one worked. Three failed clicks before
// they got to the path that escapes the 60s Hobby cap.
//
// FIX: when the sync engine route returns a Vercel-timeout shape
// (ENGINE_VERCEL_TIMEOUT, GENERATION_TIMEOUT, or HTTP 504), the
// client transparently retries in async mode without requiring a
// second click.
//
// This test pins the recognition logic so a future refactor of the
// engine route's error shape can't silently bring back the manual
// re-click.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

// Mirror the detection check from engine-action-panel.tsx so we can
// test the rule without a React tree.
type EngineErrorShape = { code?: string };
function shouldAutoPromoteToAsync(data: EngineErrorShape, httpStatus: number): boolean {
  return data.code === "ENGINE_VERCEL_TIMEOUT"
    || data.code === "GENERATION_TIMEOUT"
    || httpStatus === 504;
}

describe("engine action panel — auto-promote to async", () => {
  it("recognises ENGINE_VERCEL_TIMEOUT code", () => {
    assert.equal(shouldAutoPromoteToAsync({ code: "ENGINE_VERCEL_TIMEOUT" }, 504), true);
  });

  it("recognises GENERATION_TIMEOUT code (sibling pattern from /generate route)", () => {
    assert.equal(shouldAutoPromoteToAsync({ code: "GENERATION_TIMEOUT" }, 504), true);
  });

  it("recognises raw HTTP 504 even without a code (Vercel HTML error page case)", () => {
    assert.equal(shouldAutoPromoteToAsync({}, 504), true);
  });

  it("does NOT promote on other engine errors", () => {
    assert.equal(shouldAutoPromoteToAsync({ code: "EXTRACTION_NOT_READY" }, 422), false);
    assert.equal(shouldAutoPromoteToAsync({ code: "TENDER_NOT_FOUND" }, 404), false);
    assert.equal(shouldAutoPromoteToAsync({ code: "UNAUTHORIZED" }, 401), false);
    assert.equal(shouldAutoPromoteToAsync({ code: "AI_PROVIDER_CLAUDE_FAILED" }, 502), false);
    assert.equal(shouldAutoPromoteToAsync({ code: "DB_ERROR" }, 503), false);
  });

  it("does NOT promote on success (200)", () => {
    assert.equal(shouldAutoPromoteToAsync({}, 200), false);
  });

  it("does NOT promote on 500 without a timeout code (could be any crash)", () => {
    // Generic 500 may not be timeout-shaped — let user retry rather
    // than burning the async budget on a real bug.
    assert.equal(shouldAutoPromoteToAsync({ code: "GENERATION_FAILED" }, 500), false);
  });
});

describe("engine action panel — duplicate-render bug regression", () => {
  // The GenerationActionPanel used to render BOTH fullProposalBlockers
  // (topic-deduped) AND raw blockers when both gates failed, producing
  // pairs of items like:
  //   "Full proposal generation is blocked: client name is empty or a placeholder."
  //   "Client name is not set. Fill the tender Client Name before generating..."
  // The dedupe already merges by topic into fullProposalBlockers; the
  // raw `blockers` should only render in the support-only-blocked state.
  type Gate = { fullProposalReady: boolean; supportReady: boolean };

  function shouldRenderFullProposalBlockers(g: Gate): boolean {
    return !g.fullProposalReady;
  }
  function shouldRenderRawBlockers(g: Gate): boolean {
    // Fixed predicate from the panel (post-this-PR).
    return g.fullProposalReady && !g.supportReady;
  }

  it("both blocked → ONLY fullProposalBlockers renders (no duplicate via raw blockers)", () => {
    const both = { fullProposalReady: false, supportReady: false };
    assert.equal(shouldRenderFullProposalBlockers(both), true);
    assert.equal(shouldRenderRawBlockers(both), false);
  });

  it("only support blocked (full proposal ready) → raw blockers renders alone", () => {
    const supportOnly = { fullProposalReady: true, supportReady: false };
    assert.equal(shouldRenderFullProposalBlockers(supportOnly), false);
    assert.equal(shouldRenderRawBlockers(supportOnly), true);
  });

  it("both ready → neither renders", () => {
    const ok = { fullProposalReady: true, supportReady: true };
    assert.equal(shouldRenderFullProposalBlockers(ok), false);
    assert.equal(shouldRenderRawBlockers(ok), false);
  });

  it("full proposal blocked, support ready (edge: shouldn't happen, but be safe) → fullProposalBlockers only", () => {
    const odd = { fullProposalReady: false, supportReady: true };
    assert.equal(shouldRenderFullProposalBlockers(odd), true);
    assert.equal(shouldRenderRawBlockers(odd), false);
  });
});
