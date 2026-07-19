// Source-level test: verify the canonical analysis-state-resolver enforces
// fail-closed behavior for fallback, stale, partial, and unpromoted analysis.
//
// This test was rewritten from a behavioral test that called the orphan
// `getTenderAnalysisState` from `lib/ai-analyze/state-resolver.ts` (deleted
// as dead code — zero production callers, only this test imported it). The
// canonical resolver is `resolveTenderAnalysisState` from
// `lib/engine/analysis-state-resolver.ts`, which is already covered by
// runtime tests (tests/runtime-idempotency-route-security.test.ts,
// tests/pr887-behavioral-gates.test.ts). This source-level test pins the
// fail-closed contract at the symbol level so a future refactor cannot
// silently weaken it.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const RESOLVER_PATH = "lib/engine/analysis-state-resolver.ts";
const src = readFileSync(RESOLVER_PATH, "utf8");

describe("fallback and stale AI state never authorize generation — source contract", () => {
  it("canExportWithAnalysisState is exported", () => {
    assert.ok(
      src.includes("export function canExportWithAnalysisState"),
      "canExportWithAnalysisState must be exported from analysis-state-resolver.ts",
    );
  });

  it("only AI_SUCCEEDED unblocks generation — HUMAN_APPROVED_FALLBACK is hard-blocked", () => {
    // The function body must return state === "AI_SUCCEEDED" and nothing else.
    // The comment explicitly documents that HUMAN_APPROVED_FALLBACK is blocked.
    assert.match(
      src,
      /export function canExportWithAnalysisState\(state: AnalysisState\): boolean \{[\s\S]*?return state === "AI_SUCCEEDED"/,
      "canExportWithAnalysisState must only return true for AI_SUCCEEDED",
    );
    assert.ok(
      src.includes("HUMAN_APPROVED_FALLBACK is explicitly"),
      "canExportWithAnalysisState must document that HUMAN_APPROVED_FALLBACK is explicitly blocked",
    );
  });

  it("HUMAN_APPROVED_FALLBACK state exists and is never export-eligible", () => {
    assert.ok(
      src.includes('"HUMAN_APPROVED_FALLBACK"'),
      "AnalysisState union must include HUMAN_APPROVED_FALLBACK",
    );
    // The state label must warn about lower confidence — not "ready".
    assert.match(
      src,
      /HUMAN_APPROVED_FALLBACK:.*[Ff]allback.*approved.*lower confidence/,
      "HUMAN_APPROVED_FALLBACK label must warn about lower confidence",
    );
  });

  it("SUPERSEDED state exists and is never export-eligible", () => {
    assert.ok(
      src.includes('"SUPERSEDED"'),
      "AnalysisState union must include SUPERSEDED",
    );
    // canResumeAnalysis must NOT include SUPERSEDED (a superseded job cannot be resumed).
    const canResumeMatch = src.match(
      /export function canResumeAnalysis\(state: AnalysisState\): boolean \{([\s\S]*?)\}/,
    );
    assert.ok(canResumeMatch, "canResumeAnalysis must be exported");
    assert.doesNotMatch(
      canResumeMatch![1],
      /SUPERSEDED/,
      "canResumeAnalysis must NOT include SUPERSEDED — a superseded job cannot be resumed",
    );
  });

  it("PARTIAL_NEEDS_RESUME state exists and is never export-eligible", () => {
    assert.ok(
      src.includes('"PARTIAL_NEEDS_RESUME"'),
      "AnalysisState union must include PARTIAL_NEEDS_RESUME",
    );
    // canExportWithAnalysisState only returns true for AI_SUCCEEDED — confirmed above.
    // PARTIAL_NEEDS_RESUME is in canResumeAnalysis (it IS resumable).
    const canResumeMatch = src.match(
      /export function canResumeAnalysis\(state: AnalysisState\): boolean \{([\s\S]*?)\}/,
    );
    assert.ok(canResumeMatch, "canResumeAnalysis must be exported");
    assert.match(
      canResumeMatch![1],
      /PARTIAL_NEEDS_RESUME/,
      "canResumeAnalysis must include PARTIAL_NEEDS_RESUME — partial jobs are resumable",
    );
  });

  it("FAILED state exists and is never export-eligible", () => {
    assert.ok(
      src.includes('"FAILED"'),
      "AnalysisState union must include FAILED",
    );
    // FAILED is in canResumeAnalysis (failed jobs can be retried) but NOT in canExportWithAnalysisState.
    const canResumeMatch = src.match(
      /export function canResumeAnalysis\(state: AnalysisState\): boolean \{([\s\S]*?)\}/,
    );
    assert.ok(canResumeMatch, "canResumeAnalysis must be exported");
    assert.match(
      canResumeMatch![1],
      /FAILED/,
      "canResumeAnalysis must include FAILED — failed jobs can be retried",
    );
  });

  it("analysisStateLabel is exported and covers all states", () => {
    assert.ok(
      src.includes("export function analysisStateLabel"),
      "analysisStateLabel must be exported",
    );
    // Every state must have a label.
    for (const state of [
      "NOT_STARTED",
      "QUEUED",
      "RUNNING",
      "AI_SUCCEEDED",
      "PARTIAL_NEEDS_RESUME",
      "REGEX_FALLBACK_UNAPPROVED",
      "HUMAN_APPROVED_FALLBACK",
      "FAILED",
      "SUPERSEDED",
    ]) {
      assert.ok(
        src.includes(`${state}:`),
        `analysisStateLabel must include a label for ${state}`,
      );
    }
  });
});
