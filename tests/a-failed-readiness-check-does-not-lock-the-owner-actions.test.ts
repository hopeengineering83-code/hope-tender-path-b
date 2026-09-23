// 2026-09-23, Preview. The owner pressed Run Engine under
//   "Engine readiness could not be verified. Run Engine remains disabled.
//    Failed to fetch"
// while the server logged /engine-readiness answering 200. The panels checked
// readiness once on mount (and again only while a job was running), so one
// request lost in transit disabled the owner's manual action until a reload,
// and no Engine run was ever requested.
//
// These panels are client components with no DOM harness in this suite, so the
// contract is pinned on their source: while a check is failing there is an
// interval that asks again, guarded by document.hidden, and the action still
// requires a successful check (fail-closed is unchanged).

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

function retryEffect(source: string, errorName: string): string | null {
  const effects = source.split("useEffect(").slice(1);
  return effects.find((body) => body.includes(`if (!${errorName}`) || body.includes(`(!${errorName} &&`)) ?? null;
}

describe("a failed readiness check does not lock the owner's actions", () => {
  it("Run Engine re-checks readiness while the last check failed", () => {
    const source = readFileSync("components/matching-selected-evidence-panel.tsx", "utf8");
    const effect = retryEffect(source, "readinessError");
    assert.ok(effect, "no effect keyed on readinessError");
    assert.match(effect!, /setInterval/);
    assert.match(effect!, /document\.hidden/);
    assert.match(effect!, /loadReadiness\(\)/);
    assert.match(effect!, /clearInterval/);
    // Still fail-closed: the button requires a successful check.
    assert.match(source, /const canRunEngine = [\s\S]{0,200}!readinessError/);
  });

  it("AI Analyze re-checks both readiness sources while either failed", () => {
    const source = readFileSync("components/ai-analyze-panel.tsx", "utf8");
    const effect = retryEffect(source, "readinessError");
    assert.ok(effect, "no effect keyed on readinessError");
    assert.match(effect!, /engineStateError/);
    assert.match(effect!, /setInterval/);
    assert.match(effect!, /document\.hidden/);
    assert.match(effect!, /loadReadiness\(\)/);
    assert.match(effect!, /loadEngineState\(\)/);
    assert.match(effect!, /clearInterval/);
  });
});
