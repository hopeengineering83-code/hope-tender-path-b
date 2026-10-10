// 2026-09-27, Preview. The owner opened the tender while their AI Analyze was
// running and saw, under a grey Run Engine:
//   "AI Analyze is not in a release-ready state (current: RUNNING)."
// The job succeeded a minute later (the server then answered canRunEngine:
// true), but the panel had read readiness once on mount and re-checked only
// while an Engine job ran or after a failed check, so the button stayed grey
// until a full reload.
//
// The panel is a client component with no DOM harness in this suite, so the
// contract is pinned on its source: while the analysis is QUEUED or RUNNING
// there is an interval that asks again, guarded by document.hidden, and the
// button still requires a successful check.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("components/matching-selected-evidence-panel.tsx", "utf8");

describe("an analysis in flight does not lock Run Engine", () => {
  it("recognises the in-flight states the readiness route reports", () => {
    const decl = source.match(/const analysisInFlight = [\s\S]*?;\n/)?.[0] ?? "";
    assert.match(decl, /!readiness\.analysisCurrent/);
    const rx = new RegExp(decl.match(/\/(\\\(current: [^/]+)\//)?.[1] ?? "^$");
    assert.ok(rx.test("AI Analyze is not in a release-ready state (current: RUNNING)."));
    assert.ok(rx.test("AI Analyze is not in a release-ready state (current: QUEUED)."));
    assert.ok(!rx.test("AI Analyze is not in a release-ready state (current: FAILED)."), "a settled failure is not polled");
  });

  it("re-checks readiness while the analysis is in flight", () => {
    const effect = source.split("useEffect(").slice(1).find((body) => body.includes("if (!analysisInFlight")) ?? "";
    assert.match(effect, /setInterval/);
    assert.match(effect, /document\.hidden/);
    assert.match(effect, /loadReadiness\(\)/);
    assert.match(effect, /clearInterval/);
    assert.match(source, /const canRunEngine = [\s\S]{0,200}readiness\?\.canRunEngine === true/);
  });
});
