/**
 * Re-running Run Engine after generation already succeeded must not dead-end.
 *
 * This reproduces the owner's exact history, against real PostgreSQL rows:
 *
 *   1. an analysis revision exists and Run Engine succeeded for it;
 *   2. PROPOSAL_GENERATION succeeded for that same revision;
 *   3. AUTO_FINALIZE was enqueued and never claimed — the deployment of the
 *      day could not wake its own worker, so the row sat QUEUED;
 *   4. the owner pressed Run Engine again.
 *
 * The proposal job's runId is deterministic in company + tender + user +
 * revision, so step 4 resolved straight back to the SUCCEEDED row from step 2.
 * The continuation answered `queued: true` for it, the worker set out to claim
 * a PROPOSAL_GENERATION job, and found none — claimJobForCaller only claims
 * `status = 'QUEUED'`, and a SUCCEEDED row is not that. The claim loop exited,
 * the HTTP wake that followed had nothing to claim either, and the tender
 * stopped with no error recorded anywhere. The stage that had actually been
 * left undone, AUTO_FINALIZE, was never reached on any attempt.
 *
 * Two things are proven here that a fake cannot prove: that the deterministic
 * runId really does resolve to the earlier row in the database, and that the
 * AUTO_FINALIZE row left behind by the old code — which carries no runId — is
 * adopted rather than duplicated beside.
 *
 * Requires RUN_DB_INTEGRATION=true. Skips cleanly otherwise.
 * The tender is invented; nothing here is keyed to a benchmark.
 */

import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";

const RUN_DB = process.env.RUN_DB_INTEGRATION === "true";
const dbDescribe = RUN_DB ? describe : describe.skip;

dbDescribe("re-running Run Engine after a successful proposal", () => {
  const { PrismaClient } = require("@prisma/client");
  const { randomUUID } = require("node:crypto");
  const {
    continueSuccessfulEngineToProposal,
    proposalContinuationRunId,
    prismaProposalContinuationRepository,
  } = require("../lib/ai-jobs/proposal-continuation-service");
  const {
    ensureAutoFinalizeContinuationJob,
    autoFinalizeContinuationRunId,
  } = require("../lib/ai-jobs/auto-finalize-continuation-job");
  const { claimJobForCaller } = require("../lib/job-claim-policy");

  const prisma = new PrismaClient();
  const REVISION = `revision-${randomUUID()}`;

  let userId = "";
  let companyId = "";
  let tenderId = "";
  let engineJobId = "";
  let proposalJobId = "";
  let strandedFinalizeJobId = "";

  /**
   * The real repository, with only the generation-readiness gate substituted.
   *
   * That gate needs a fully prepared tender (confirmed Build Plan, extracted
   * requirements, generated documents) and has its own suites. Standing one up
   * here would test the gate, not the continuation. Everything the defect
   * actually lived in — the upsert, the runId, the status reporting — is the
   * genuine implementation running against genuine rows.
   */
  const repository = {
    ...prismaProposalContinuationRepository,
    async checkGenerationReadiness() {
      return { ok: true };
    },
  };

  before(async () => {
    const user = await prisma.user.create({
      data: {
        name: "Rerun Owner",
        email: `rerun-owner+${Date.now()}@example.test`,
        passwordHash: "x",
        role: "ADMIN",
      },
    });
    userId = user.id;

    const company = await prisma.company.create({
      data: { userId, name: "Northern Works Consulting" },
    });
    companyId = company.id;

    const tender = await prisma.tender.create({
      data: { id: randomUUID(), userId, title: "Northern Roads RFP", status: "ACTIVE" },
    });
    tenderId = tender.id;

    // 1-2. Run Engine succeeded for this revision.
    const engine = await prisma.aiJob.create({
      data: {
        userId,
        tenderId,
        jobType: "ENGINE_RUN",
        status: "SUCCEEDED",
        analysisInputHash: REVISION,
        input: JSON.stringify({ autoContinue: true, tenderId }),
        output: JSON.stringify({ result: { partial: false, blockers: [], nextAction: null } }),
      },
    });
    engineJobId = engine.id;

    // 3. PROPOSAL_GENERATION already SUCCEEDED, under the deterministic runId
    //    a rerun will resolve to.
    const proposal = await prisma.aiJob.create({
      data: {
        userId,
        tenderId,
        jobType: "PROPOSAL_GENERATION",
        status: "SUCCEEDED",
        analysisInputHash: REVISION,
        runId: proposalContinuationRunId({ companyId, tenderId, userId, analysisRevision: REVISION }),
        input: JSON.stringify({ autoContinue: true, companyId, analysisRevision: REVISION }),
        output: JSON.stringify({ ok: true }),
      },
    });
    proposalJobId = proposal.id;

    // 4. The AUTO_FINALIZE row the old code left behind: no runId, revision
    //    only in the input JSON, never claimed.
    const stranded = await prisma.aiJob.create({
      data: {
        userId,
        tenderId,
        jobType: "AUTO_FINALIZE",
        status: "QUEUED",
        input: JSON.stringify({
          tenderId,
          analysisRevision: REVISION,
          source: "post-proposal-generation",
        }),
      },
    });
    strandedFinalizeJobId = stranded.id;
  });

  after(async () => {
    if (userId) await prisma.aiJob.deleteMany({ where: { userId } }).catch(() => {});
    if (tenderId) await prisma.tender.delete({ where: { id: tenderId } }).catch(() => {});
    if (companyId) await prisma.company.delete({ where: { id: companyId } }).catch(() => {});
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect().catch(() => {});
  });

  it("does not report already-generated work as freshly queued", async () => {
    const result = await continueSuccessfulEngineToProposal(engineJobId, repository);
    assert.equal(result.queued, false, "a SUCCEEDED proposal row is not claimable and must not be reported as queued");
    assert.equal(result.state, "ALREADY_SUCCEEDED");
    assert.equal(result.reason, "PROPOSAL_ALREADY_SUCCEEDED");
    assert.equal(result.jobId, proposalJobId, "the deterministic runId must resolve to the earlier row");
    assert.equal(result.advanceTo, "AUTO_FINALIZE");
    assert.equal(result.analysisRevision, REVISION);
  });

  it("creates no duplicate proposal job, version, or CVs to manufacture claimable work", async () => {
    await continueSuccessfulEngineToProposal(engineJobId, repository);
    await continueSuccessfulEngineToProposal(engineJobId, repository);
    const proposals = await prisma.aiJob.findMany({
      where: { tenderId, jobType: "PROPOSAL_GENERATION" },
      select: { id: true, status: true },
    });
    assert.equal(proposals.length, 1, "a rerun must not mint a second generation job");
    assert.equal(proposals[0].id, proposalJobId);
    assert.equal(proposals[0].status, "SUCCEEDED", "the successful generation must be left exactly as it was");
  });

  it("adopts the stranded finalize job rather than duplicating it", async () => {
    const finalize = await ensureAutoFinalizeContinuationJob({
      tenderId,
      userId,
      analysisRevision: REVISION,
      parentJobId: proposalJobId,
    });

    assert.equal(finalize.jobId, strandedFinalizeJobId, "the existing queued row is the one to continue with");
    assert.equal(finalize.state, "REUSED_QUEUED");
    assert.equal(finalize.claimable, true);

    const all = await prisma.aiJob.findMany({
      where: { tenderId, jobType: "AUTO_FINALIZE" },
      select: { id: true, runId: true },
    });
    assert.equal(all.length, 1, "no second finalize job may appear beside the stranded one");
    assert.equal(
      all[0].runId,
      autoFinalizeContinuationRunId({ tenderId, userId, analysisRevision: REVISION }),
      "the adopted row must carry the deterministic runId so it can never be duplicated again",
    );
  });

  it("is idempotent across repeated reruns", async () => {
    const a = await ensureAutoFinalizeContinuationJob({ tenderId, userId, analysisRevision: REVISION });
    const b = await ensureAutoFinalizeContinuationJob({ tenderId, userId, analysisRevision: REVISION });
    assert.equal(a.jobId, b.jobId);
    const count = await prisma.aiJob.count({ where: { tenderId, jobType: "AUTO_FINALIZE" } });
    assert.equal(count, 1);
  });

  it("lets exactly one worker claim the finalize stage", async () => {
    // Two workers racing for the same stage is the ordinary case once a wake
    // and a retry sweep overlap. The claim is a single UPDATE ... FOR UPDATE
    // SKIP LOCKED against status = 'QUEUED', so the loser must get nothing
    // rather than a second finalization of the same package.
    const [first, second] = await Promise.all([
      claimJobForCaller({ jobType: "AUTO_FINALIZE", tenderId, userId, global: false }),
      claimJobForCaller({ jobType: "AUTO_FINALIZE", tenderId, userId, global: false }),
    ]);
    const claims = [first, second].filter(Boolean);
    assert.equal(claims.length, 1, "only one worker may finalize");
    assert.equal(claims[0].id, strandedFinalizeJobId);

    const row = await prisma.aiJob.findUnique({
      where: { id: strandedFinalizeJobId },
      select: { status: true },
    });
    assert.equal(row.status, "RUNNING");

    // And a claimed (RUNNING) stage must not be handed out again.
    const third = await claimJobForCaller({ jobType: "AUTO_FINALIZE", tenderId, userId, global: false });
    assert.equal(third, null);
  });

  it("reports a running finalize stage as unclaimable instead of duplicating it", async () => {
    // The previous test left the row RUNNING. A rerun arriving now must not
    // create a parallel finalize job for the same revision.
    const finalize = await ensureAutoFinalizeContinuationJob({ tenderId, userId, analysisRevision: REVISION });
    assert.equal(finalize.state, "ALREADY_RUNNING");
    assert.equal(finalize.claimable, false);
    const count = await prisma.aiJob.count({ where: { tenderId, jobType: "AUTO_FINALIZE" } });
    assert.equal(count, 1);
  });

  it("treats a finished pipeline as finished rather than rebuilding the package", async () => {
    await prisma.aiJob.update({
      where: { id: strandedFinalizeJobId },
      data: { status: "SUCCEEDED", output: JSON.stringify({ ok: true }) },
    });
    const finalize = await ensureAutoFinalizeContinuationJob({ tenderId, userId, analysisRevision: REVISION });
    assert.equal(finalize.state, "ALREADY_SUCCEEDED");
    assert.equal(finalize.claimable, false, "a completed finalization must not be re-run into a duplicate ZIP");
    const count = await prisma.aiJob.count({ where: { tenderId, jobType: "AUTO_FINALIZE" } });
    assert.equal(count, 1);
  });

  it("recovers a finalize stage whose worker never came back", async () => {
    // A worker killed mid-invocation leaves the row RUNNING forever, and a
    // RUNNING row is not claimable — so without recovery the pipeline
    // dead-ends here in exactly the way the Engine gate did, one stage lower.
    // The shared staleness rule decides, so a live finalization is untouched;
    // the ALREADY_RUNNING case above proves that, its row having been claimed
    // moments earlier and therefore still live.
    await prisma.aiJob.update({
      where: { id: strandedFinalizeJobId },
      data: {
        status: "RUNNING",
        startedAt: new Date(Date.now() - 60 * 60 * 1000),
        finishedAt: null,
        output: null,
      },
    });

    const finalize = await ensureAutoFinalizeContinuationJob({ tenderId, userId, analysisRevision: REVISION });
    assert.equal(finalize.jobId, strandedFinalizeJobId, "recovery re-arms the same job");
    assert.equal(finalize.state, "REARMED");
    assert.equal(finalize.claimable, true);

    const claimed = await claimJobForCaller({ jobType: "AUTO_FINALIZE", tenderId, userId, global: false });
    assert.ok(claimed, "the recovered stage must be claimable by a worker");
    assert.equal(claimed.id, strandedFinalizeJobId);

    const count = await prisma.aiJob.count({ where: { tenderId, jobType: "AUTO_FINALIZE" } });
    assert.equal(count, 1, "recovery must not leave a second finalize job behind");
  });

  it("gives a changed analysis revision its own finalize stage", async () => {
    // Idempotency is per revision, not per tender. New source material must
    // still be able to produce a new package.
    const nextRevision = `${REVISION}-amended`;
    const finalize = await ensureAutoFinalizeContinuationJob({
      tenderId,
      userId,
      analysisRevision: nextRevision,
    });
    assert.equal(finalize.state, "NEWLY_QUEUED");
    assert.equal(finalize.claimable, true);
    assert.notEqual(finalize.jobId, strandedFinalizeJobId);
    const count = await prisma.aiJob.count({ where: { tenderId, jobType: "AUTO_FINALIZE" } });
    assert.equal(count, 2);
  });
});
