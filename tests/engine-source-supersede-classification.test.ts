// Found by reading production runtime logs, not by a failing test.
//
// 13 of the 22 runtime error groups on the preview project were the same
// thing: `[run-next] Job <id> execution failed ...: ENGINE_SOURCE_REVISION_STALE`
// at `level: error`. That condition is not an incident. When a tender's or
// company's sources change while an ENGINE_RUN job is in flight,
// enqueueEngineJobForCurrentSources has already cancelled the stale job and
// queued a fresh one bound to the new revision; the in-flight run then throws
// at its before/after checkpoint so it cannot promote output derived from
// inputs that no longer exist. Correct, and self-healing.
//
// Three things about it were wrong, and none of them were the gate:
//
//   1. classifyStageRetry fell through to the generic branch and labelled it
//      RETRY_BUDGET_EXHAUSTED_OR_UNKNOWN_FAILURE — asserting a retry budget
//      had been spent when zero retries were attempted, and calling a
//      precisely identified condition "unknown". That code is surfaced as
//      generationBlockerCode.
//   2. It was logged at error level, so a benign race sat at the top of
//      runtime error monitoring and buried real failures under it.
//   3. publicJobFailureMessage's all-caps fallback told the user to "retry
//      once the underlying issue is resolved" and to contact an administrator
//      — for a condition with nothing to resolve, no retry to make, and a
//      replacement run already queued.
//
// The same fallthrough mislabelled the automatic source-grounding gate, which
// is a genuine authority blocker rather than an unknown failure.
//
// Retrying is still refused in both cases and neither gate is weakened: a
// stale revision does not un-change, and incomplete grounding does not
// complete on its own.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { classifyStageRetry, isSupersededStageFailure } from "../lib/engine/stage-retry-policy";
import { publicJobFailureMessage } from "../lib/prisma-schema-compatibility";

const STALE = "ENGINE_SOURCE_REVISION_STALE";
const GROUNDING = "Automatic source grounding incomplete for 1 mandatory/critical requirement(s)";

describe("a superseded Engine run is classified as superseded, not as an unknown failure", () => {
  it("names the condition instead of claiming an exhausted retry budget", () => {
    const decision = classifyStageRetry(STALE, 0);
    assert.equal(decision.blockerCode, "ENGINE_SOURCE_SUPERSEDED");
    assert.notEqual(decision.blockerCode, "RETRY_BUDGET_EXHAUSTED_OR_UNKNOWN_FAILURE");
  });

  it("still refuses to retry — the revision will not un-change", () => {
    for (const retryCount of [0, 1, 2, 3, 4]) {
      const decision = classifyStageRetry(STALE, retryCount);
      assert.equal(decision.retryable, false, `retryCount=${retryCount} must not be retryable`);
      assert.equal(decision.delayMs, null);
      assert.equal(decision.blockerCode, "ENGINE_SOURCE_SUPERSEDED", "the code must not degrade with retry count");
    }
  });

  it("is recognisable to callers that need to downgrade its log level", () => {
    assert.equal(isSupersededStageFailure(STALE), true);
    assert.equal(isSupersededStageFailure("[run-next] ... failed: ENGINE_SOURCE_REVISION_STALE"), true);
    assert.equal(isSupersededStageFailure("ETIMEDOUT contacting storage"), false);
    assert.equal(isSupersededStageFailure(GROUNDING), false);
  });

  it("tells the user nothing is required of them", () => {
    const message = publicJobFailureMessage(new Error(STALE), "abc12345");
    assert.match(message, /superseded/i);
    assert.match(message, /already been queued automatically/i);
    assert.match(message, /no action is needed/i);
    assert.doesNotMatch(message, /contact an administrator/i);
    assert.match(message, /Reference: abc12345/, "the correlation reference must survive");
  });

  it("leaks no internal token or ORM detail into the user-facing message", () => {
    const message = publicJobFailureMessage(new Error(STALE), "abc12345");
    assert.doesNotMatch(message, /ENGINE_SOURCE_REVISION_STALE|prisma|stack/i);
  });
});

describe("the automatic source-grounding gate is an authority blocker, not an unknown failure", () => {
  it("is classified as a non-retryable authority/integrity blocker", () => {
    const decision = classifyStageRetry(GROUNDING, 0);
    assert.equal(decision.retryable, false);
    assert.equal(decision.blockerCode, "NON_RETRYABLE_AUTHORITY_OR_INTEGRITY_BLOCKER");
    assert.notEqual(decision.blockerCode, "RETRY_BUDGET_EXHAUSTED_OR_UNKNOWN_FAILURE");
  });
});

describe("existing stage-retry behaviour is unchanged", () => {
  it("still re-arms genuinely transient failures with the same backoff ladder", () => {
    assert.deepEqual(classifyStageRetry("ETIMEDOUT contacting storage", 0), {
      retryable: true,
      blockerCode: "TRANSIENT_STAGE_FAILURE",
      delayMs: 30_000,
    });
    assert.equal(classifyStageRetry("ETIMEDOUT contacting storage", 3).delayMs, 600_000);
  });

  it("still exhausts the budget for a transient failure that keeps recurring", () => {
    const exhausted = classifyStageRetry("ETIMEDOUT contacting storage", 4);
    assert.equal(exhausted.retryable, false);
    assert.equal(exhausted.blockerCode, "RETRY_BUDGET_EXHAUSTED_OR_UNKNOWN_FAILURE");
  });

  it("still refuses to retry existing authority and integrity blockers", () => {
    for (const message of [
      "ZERO_REVIEWED_EXPERT_EVIDENCE: no reviewed experts",
      "PROPOSAL_GENERATION blocked by readiness gate (BUILD_PLAN_NOT_CONFIRMED): ...",
      "CONTENT_HASH_MISMATCH",
      "NOT_FOUND_OR_FORBIDDEN",
    ]) {
      assert.equal(classifyStageRetry(message, 0).retryable, false, message);
    }
  });

  it("still treats an unrecognised failure as unknown rather than silently superseding it", () => {
    const decision = classifyStageRetry("Some entirely new failure nobody has classified", 0);
    assert.equal(decision.retryable, false);
    assert.equal(decision.blockerCode, "RETRY_BUDGET_EXHAUSTED_OR_UNKNOWN_FAILURE");
  });
});
