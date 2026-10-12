// Real-DB proof for a security regression found via the latest preview:
// app/api/ai-jobs/run-next/route.ts persisted raw ORM/runtime messages into
// AiJob.errorMessage, and the Engine UI rendered that field. The screenshot
// exposed a Prisma model and missing database column. The persisted message
// must retain an actionable category and correlation reference without
// copying internal identifiers or raw errors into the browser.

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

describe("run-next terminal failure persists a safe diagnostic category", () => {
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

  it("a non-retryable EXTRACT_TEXT failure keeps a ref and a specific safe category without leaking the raw record id", async () => {
    // lib/ai-jobs/tender-extraction-service.ts's runTenderFileExtractionJob
    // requires companyId + a well-formed sourceContentSha256 up front and
    // throws the bare, static "EXTRACT_TEXT_INPUT_INVALID" code when either
    // is missing (a genuinely missing/superseded tenderFile no longer
    // throws — it now resolves gracefully via a SUPERSEDED terminal result,
    // a different code path entirely). publicJobFailureMessage() recognizes
    // this class of bare all-caps precondition code (no colon, no
    // interpolated value, so it's always safe to surface) and reuses it
    // directly as the category, rather than collapsing it into a generic
    // "the job failed" message.
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
    assert.match(row.errorMessage ?? "", /Reference: [0-9a-f]{8}/, "must retain the correlation ref");
    assert.doesNotMatch(row.errorMessage ?? "", /TenderFile|00000000-0000-0000-0000-000000000000/, "must not expose internal model names or record identifiers");
  });
});
