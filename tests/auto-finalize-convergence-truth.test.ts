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
  pdfValidation: { validated: 1, failed: 0, pending: 0 },
  packageReconciliation: { requiredTotal: 5, missing: 0 },
  warning: null,
};

function withStage(overrides: Record<string, unknown>) {
  return { ...CLEAN, ...overrides } as Parameters<typeof evaluateAutoFinalizeConvergence>[0];
}

/** Every stage left something behind — one blocker per outstanding state. */
const ALL_BLOCKED = withStage({
  sourceRepair: { checked: 2, repaired: 0, remaining: 2 },
  validation: { validated: 0, failed: 1, pending: 1 },
  pdfFinalization: { finalized: 0, skipped: 0, failed: 1 },
  exportRepair: { repaired: 0, skipped: 0, manualRequired: 1 },
  pdfValidation: { validated: 0, failed: 1, pending: 1 },
  packageReconciliation: { requiredTotal: 4, missing: 1 },
});

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
    ["failed PDF re-validation", { pdfValidation: { validated: 0, failed: 2, pending: 0 } }, /auto-finalized PDF\(s\) failed canonical validation/],
    ["pending PDF re-validation", { pdfValidation: { validated: 0, failed: 0, pending: 2 } }, /auto-finalized PDF\(s\) are still unvalidated/],
    ["an incomplete package", { packageReconciliation: { requiredTotal: 9, missing: 3 } }, /package reconciliation incomplete — 3 of 9/],
  ];

  for (const [label, override, pattern] of cases) {
    it(`blocks on ${label}`, () => {
      const blockers = evaluateAutoFinalizeConvergence(withStage(override));
      assert.equal(blockers.length, 1, `${label} must produce exactly one blocker: ${JSON.stringify(blockers)}`);
      assert.match(blockers[0], pattern);
    });
  }

  it("reports every outstanding reason, not just the first", () => {
    const blockers = evaluateAutoFinalizeConvergence(ALL_BLOCKED);
    assert.equal(blockers.length, 8, "a user fixing this needs the whole list, not one item at a time");
  });
});

describe("blockers fail terminally instead of burning the retry budget", () => {
  it("every blocker classifies as non-retryable", () => {
    const all = evaluateAutoFinalizeConvergence(ALL_BLOCKED);
    for (const blocker of all) {
      const decision = classifyStageRetry(`AUTO_FINALIZE_NOT_CONVERGED — ${blocker}`, 0);
      assert.equal(decision.retryable, false, `re-running will not change "${blocker}"`);
    }
  });

  it("a genuinely transient stage failure is still retryable", () => {
    assert.equal(classifyStageRetry("TIMEOUT contacting provider", 0).retryable, true);
  });
});

describe("the PDFs auto-finalize creates are actually validated", () => {
  // The PDF finalization loop persists each new PDF validationStatus PENDING
  // ("awaiting canonical validation"), and canonical validation runs one stage
  // EARLIER. So without a second pass, every auto-finalized PDF stayed PENDING
  // forever — and the export gate refuses unvalidated documents, meaning the
  // automatic chain could never reach export-ready on its own.

  it("still persists new PDFs as PENDING, which is what makes the second pass necessary", () => {
    assert.match(SERVICE, /validationStatus: "PENDING"/);
  });

  it("re-runs canonical validation after PDF finalization, not before", () => {
    const finalizeIdx = SERVICE.indexOf("result.pdfFinalization =");
    const revalidateIdx = SERVICE.indexOf("result.pdfValidation = pdfValidation;");
    assert.ok(finalizeIdx > -1 && revalidateIdx > -1, "both stages must exist");
    assert.ok(revalidateIdx > finalizeIdx, "validating before the PDFs exist is the bug being fixed");
  });

  it("reuses the one canonical validator instead of adding a PDF-specific one", () => {
    const stage = SERVICE.slice(SERVICE.indexOf('stepName: "auto-finalize.pdf-validation"'));
    assert.match(stage.slice(0, 600), /await runCanonicalValidation\(tenderId, userId\)/);
  });

  it("skips the pass when finalization produced no PDFs", () => {
    // Re-validating nothing would waste a full validation sweep on every run.
    assert.match(SERVICE, /if \(result\.pdfFinalization\.finalized > 0\) \{/);
  });
});

describe("package reconciliation reads the one completeness authority", () => {
  // A required file that was never generated is invisible to source repair,
  // export repair, validation and PDF finalization alike — every one of them
  // can succeed while the package is still short. Reconciling against the
  // confirmed plan is what makes convergence mean "the package is complete".

  it("resolves completeness through the shared loader rather than its own query", () => {
    const helper = SERVICE.slice(SERVICE.indexOf("async function reconcilePackageManifest"));
    const body = helper.slice(0, helper.indexOf("\n}\n") + 1);
    assert.match(body, /loadSubmissionPlanCompleteness\(prisma, tenderId, userId\)/);
    // A second hand-rolled tender select here is exactly how the panel and the
    // pipeline drift apart about how many files are still owed.
    assert.doesNotMatch(body, /prisma\.tender\.findFirst/);
    assert.doesNotMatch(body, /resolveSubmissionPlanCompleteness\(/);
  });

  it("the API route the user sees reads that same loader", () => {
    const route = readFileSync("app/api/tenders/[id]/submission-plan/route.ts", "utf8");
    assert.match(route, /loadSubmissionPlanCompleteness\(prisma, id, actor\.id\)/);
    assert.doesNotMatch(route, /prisma\.tender\.findFirst/);
  });

  it("reports nothing to reconcile when no confirmed plan exists", () => {
    // The missing plan is already the Engine's blocker upstream; repeating it
    // here would just be a second voice saying the same thing.
    const helper = SERVICE.slice(SERVICE.indexOf("async function reconcilePackageManifest"));
    assert.match(helper.slice(0, 600), /!loaded \|\| !loaded\.hasConfirmedPlan\) return \{ requiredTotal: 0, missing: 0 \}/);
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
