// AUTO_FINALIZE must not report SUCCEEDED for a run that left work behind.
//
// AutoFinalizeResult.ok was initialised true and never falsified, and the
// AUTO_FINALIZE handler recorded status SUCCEEDED unconditionally. So the
// durable job reported the tender finished while:
//
//   - source grounding was still unresolved (the UI would keep showing
//     "source reference not found"),
//   - documents had failed or not yet passed canonical validation,
//     which the export gate refuses,
//   - a required PDF could not be finalized from a validated source,
//   - documents needed manual attention that automation had skipped.
//
// That is the same defect shape as a generation run reporting "0 created" as
// success: the pipeline claims completion, the export gate disagrees, and
// nothing names the reason. The user's promise is that after upload the app
// finishes the job — so when it cannot, it has to say which step stopped it.
//
// Convergence is now derived from what the stages left behind, and the blocker
// text is phrased so stage-retry-policy classifies it NON_RETRYABLE: these
// states do not fix themselves, so the job fails terminally with the reason
// persisted instead of burning its retry budget. Transient failures still
// throw from inside the stages and keep durable retry.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

import { evaluateAutoFinalizeConvergence } from "../lib/ai-jobs/auto-finalize-continuation-service";
import { classifyStageRetry } from "../lib/engine/stage-retry-policy";

const SERVICE = readFileSync("lib/ai-jobs/auto-finalize-continuation-service.ts", "utf8");
const HANDLER = readFileSync("lib/ai-job-handlers-legacy.ts", "utf8");

const CLEAN = {
  sourceRepair: { checked: 3, repaired: 3, remaining: 0 },
  exportRepair: { repaired: 2, skipped: 1, manualRequired: 0 },
  validation: { validated: 4, failed: 0, pending: 0 },
  pdfFinalization: { finalized: 1, skipped: 0, failed: 0 },
  warning: null,
};

function withStage(overrides: Record<string, unknown>) {
  return { ...CLEAN, ...overrides } as Parameters<typeof evaluateAutoFinalizeConvergence>[0];
}

describe("a converged run reports no blockers", () => {
  it("returns an empty blocker list when every stage finished cleanly", () => {
    assert.deepEqual(evaluateAutoFinalizeConvergence(CLEAN as never), []);
  });

  it("does not invent a blocker for skipped work that was legitimately skipped", () => {
    // skipped != failed: a PDF with no required counterpart is not a blocker.
    const blockers = evaluateAutoFinalizeConvergence(
      withStage({ pdfFinalization: { finalized: 0, skipped: 5, failed: 0 }, exportRepair: { repaired: 0, skipped: 9, manualRequired: 0 } }),
    );
    assert.deepEqual(blockers, []);
  });
});

describe("every unfinished state the user named is a blocker", () => {
  const cases: Array<[string, Record<string, unknown>, RegExp]> = [
    ["unresolved source grounding", { sourceRepair: { checked: 3, repaired: 1, remaining: 2 } }, /source grounding incomplete/],
    ["failed validation", { validation: { validated: 1, failed: 2, pending: 0 } }, /failed canonical validation/],
    ["pending validation", { validation: { validated: 1, failed: 0, pending: 3 } }, /still unvalidated/],
    ["failed PDF finalization", { pdfFinalization: { finalized: 0, skipped: 0, failed: 1 } }, /could not be finalized/],
    ["manual-required documents", { exportRepair: { repaired: 0, skipped: 0, manualRequired: 4 } }, /need manual attention/],
  ];

  for (const [label, override, pattern] of cases) {
    it(`blocks on ${label}`, () => {
      const blockers = evaluateAutoFinalizeConvergence(withStage(override));
      assert.equal(blockers.length, 1, `${label} must produce exactly one blocker: ${JSON.stringify(blockers)}`);
      assert.match(blockers[0], pattern);
    });
  }

  it("reports every outstanding reason, not just the first", () => {
    const blockers = evaluateAutoFinalizeConvergence(withStage({
      sourceRepair: { checked: 2, repaired: 0, remaining: 2 },
      validation: { validated: 0, failed: 1, pending: 1 },
      pdfFinalization: { finalized: 0, skipped: 0, failed: 1 },
      exportRepair: { repaired: 0, skipped: 0, manualRequired: 1 },
    }));
    assert.equal(blockers.length, 5, "a user fixing this needs the whole list, not one item at a time");
  });
});

describe("blockers fail terminally instead of burning the retry budget", () => {
  it("every blocker classifies as non-retryable", () => {
    const all = evaluateAutoFinalizeConvergence(withStage({
      sourceRepair: { checked: 2, repaired: 0, remaining: 2 },
      validation: { validated: 0, failed: 1, pending: 1 },
      pdfFinalization: { finalized: 0, skipped: 0, failed: 1 },
      exportRepair: { repaired: 0, skipped: 0, manualRequired: 1 },
    }));
    for (const blocker of all) {
      const decision = classifyStageRetry(`AUTO_FINALIZE_NOT_CONVERGED — ${blocker}`, 0);
      assert.equal(decision.retryable, false, `re-running will not change "${blocker}"`);
    }
  });

  it("a genuinely transient stage failure is still retryable", () => {
    assert.equal(classifyStageRetry("TIMEOUT contacting provider", 0).retryable, true);
  });
});

describe("the wiring cannot drift back to unconditional success", () => {
  it("derives ok from the blocker list rather than setting it independently", () => {
    assert.match(SERVICE, /result\.blockers = evaluateAutoFinalizeConvergence\(result\);/);
    assert.match(SERVICE, /result\.ok = result\.blockers\.length === 0;/);
  });

  it("the handler refuses to record SUCCEEDED for a non-converged run", () => {
    const block = HANDLER.slice(HANDLER.indexOf("AUTO_FINALIZE: async (ctx)"));
    assert.match(block, /if \(!result\.ok\) \{/);
    assert.match(block, /status: "FAILED"/);
    assert.match(block, /AUTO_FINALIZE_NOT_CONVERGED/);
    // The success branch must come after the guard, never before it.
    assert.ok(
      block.indexOf("if (!result.ok)") < block.indexOf('message: `Auto-finalize complete:'),
      "the SUCCEEDED record must be unreachable for a blocked run",
    );
  });
});
