import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  recordProviderProbeCapability,
  recordProviderAnalysisSuccess,
  recordProviderFailure,
  restoreProviderState,
  getProviderStateSnapshot,
  isProviderCooledDown,
} from "../lib/ai-provider-health";

/**
 * THE INVARIANT.
 * --------------
 * A provider DIAGNOSTIC is observational. It must not create real-work
 * cooldowns, clear them, increment real-work failures, heal them, or change
 * what tender analysis / proposal generation will attempt.
 *
 * lib/ai.ts already isolates the failure direction: every record* call inside
 * callProvider goes through wrappers that capture instead of writing when
 * `runAsDiagnostic` is on the async context, so a probe that finds a provider
 * rate-limited cannot impose that cooldown on real work. Its comment states the
 * harm plainly: "asking 'is this working?' would make it stop working".
 *
 * THE DEFECT THIS PINS, in the other direction.
 * ---------------------------------------------
 * runCapabilityTest recorded a SUCCESSFUL probe by calling the workload
 * recorders directly — outside runAsDiagnostic, so nothing intercepted them.
 * Each of those also resets consecutiveFailures, cooldownUntil,
 * lastFailureCategory and lastFailureMessage. So a probe healed real failure
 * state and ended a live backoff.
 *
 * That is not harmless just because it "only widens" what routing attempts. A
 * connectivity probe is a few hundred tokens; a tender extraction is several
 * thousand. The small one succeeding while the large one is being rate-limited
 * is not evidence the backoff should end — and clearing it sends real work
 * straight back into the 429 that the backoff existed to space out.
 *
 * Reporting is preserved: the capability timestamp deriveProviderStatus() reads
 * is still written, because a probe IS legitimate evidence of capability.
 */

const PROVIDER = "groq" as const;

/** Put the provider into a real, live cooldown the way real work would. */
function realWorkRateLimitedProvider() {
  restoreProviderState(PROVIDER, {
    lastSuccessAt: null,
    lastPingSucceededAt: null,
    lastGenerationSucceededAt: null,
    lastAnalysisSucceededAt: null,
    lastFailureAt: Date.now(),
    lastFailureCategory: "RATE_LIMIT",
    lastFailureMessage: "Rate limit reached. Limit 8000, Used 5777",
    consecutiveFailures: 3,
    failureConfigFingerprint: null,
    cooldownUntil: Date.now() + 5 * 60_000,
    latestAnalysisResult: null,
    latestGenerationResult: null,
  });
}

describe("a probe observes, it does not heal", () => {
  it("a successful probe leaves a live real-work cooldown exactly as it found it", () => {
    realWorkRateLimitedProvider();
    const before = getProviderStateSnapshot(PROVIDER)!;
    assert.equal(isProviderCooledDown(PROVIDER), true, "precondition: provider is cooling down");

    recordProviderProbeCapability(PROVIDER, "connectivity");

    const after = getProviderStateSnapshot(PROVIDER)!;
    assert.equal(after.cooldownUntil, before.cooldownUntil, "probe must not clear the cooldown");
    assert.equal(after.consecutiveFailures, before.consecutiveFailures, "probe must not zero the failure count");
    assert.equal(after.lastFailureCategory, before.lastFailureCategory, "probe must not erase the cause");
    assert.equal(after.lastFailureMessage, before.lastFailureMessage, "probe must not erase the message");
    assert.equal(isProviderCooledDown(PROVIDER), true, "the provider is still cooling down after the probe");
  });

  it("the probe still records the capability evidence the operator report needs", () => {
    realWorkRateLimitedProvider();
    for (const [capability, field] of [
      ["connectivity", "lastPingSucceededAt"],
      ["analysis", "lastAnalysisSucceededAt"],
      ["generation", "lastGenerationSucceededAt"],
    ] as const) {
      realWorkRateLimitedProvider();
      assert.equal(getProviderStateSnapshot(PROVIDER)![field], null, `precondition: no ${field}`);
      recordProviderProbeCapability(PROVIDER, capability);
      assert.ok(
        getProviderStateSnapshot(PROVIDER)![field],
        `${capability} probe must record ${field} so the status report stays honest`,
      );
    }
  });

  it("a probe does not promote itself to a general success", () => {
    realWorkRateLimitedProvider();
    recordProviderProbeCapability(PROVIDER, "analysis");
    assert.equal(
      getProviderStateSnapshot(PROVIDER)!.lastSuccessAt,
      null,
      "lastSuccessAt is the workload's record; a probe has not served a workload",
    );
  });

  it("a REAL workload success still clears the cooldown, as designed", () => {
    // The isolation must not disable legitimate recovery: real traffic that
    // succeeds is exactly the evidence that the failure state is stale.
    realWorkRateLimitedProvider();
    assert.equal(isProviderCooledDown(PROVIDER), true);

    recordProviderAnalysisSuccess(PROVIDER);

    const after = getProviderStateSnapshot(PROVIDER)!;
    assert.equal(after.cooldownUntil, null, "a real success clears the cooldown");
    assert.equal(after.consecutiveFailures, 0);
    assert.ok(after.lastSuccessAt, "a real success records lastSuccessAt");
    assert.equal(isProviderCooledDown(PROVIDER), false);
  });

  it("a REAL workload failure still records health, as designed", () => {
    restoreProviderState(PROVIDER, {
      lastSuccessAt: null, lastPingSucceededAt: null, lastGenerationSucceededAt: null,
      lastAnalysisSucceededAt: null, lastFailureAt: null, lastFailureCategory: null,
      lastFailureMessage: null, consecutiveFailures: 0, failureConfigFingerprint: null,
      cooldownUntil: null, latestAnalysisResult: null, latestGenerationResult: null,
    });
    recordProviderFailure(PROVIDER, new Error("Rate limit reached"));
    const after = getProviderStateSnapshot(PROVIDER)!;
    assert.ok(after.consecutiveFailures > 0, "real failures still count");
    assert.ok(after.lastFailureAt, "real failures still record when");
  });

  it("the probe path cannot reach a workload recorder at all", () => {
    // The success branch needs a live provider call, so the WIRING is pinned
    // here rather than behaviourally. Asserting on the import list rather than
    // on call sites means a workload recorder cannot come back under an alias
    // either — if it is not imported, it cannot be called.
    const src = require("node:fs").readFileSync("lib/ai-provider-capability-test.ts", "utf8");
    const importBlock = src.slice(
      src.indexOf('import {', src.indexOf("recordDiagnosticObservation") - 200),
    ).split('} from "./ai-provider-health";')[0];

    for (const workloadRecorder of [
      "recordProviderPingSuccess",
      "recordProviderAnalysisSuccess",
      "recordProviderSuccess",
    ]) {
      assert.ok(
        !importBlock.includes(workloadRecorder),
        `the probe path must not import ${workloadRecorder} — it resets real failure state`,
      );
    }
    assert.ok(
      importBlock.includes("recordProviderProbeCapability"),
      "it must import the probe-only recorder",
    );

    const code = src.split("\n").filter((l: string) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    assert.match(code, /recordProviderProbeCapability\s*\(/, "and actually call it");
  });

  it("the probe-only recorder writes no field that governs routing", () => {
    // Guards the recorder itself against a future edit that re-bundles the
    // reset. Routing reads cooldownUntil and consecutiveFailures; the operator
    // report reads the three capability timestamps. Only the latter may move.
    const src = require("node:fs").readFileSync("lib/ai-provider-health.ts", "utf8");
    const start = src.indexOf("export function recordProviderProbeCapability");
    const body = src.slice(start, src.indexOf("\n}", start));
    const code = body.split("\n").filter((l: string) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    for (const routingField of ["cooldownUntil", "consecutiveFailures", "lastFailureCategory", "lastFailureMessage", "lastSuccessAt"]) {
      assert.doesNotMatch(
        code,
        new RegExp(`s\\.${routingField}\\s*=`),
        `a probe must not assign ${routingField}`,
      );
    }
  });
});
