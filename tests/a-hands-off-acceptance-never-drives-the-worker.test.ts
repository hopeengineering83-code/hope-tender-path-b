/**
 * "Works independently" has to be proven by a run that does not help.
 *
 * 2026-10-05: every hosted acceptance so far called POST /api/ai-jobs/run-next
 * on each tick as a "safety net". A green run therefore proved the stages are
 * correct, not that the app reaches the ZIP on its own: on 2026-10-05 the
 * safety net claimed the AI_ANALYZE job seconds after the owner's click, before
 * the app's own wake could. confirm=handsoff clicks the two owner gates and
 * then only watches.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const script = readFileSync("scripts/tmp-await-tender-jobs.sh", "utf8");
const workflow = readFileSync(".github/workflows/lockfile-refresh-artifact.yml", "utf8");

describe("hands-off acceptance", () => {
  it("never calls the worker when HANDS_OFF=1", () => {
    const handsOff = script.indexOf('if [ "${HANDS_OFF:-}" = "1" ]; then\n    sleep');
    const runNext = script.indexOf('"$BASE_URL/api/ai-jobs/run-next"');
    assert.ok(handsOff > 0 && runNext > handsOff, "the hands-off branch must skip the run-next call");
    assert.match(script.slice(handsOff, runNext), /continue/);
  });

  it("does not require the worker secret in hands-off mode", () => {
    assert.match(script, /if \[ "\$\{HANDS_OFF:-\}" != "1" \]; then\n  : "\$\{WORKER_SECRET:\?/);
  });

  it("runs the same gates and checks as accept, with HANDS_OFF on both waits", () => {
    assert.equal((workflow.match(/HANDS_OFF: \$\{\{ inputs\.confirm == 'handsoff' && '1' \|\| '' \}\}/g) ?? []).length, 2);
    assert.doesNotMatch(workflow, /if: inputs\.confirm == 'accept'\n/);
    assert.match(workflow, /inputs\.confirm == 'accept' \|\| inputs\.confirm == 'handsoff' \|\| inputs\.confirm == 'export'/);
  });
});
