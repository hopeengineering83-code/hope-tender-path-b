// The Engine panel asserted "Engine is running" for a job nothing was running.
//
// /api/tenders/[id]/engine-readiness groups QUEUED, RUNNING and PARTIAL_SUCCESS
// under a single `engineRunning` flag. The panel read only that flag, so a job
// sitting QUEUED — never claimed by any worker — was displayed as
// "Engine is running as a durable current-revision job.", indefinitely, with no
// elapsed time and nothing separating executing from abandoned.
//
// That is not hypothetical. On the Preview deployment the AiJob queue had no
// driver at all: 24 hours of Vercel runtime logs contain exactly one
// POST /api/ai-jobs/run-next (a manually dispatched workflow run), and the
// owner's browser polled engine-readiness 381 times at a 3-second cadence —
// the poll only runs while engineRunning is true. The owner reported the Engine
// "keeps long time and not working". The UI was asserting a state it could not
// observe.
//
// The readiness payload already carried activeJob.status and
// activeJob.createdAt. Only the panel ignored them.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { describeEngineActivity } from "../components/matching-selected-evidence-panel";

const NOW = Date.parse("2026-08-09T14:00:00.000Z");
const minutesAgo = (n: number) => new Date(NOW - n * 60_000).toISOString();

describe("Engine activity is described, not asserted", () => {
  it("a RUNNING job is reported as running", () => {
    const message = describeEngineActivity(
      { status: "RUNNING", createdAt: minutesAgo(2) },
      NOW,
    );
    assert.match(message, /Engine is running/);
  });

  it("a QUEUED job is never reported as running", () => {
    const message = describeEngineActivity(
      { status: "QUEUED", createdAt: minutesAgo(0) },
      NOW,
    );
    // The exact defect: a queued job claiming to be running.
    assert.ok(
      !/is running/.test(message),
      `a queued job must not claim to be running: ${message}`,
    );
    assert.match(message, /queued/i);
    assert.match(message, /waiting for a worker/i);
  });

  it("surfaces how long a queued job has been waiting", () => {
    const message = describeEngineActivity(
      { status: "QUEUED", createdAt: minutesAgo(4) },
      NOW,
    );
    assert.match(message, /4 min/);
  });

  it("names the real problem once no worker has claimed the job", () => {
    // Past the cron's documented 5–15 minute drift, waiting is not the
    // explanation — nothing is running the job, and the owner must be told so
    // rather than left watching a spinner.
    const message = describeEngineActivity(
      { status: "QUEUED", createdAt: minutesAgo(42) },
      NOW,
    );
    assert.match(message, /42 min/);
    assert.match(message, /without being claimed by a worker/i);
    assert.match(message, /Processing has not started/i);
    assert.ok(
      !/is running/.test(message),
      `a stalled queue must not claim to be running: ${message}`,
    );
  });

  it("does not fabricate an elapsed time from an unparseable timestamp", () => {
    const message = describeEngineActivity(
      { status: "QUEUED", createdAt: "not-a-date" },
      NOW,
    );
    assert.match(message, /queued/i);
    assert.ok(!/NaN/.test(message), `NaN leaked into the label: ${message}`);
    assert.ok(!/min/.test(message), `invented an elapsed time: ${message}`);
  });

  it("does not call a terminal PARTIAL_SUCCESS job running", () => {
    // Defensive: nothing writes PARTIAL_SUCCESS to an ENGINE_RUN row today.
    // But engine-readiness counts it as active, and no claim path or recovery
    // sweep can ever move it, so if it ever occurs the tender is wedged — and
    // saying "running" would be exactly the lie this function removes.
    const message = describeEngineActivity(
      { status: "PARTIAL_SUCCESS", createdAt: minutesAgo(20) },
      NOW,
    );
    assert.ok(
      !/is running/.test(message),
      `a terminal job must not claim to be running: ${message}`,
    );
    assert.match(message, /not running/i);
  });

  it("falls back to running when the payload carries no active job", () => {
    // engineRunning true with no activeJob is the pre-existing shape; it must
    // keep its previous wording rather than inventing a queue state.
    assert.match(describeEngineActivity(null, NOW), /Engine is running/);
    assert.match(describeEngineActivity(undefined, NOW), /Engine is running/);
  });

  it("never counts backwards from a clock skewed into the future", () => {
    const message = describeEngineActivity(
      { status: "QUEUED", createdAt: new Date(NOW + 60_000).toISOString() },
      NOW,
    );
    assert.ok(!/-/.test(message), `negative elapsed time rendered: ${message}`);
  });
});
