import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * THE DEFECT, read off the owner's own Preview page.
 * ---------------------------------------------------
 * One card said:
 *
 *   AI Analyze did not complete
 *   ... Observed categories: BILLING, AUTH_OR_CONFIGURATION_INVALID,
 *   RATE_LIMITED, TEMPORARILY_UNAVAILABLE, MALFORMED_RESPONSE,
 *   REQUEST_TOO_LARGE.
 *
 * and the card immediately below it said:
 *
 *   1 of 10 tested provider(s) completed a real AI Analyze extraction —
 *   AI Analyze can run.
 *
 * Both were literally true, which is what made it dangerous. The second card
 * reports a PROBE: a small fixed payload that proves the key, the route and
 * the model's structured-output behaviour. The owner's tender needs 7,242
 * input tokens. Groq passed that probe in 843 ms and was refused the real
 * request before contact -- "groq: Prompt exceeds the configured provider
 * throughput budget (7242 input tokens)" -- and does not even appear in the
 * failing job's `tried:` list.
 *
 * So the owner was told AI Analyze could run, clicked it on that assurance,
 * and it could not. The wording is not cosmetic: it is the sentence the
 * decision was made on.
 *
 * WHAT IS PINNED
 * --------------
 * That this endpoint never again asserts a real run will succeed from a probe,
 * that it says plainly what a probe does and does not prove, and that it
 * carries explicit machine-readable state (`probeOnly`, `realPayloadProven`)
 * so a consumer cannot infer real-payload success from probe success either.
 */

const ROUTE = readFileSync(
  join(process.cwd(), "app", "api", "ai-providers", "diagnostics", "route.ts"),
  "utf8",
);

describe("a probe result never claims AI Analyze will run", () => {
  it("no longer tells the operator that AI Analyze can run", () => {
    // The exact sentence the owner acted on.
    assert.doesNotMatch(ROUTE, /AI Analyze can run/);
  });

  it("no longer calls a probe a real AI Analyze extraction", () => {
    // "completed a real AI Analyze extraction" is the claim that made a small
    // probe indistinguishable from the real workload.
    assert.doesNotMatch(ROUTE, /completed a real AI Analyze extraction/);
  });

  it("says what a probe proves and what it does not", () => {
    assert.match(ROUTE, /structured-extraction probe/);
    assert.match(ROUTE, /small fixed payload/);
    assert.match(ROUTE, /NOT that a real tender fits/);
  });

  it("carries machine-readable state so consumers cannot infer success", () => {
    // A future caller reading JSON must be able to tell the two apart without
    // parsing English.
    assert.match(ROUTE, /probeOnly: true/);
    assert.match(ROUTE, /realPayloadProven: false/);
    assert.match(ROUTE, /probeOnly: true;/, "the type must pin the literal, not just boolean");
    assert.match(ROUTE, /realPayloadProven: false;/);
  });

  it("still reports the negative case honestly", () => {
    // Weakening the positive claim must not weaken the failure message: a
    // chain where nothing passed must still say connectivity is insufficient.
    assert.match(ROUTE, /Connectivity alone is not sufficient/);
  });

  it("still distinguishes a partial run from a proven-broken chain", () => {
    // The existing guard: providers left untested mean "not proven yet".
    assert.match(ROUTE, /were not tested/);
    assert.match(ROUTE, /before concluding the chain is broken/);
  });
});

/**
 * The same claim, one layer up: the PANEL painted the probe summary
 * emerald-green whenever any provider passed, so a success-coloured sentence
 * sat directly beneath the red "AI Analyze did not complete" banner. Colour is
 * the fastest thing a reader parses, and green under red is what the owner
 * acted on.
 */
const PANEL = readFileSync(join(process.cwd(), "components", "ai-analyze-panel.tsx"), "utf8");

describe("provider capability is subordinate to workflow state", () => {
  it("does not paint the probe summary green while the last real run failed", () => {
    assert.doesNotMatch(
      PANEL,
      /\$\{diag\.aiAnalyzeReady \? "text-emerald-700" : "text-red-700"\}/,
      "green must not be chosen from probe success alone",
    );
    assert.match(PANEL, /!diag\.aiAnalyzeReady \? "text-red-700" : error \? "text-amber-700" : "text-emerald-700"/);
  });

  it("says plainly that a probe makes a retry worth attempting, not proven", () => {
    assert.match(PANEL, /does not prove this tender will complete/);
  });

  it("still shows the failure banner and the retry control", () => {
    // Softening the green must not remove the honest red.
    assert.match(PANEL, /AI Analyze did not complete/);
    assert.match(PANEL, /Retry AI Analyze/);
  });
});
