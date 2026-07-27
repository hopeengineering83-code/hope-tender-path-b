// Real-DB proof for a bug found via live screenshots: when
// app/api/ai-jobs/run-next/route.ts's generic catch block classified a
// failure as non-retryable (or the retry budget was exhausted) and called
// failJob(), it persisted ONLY `JOB_EXECUTION_FAILED (ref: xxxxxxxx)` —
// dropping the real underlying error message entirely, even though the
// rearm-for-retry branch 7 lines above already included it
// (`JOB_EXECUTION_FAILED (ref: xxxxxxxx): <real message>`). The real cause
// was only ever visible in ephemeral server logs — the UI's "Technical
// diagnostics" panel (components/engine-action-panel.tsx) can only show
// what's persisted to AiJob.errorMessage, so users saw an opaque
// correlation ID with no way to self-diagnose or even report the failure
// usefully.
//
// This proves the fix: a terminally-failed job's errorMessage now includes
// the real message on both paths.

import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { prisma, prismaReady } from "../lib/prisma";
import { enqueueJob } from "../lib/ai-jobs";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for this test suite.");
  process.exit(1);
}

let userId: string;
const WORKER_SECRET = "test-worker-secret-at-least-16-chars-long";

describe("run-next terminal failure persists the real error message, not just a correlation ref", () => {
  before(async () => {
    await prismaReady;
    process.env.AI_JOBS_WORKER_SECRET = WORKER_SECRET;
    const user = await prisma.user.create({
      data: { email: `run-next-terminal-${Date.now()}@example.test`, name: "Run Next Terminal Error Test", passwordHash: "test-hash" },
    });
    userId = user.id;
  });

  after(async () => {
    await prisma.aiJob.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("a non-retryable EXTRACT_TEXT handler failure is terminally failed with the real message included", async () => {
    // A nonexistent tenderFileId makes the EXTRACT_TEXT handler throw
    // "EXTRACT_TEXT: TenderFile <id> not found" — a message that does not
    // match classifyStageRetry's RETRYABLE pattern, so it is classified
    // non-retryable and must hit the failJob() terminal path.
    const bogusFileId = "00000000-0000-0000-0000-000000000000";
    const job = await enqueueJob({ userId, jobType: "EXTRACT_TEXT", input: { tenderFileId: bogusFileId } });

    const { POST } = await import("../app/api/ai-jobs/run-next/route");
    const response = await POST(new Request("http://localhost/api/ai-jobs/run-next?jobType=EXTRACT_TEXT", {
      method: "POST",
      headers: { "x-worker-secret": WORKER_SECRET },
    }));
    assert.equal(response.status, 200);

    const row = await prisma.aiJob.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(row.status, "FAILED");
    assert.match(row.errorMessage ?? "", /^JOB_EXECUTION_FAILED \(ref: [0-9a-f]{8}\): /, "must retain the correlation-ref prefix");
    assert.match(row.errorMessage ?? "", new RegExp(`TenderFile ${bogusFileId} not found`), "must include the REAL underlying error, not just the correlation ref");
  });
});
