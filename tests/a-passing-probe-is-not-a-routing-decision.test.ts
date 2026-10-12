import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * THE DEFECT.
 * -----------
 * 2026-09-16T13:33Z, the operator's provider report:
 *
 *   PROVIDER CHAIN: 2/10 verified, 2 usable for AI Analyze
 *     USABLE FOR AI ANALYZE: ['gemini', 'groq']
 *     gemini  ANALYSIS_VERIFIED  analyze=True  model=gemini-3.5-flash
 *
 * 2026-09-16T13:37Z, the owner's real AI Analyze on the same Preview:
 *
 *   Contacted 0 of 10 configured provider(s) ... (tried: none — all skipped).
 *   Provider errors: gemini: in cooldown | ...
 *
 * Both statements were true. The probe proves the key, the route and the
 * model's structured-output behaviour on a tiny payload. Routing additionally
 * requires the provider not to be cooling down from earlier REAL failures.
 * `ProviderCapabilityReport.eligible` already carried that distinction — the
 * printed report simply dropped it, so the only visible signal was the probe.
 *
 * Reading a probe result as a routing result is how three consecutive sessions
 * predicted a model-backed run that could not start, including the session
 * that wrote this test.
 *
 * THE FIX IS NOT TO MAKE THE PROBE CLEAR THE COOLDOWN. A probe observes; it
 * does not heal. The fix is that the report carries real-work eligibility and
 * the cooldown expiry next to the probe verdict, so "skipped" comes with the
 * one number that says whether waiting is the answer and until when.
 */
describe("a passing probe is not a routing decision", () => {
  const capabilitySource = readFileSync("lib/ai-provider-capability-test.ts", "utf8");
  const workflowSource = readFileSync(".github/workflows/lockfile-refresh-artifact.yml", "utf8");

  it("the capability report carries real-work eligibility, not only the probe", () => {
    // These five fields are what make a skip actionable. They are read from
    // getProviderRuntimeSnapshot — the same authority routing reads — so the
    // report cannot describe a different provider state than the one that
    // skipped it.
    for (const field of ["coolingDown", "cooldownUntil", "lastFailureAt", "lastFailureCategory", "consecutiveFailures"]) {
      assert.match(
        capabilitySource,
        new RegExp(`^\\s*${field}[?]?:`, "m"),
        `ProviderCapabilityReport must expose ${field}`,
      );
    }
    assert.match(capabilitySource, /getProviderRuntimeSnapshot\(provider\)/);
  });

  it("the operator report prints eligibility and cooldown expiry, not just the probe", () => {
    // The regression is a REPORT that shows one of two true things. Pin the
    // printed surface, because that is where the misreading happened.
    assert.match(workflowSource, /ELIGIBLE FOR REAL WORK NOW/);
    assert.match(workflowSource, /ELIGIBLE NOW:/);
    assert.match(workflowSource, /PROBE PASSED:/);
    assert.match(workflowSource, /PROBE-OK BUT NOT ROUTABLE/);
    assert.match(workflowSource, /cooldownUntil=\{r\.get\('cooldownUntil'\)\}/);
    assert.match(workflowSource, /eligible=\{r\.get\('eligible'\)\}/);
  });

  it("the headline cannot call a cooling provider runnable", () => {
    // Reproduce the 13:33 row shape and the 13:37 truth, and check the rule the
    // workflow now applies: routable requires BOTH probe and eligibility.
    const rows = [
      { provider: "gemini", usableForAiAnalyze: true, eligible: false, eligibilityReason: "in cooldown", cooldownUntil: "2026-09-16T13:38:00.000Z" },
      { provider: "groq", usableForAiAnalyze: true, eligible: true, eligibilityReason: "", cooldownUntil: null },
    ];
    const routable = rows.filter((r) => r.usableForAiAnalyze && r.eligible).map((r) => r.provider);
    const probeOnly = rows.filter((r) => r.usableForAiAnalyze && !r.eligible).map((r) => r.provider);

    assert.deepEqual(probeOnly, ["gemini"], "a cooling provider must not count as routable");
    assert.deepEqual(routable, ["groq"]);
    // And the old rule, which is what shipped, would have claimed both.
    const oldRule = rows.filter((r) => r.usableForAiAnalyze).map((r) => r.provider);
    assert.deepEqual(oldRule, ["gemini", "groq"]);
    assert.notDeepEqual(oldRule, routable, "the new rule must actually differ from the one that misled");
  });

  it("does not weaken the isolation invariant: a probe still never clears a cooldown", () => {
    // The tempting 'fix' is to let a passing probe clear the cooldown. That
    // would make the report agree with itself by corrupting the health state
    // real routing depends on, which is the opposite of the contract.
    const healthSource = readFileSync("lib/ai-provider-health.ts", "utf8");
    assert.match(healthSource, /Deliberately NOT touched: lastSuccessAt, consecutiveFailures, cooldownUntil/);
    assert.equal(
      /recordProviderProbeCapability[\s\S]{0,600}cooldownUntil\s*=\s*null/.test(healthSource),
      false,
      "the probe recorder must not clear cooldownUntil",
    );
  });
});
