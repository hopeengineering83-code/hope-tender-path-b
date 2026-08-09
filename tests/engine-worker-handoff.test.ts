import assert from "node:assert/strict";
import test from "node:test";
import { completeJob } from "../lib/ai-jobs";
import { scheduleRequestScopedEngineWorkerWake } from "../lib/ai-jobs/request-scoped-engine-worker-wake";
import { enqueueEngineJobForCurrentSources } from "../lib/engine/enqueue-engine-job";
import { claimJobForCaller } from "../lib/job-claim-policy";
import { prisma } from "../lib/prisma";

test("Run Engine once persists one QUEUED job, then the server wake claims and succeeds it", {
  skip: process.env.RUN_DB_INTEGRATION !== "true",
}, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const user = await prisma.user.create({
    data: {
      email: `engine-worker-handoff-${suffix}@test.local`,
      name: "Engine Worker Handoff Test",
      passwordHash: "unused",
      role: "PROPOSAL_MANAGER",
    },
  });

  try {
    const company = await prisma.company.create({
      data: {
        name: "Engine Worker Handoff Company",
        userId: user.id,
        documents: {
          create: [{
            originalFileName: "company-profile.pdf",
            fileName: "company-profile.pdf",
            mimeType: "application/pdf",
            size: 512,
            category: "COMPANY_PROFILE",
            extractedText: "Verified company evidence for the Engine worker handoff regression.",
            contentSha256: "b".repeat(64),
            contentByteLength: 512,
            integrityStatus: "VERIFIED",
            aiExtractionStatus: "COMPLETED",
          }],
        },
      },
    });
    const tender = await prisma.tender.create({
      data: {
        title: "Engine Worker Handoff Tender",
        userId: user.id,
        files: {
          create: [{
            originalFileName: "tender.pdf",
            fileName: "tender.pdf",
            mimeType: "application/pdf",
            size: 1024,
            extractedText: "Verified tender source with sufficient content for a stable Engine source revision.",
            contentSha256: "a".repeat(64),
            contentByteLength: 1024,
            integrityStatus: "VERIFIED",
            extractionMethod: "text",
            extractionScore: 100,
          }],
        },
      },
    });

    const enqueueInput = {
      userId: user.id,
      tenderId: tender.id,
      companyId: company.id,
      manualRequested: true,
    } as const;
    const first = await enqueueEngineJobForCurrentSources(prisma, enqueueInput);
    const duplicate = await enqueueEngineJobForCurrentSources(prisma, enqueueInput);
    assert.ok(first);
    assert.ok(duplicate);
    assert.equal(first.job.status, "QUEUED");
    assert.equal(duplicate.job.id, first.job.id);
    assert.equal(duplicate.job.reusedActiveJob, true);
    assert.equal(await prisma.aiJob.count({
      where: { userId: user.id, tenderId: tender.id, jobType: "ENGINE_RUN" },
    }), 1);

    let scheduled: (() => Promise<void>) | undefined;
    let claimedJobId: string | undefined;
    let observedRunning = false;
    const wakeScheduled = scheduleRequestScopedEngineWorkerWake(
      new Request(`https://example.test/api/tenders/${tender.id}/engine`, {
        headers: { cookie: "session=owner" },
      }),
      tender.id,
      (task) => { scheduled = task; },
      async () => {
        const claimed = await claimJobForCaller({
          jobType: "ENGINE_RUN",
          tenderId: tender.id,
          userId: user.id,
          global: false,
        });
        claimedJobId = claimed?.id;
        observedRunning = (await prisma.aiJob.findUniqueOrThrow({ where: { id: first.job.id } })).status === "RUNNING";
        if (claimed?.id !== first.job.id || !observedRunning) {
          return new Response(null, { status: 409 });
        }
        await completeJob(first.job.id, { regression: "engine-worker-handoff" });
        return new Response(null, { status: 200 });
      },
    );

    assert.equal(wakeScheduled, true);
    assert.ok(scheduled, "the enqueue request must schedule one server-owned wake");
    await scheduled();
    assert.equal(claimedJobId, first.job.id, "the wake must claim the one manually queued Engine job");
    assert.equal(observedRunning, true, "the durable claim must transition the job to RUNNING");
    assert.equal((await prisma.aiJob.findUniqueOrThrow({ where: { id: first.job.id } })).status, "SUCCEEDED");
    assert.equal(await prisma.aiJob.count({
      where: { userId: user.id, tenderId: tender.id, jobType: "ENGINE_RUN" },
    }), 1);
  } finally {
    await prisma.aiJob.deleteMany({ where: { userId: user.id } });
    await prisma.tender.deleteMany({ where: { userId: user.id } });
    await prisma.company.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});
