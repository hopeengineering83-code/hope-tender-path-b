// The panel said "2 of 10 completed a real AI Analyze extraction" and, one
// line below, called all ten "not configured".
//
// Reproduced from the owner's own screenshot of the Preview at commit
// 776212cf. Both halves came from the same fetch, in the same render:
//
//   2 of 10 tested provider(s) completed a real AI Analyze extraction
//   - gemini   not configured
//   - groq     not configured
//   ... all ten ...
//
// and the positive summary was rendered in RED.
//
// CAUSE. components/ai-analyze-panel.tsx declared its own row type,
// `{ provider, configured, ok, reason, latencyMs }`, and read
// `body.anyWorking`. The live diagnostics route returns
// ProviderCapabilityReport rows — `usableForAiAnalyze`, `diagnosticState`,
// `resolvedModel`, `results[]` — and a top-level `aiAnalyzeReady`. Not one of
// those five invented names exists in the payload. `body` was `any`, so every
// read produced `undefined`: falsy for `ok` and `configured` (hence "not
// configured" on every row) and falsy for `anyWorking` (hence red).
//
// The summary was right because it is computed server-side from the real
// measurements. Only the rendering of those measurements was wrong, which is
// the worst shape for this failure: the panel looked confidently informative.
//
// THE FIX is not a renamed field. The route now EXPORTS its response type and
// the panel imports it, so the shape is checked by the compiler instead of
// discovered in a screenshot. Verified: restoring the old local type makes
// `npx tsc --noEmit` fail with "Property 'usableForAiAnalyze' does not exist",
// "Property 'results' does not exist" and "Property 'resolvedModel' does not
// exist".
//
// This is the fourth "absent key read as an observation" in this workstream.
// The first three were in throwaway probe scripts; this one shipped to the
// owner's screen.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const PANEL = readFileSync("components/ai-analyze-panel.tsx", "utf8");
const ROUTE = readFileSync("app/api/ai-providers/diagnostics/route.ts", "utf8");

describe("the provider diagnostics panel reads the contract the route sends", () => {
  it("the route exports its live response type", () => {
    assert.match(ROUTE, /export type LiveProviderDiagnosticsResponse = \{/);
    // And the handler is annotated with it, so the route cannot drift either.
    assert.match(ROUTE, /const payload: LiveProviderDiagnosticsResponse = \{/);
  });

  it("the panel derives its row type from the route instead of declaring one", () => {
    assert.match(
      PANEL,
      /import type \{ LiveProviderDiagnosticsResponse \} from "\.\.\/app\/api\/ai-providers\/diagnostics\/route"/,
    );
    assert.match(PANEL, /type ProviderDiag = LiveProviderDiagnosticsResponse\["perProvider"\]\[number\]/);
  });

  it("none of the five invented field names is read again", () => {
    // Each of these produced `undefined` against the real payload. They are
    // checked as property ACCESSES on a provider row, not as bare words, so
    // the test does not trip over unrelated identifiers.
    for (const invented of ["provider.ok", "provider.configured", "provider.reason", "provider.latencyMs"]) {
      assert.equal(
        PANEL.includes(invented),
        false,
        `${invented} does not exist on the diagnostics payload and always read undefined`,
      );
    }
    // Property ACCESSES, not the bare word: the comment above this component
    // names the old field on purpose, and a test that cannot tell an
    // explanation from a use is a test that will be deleted the first time it
    // cries wolf.
    for (const invented of ["body.anyWorking", "diag.anyWorking"]) {
      assert.equal(
        PANEL.includes(invented),
        false,
        `${invented} never existed on the payload, which is why a positive summary rendered red`,
      );
    }
  });

  it("readiness is decided by the analysis capability, not by connectivity", () => {
    // The distinction the capability test exists to draw: a provider that
    // answers a ping but cannot produce structured output must not show OK.
    assert.match(PANEL, /provider\.usableForAiAnalyze/);
    assert.match(PANEL, /diag\.aiAnalyzeReady/);
  });

  it("a provider that was never measured is not rendered as a failure", () => {
    // NOT_TESTED means the deadline arrived first. Showing it as a red cross
    // would report a verdict nobody reached — the same error in miniature.
    assert.match(PANEL, /NOT_TESTED: "not tested"/);
    assert.match(PANEL, /diagnosticState === "KEY_MISSING" \|\| provider\.diagnosticState === "NOT_TESTED"/);
  });

  it("every diagnostic state has a label, so none can render as a raw enum", () => {
    const states = [
      "KEY_MISSING", "CONFIGURATION_INVALID", "MODEL_UNAVAILABLE", "BILLING_BLOCKED",
      "RATE_LIMITED", "CONNECTIVITY_VERIFIED", "ANALYSIS_VERIFIED", "GENERATION_VERIFIED",
      "NOT_TESTED", "CONFIGURED",
    ];
    for (const state of states) {
      assert.match(PANEL, new RegExp(`${state}:\\s*"`), `${state} needs a human-readable label`);
    }
  });
});
