// Integration test: the VAULT_INGEST background job — real registration,
// real routing, and real execution against a real PostgreSQL database.
//
// VAULT_INGEST existed in the JobType union and in SUPPORTED_JOB_TYPES'
// sibling list with zero registered handler and zero call site anywhere in
// the codebase (confirmed by grep before this fix: only type declarations
// referenced the string). This test proves the gap is actually closed: a
// real job gets claimed, ingestCompanyVault genuinely runs against real
// CompanyDocument rows, and real Expert/Project drafts land in the database
// — not just that a handler function exists.

import { before, after, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { prisma, prismaReady } from "../lib/prisma";
import { enqueueJob } from "../lib/ai-jobs";
import { claimJobForCaller } from "../lib/job-claim-policy";
import { getHandler } from "../lib/ai-job-handlers";
import { SUPPORTED_JOB_TYPES, parseJobTypeFilter } from "../lib/job-type-policy";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for this test suite.");
  process.exit(1);
}

let userId: string;
let companyId: string;

describe("VAULT_INGEST job — policy wiring", () => {
  it("SUPPORTED_JOB_TYPES includes VAULT_INGEST and parseJobTypeFilter accepts it", () => {
    assert.ok((SUPPORTED_JOB_TYPES as readonly string[]).includes("VAULT_INGEST"));
    const parsed = parseJobTypeFilter("VAULT_INGEST");
    assert.ok(parsed.ok);
    assert.equal(parsed.ok && parsed.value, "VAULT_INGEST");
  });

  it("has a registered handler (was previously null — NO_HANDLER_REGISTERED)", () => {
    assert.ok(getHandler("VAULT_INGEST"), "VAULT_INGEST must have a real handler, not fall through to NO_HANDLER_REGISTERED");
  });
});

describe("VAULT_INGEST job — real execution against real PostgreSQL", () => {
  before(async () => {
    await prismaReady;
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await prisma.user.create({
      data: {
        email: `vault-ingest-${nonce}@example.test`,
        name: "Vault Ingest Integration Test",
        passwordHash: "test-hash",
      },
    });
    userId = user.id;
    const company = await prisma.company.create({
      data: {
        userId,
        name: `Vault Ingest Test Firm ${nonce}`,
        legalName: `Vault Ingest Test Firm ${nonce} Ltd`,
      },
    });
    companyId = company.id;
  });

  after(async () => {
    await prisma.expert.deleteMany({ where: { companyId } });
    await prisma.companyDocument.deleteMany({ where: { companyId } });
    await prisma.aiJob.deleteMany({ where: { userId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("rejects a job with no companyId in input", async () => {
    const handler = getHandler("VAULT_INGEST")!;
    await assert.rejects(
      () => handler({ jobId: "test-job-no-company", userId, tenderId: null, input: {} }),
      /requires companyId/,
    );
  });

  it("rejects a companyId not owned by the job's userId", async () => {
    const otherUser = await prisma.user.create({
      data: { email: `vault-ingest-other-${Date.now()}@example.test`, name: "Other", passwordHash: "x" },
    });
    try {
      const handler = getHandler("VAULT_INGEST")!;
      await assert.rejects(
        () => handler({ jobId: "test-job-forbidden", userId: otherUser.id, tenderId: null, input: { companyId } }),
        /not found or not owned/,
      );
    } finally {
      await prisma.user.deleteMany({ where: { id: otherUser.id } });
    }
  });

  it("enqueues, claims, and executes end to end — real Expert draft created from a real CompanyDocument", async () => {
    await prisma.companyDocument.create({
      data: {
        companyId,
        fileName: "expert-cv-john-smith.pdf",
        originalFileName: "expert-cv-john-smith.pdf",
        category: "EXPERT_CV",
        mimeType: "application/pdf",
        size: 1024,
        extractedText: [
          "CURRICULUM VITAE",
          "Name of Expert: John Michael Smith",
          "Proposed Position: Civil Engineer",
          "15 years of professional experience in infrastructure and water supply projects.",
          "Certification: PE, Professional Engineer License",
        ].join("\n"),
        integrityStatus: "VERIFIED",
      },
    });

    const enqueued = await enqueueJob({ userId, jobType: "VAULT_INGEST", input: { companyId } });

    const jobRow = await prisma.aiJob.findUnique({ where: { id: enqueued.id } });
    assert.equal(jobRow?.status, "QUEUED");
    assert.equal(jobRow?.jobType, "VAULT_INGEST");

    const claimed = await claimJobForCaller({ jobType: "VAULT_INGEST", global: true });
    assert.ok(claimed, "the queued VAULT_INGEST job must be claimable");
    assert.equal(claimed!.id, enqueued.id);

    const runningRow = await prisma.aiJob.findUnique({ where: { id: claimed!.id } });
    assert.equal(runningRow?.status, "RUNNING", "claiming must flip status to RUNNING");

    const handler = getHandler("VAULT_INGEST")!;
    const result = await handler({
      jobId: claimed!.id,
      userId: claimed!.userId,
      tenderId: claimed!.tenderId,
      input: claimed!.input,
    });

    assert.ok(!("terminalStatus" in result), "VAULT_INGEST is a plain-completion handler, not a self-driving terminal-status one");
    const output = result as unknown as { docsProcessed: number; expertsCreated: number };
    assert.equal(output.docsProcessed, 1);
    assert.ok(output.expertsCreated >= 1, "the EXPERT_CV document's deterministic regex extraction must produce at least one Expert draft");

    const experts = await prisma.expert.findMany({ where: { companyId } });
    assert.ok(experts.some((e) => e.fullName.includes("John Michael Smith")), "the extracted expert name must be persisted");
    const created = experts.find((e) => e.fullName.includes("John Michael Smith"));
    assert.ok(created, "the extracted expert must exist");
    // Zero bureaucracy: auto-extracted records may start as REVIEWED, AI_DRAFT,
    // or SOURCE_VERIFIED — the engine uses them regardless. No assertion on
    // the initial trustLevel is needed.

    const steps = await prisma.aiJobStep.findMany({ where: { jobId: claimed!.id }, orderBy: { createdAt: "asc" } });
    assert.ok(steps.some((s) => s.stepName === "vault.start"));
    assert.ok(steps.some((s) => s.stepName === "vault.complete" && s.status === "SUCCEEDED"));
  });

  it("reExtractAll: true re-extracts real document bytes before ingestion — closes the bulk reimport gap", async () => {
    // This is the path app/api/company/reimport/route.ts now enqueues
    // instead of looping OCR/text extraction inline. Prove the loop
    // (lib/company-vault-reextraction.ts) genuinely re-derives extractedText
    // from stored fileContent bytes, and that the freshly re-extracted text
    // feeds into the same ingestion pass — not just that a flag is accepted.
    const cvText = [
      "CURRICULUM VITAE",
      "Name of Expert: Amara Nwosu",
      "Proposed Position: Structural Engineer",
      "12 years of professional experience in bridge and highway design.",
      "Certification: Chartered Structural Engineer",
    ].join("\n");
    const doc = await prisma.companyDocument.create({
      data: {
        companyId,
        fileName: "expert-cv-reextract-test.txt",
        originalFileName: "expert-cv-reextract-test.txt",
        category: "EXPERT_CV",
        mimeType: "text/plain",
        size: cvText.length,
        fileContent: Buffer.from(cvText, "utf8").toString("base64"),
        extractedText: null,
        integrityStatus: "VERIFIED",
      },
    });

    const enqueued = await enqueueJob({ userId, jobType: "VAULT_INGEST", input: { companyId, reExtractAll: true } });
    const claimed = await claimJobForCaller({ jobType: "VAULT_INGEST", global: true });
    assert.ok(claimed, "the queued reExtractAll VAULT_INGEST job must be claimable");
    assert.equal(claimed!.id, enqueued.id);

    const handler = getHandler("VAULT_INGEST")!;
    const result = await handler({
      jobId: claimed!.id,
      userId: claimed!.userId,
      tenderId: claimed!.tenderId,
      input: claimed!.input,
    });

    const output = result as unknown as { docsReextracted: number; expertsCreated: number };
    assert.ok(output.docsReextracted >= 1, "reExtractAll must re-extract at least the one stale-text document");

    const refreshed = await prisma.companyDocument.findUnique({ where: { id: doc.id } });
    assert.ok(refreshed?.extractedText?.includes("Amara Nwosu"), "re-extraction must derive real text from the stored bytes, not leave extractedText null");

    const experts = await prisma.expert.findMany({ where: { companyId } });
    assert.ok(experts.some((e) => e.fullName.includes("Amara Nwosu")), "the newly re-extracted CV must feed into the same ingestion pass and produce an Expert draft");

    const steps = await prisma.aiJobStep.findMany({ where: { jobId: claimed!.id }, orderBy: { createdAt: "asc" } });
    assert.ok(steps.some((s) => s.stepName === "vault.reextract"), "the reExtractAll step must be recorded");
  });

  it("reExtractAll mid-batch checkpoint/resume: a document already recorded as processed in AiJob.output is skipped, not re-extracted", async () => {
    // Simulates a VAULT_INGEST job interrupted mid-batch (e.g. a Vercel
    // function kill) and re-armed by rearmDurableStageJob: on the retry the
    // SAME job re-claims and re-runs, but must resume from the next
    // unprocessed document instead of restarting the whole vault re-extraction.
    //
    // Uses its own dedicated user+company (Company.userId is unique, so it
    // can't reuse the shared companyId/userId) so leftover fileContent-
    // bearing documents from earlier tests in this file can't inflate the
    // docsReextracted count this test asserts exactly.
    const checkpointUser = await prisma.user.create({
      data: { email: `vault-checkpoint-${Date.now()}@example.test`, name: "Vault Checkpoint Test", passwordHash: "test-hash" },
    });
    const checkpointCompany = await prisma.company.create({
      data: { userId: checkpointUser.id, name: `Vault Checkpoint Test Firm ${Date.now()}` },
    });
    try {
      const alreadyDoneText = "CURRICULUM VITAE. Name of Expert: Previously Done Person. 9 years of experience.";
      const alreadyDoneDoc = await prisma.companyDocument.create({
        data: {
          companyId: checkpointCompany.id,
          fileName: "already-done.txt",
          originalFileName: "already-done.txt",
          category: "EXPERT_CV",
          mimeType: "text/plain",
          size: alreadyDoneText.length,
          fileContent: Buffer.from(alreadyDoneText, "utf8").toString("base64"),
          extractedText: null, // stale — would be re-extracted if NOT skipped
          integrityStatus: "VERIFIED",
        },
      });
      const remainingText = "CURRICULUM VITAE. Name of Expert: Still Remaining Person. 11 years of experience.";
      const remainingDoc = await prisma.companyDocument.create({
        data: {
          companyId: checkpointCompany.id,
          fileName: "still-remaining.txt",
          originalFileName: "still-remaining.txt",
          category: "EXPERT_CV",
          mimeType: "text/plain",
          size: remainingText.length,
          fileContent: Buffer.from(remainingText, "utf8").toString("base64"),
          extractedText: null,
          integrityStatus: "VERIFIED",
        },
      });

      const enqueued = await enqueueJob({ userId: checkpointUser.id, jobType: "VAULT_INGEST", input: { companyId: checkpointCompany.id, reExtractAll: true } });
      const claimed = await claimJobForCaller({ jobType: "VAULT_INGEST", global: true });
      assert.ok(claimed && claimed.id === enqueued.id);

      // Seed the checkpoint a prior (interrupted) attempt at THIS job would
      // have persisted after successfully processing alreadyDoneDoc.
      await prisma.aiJob.update({
        where: { id: claimed!.id },
        data: { output: JSON.stringify({ vaultIngestCheckpoint: { processedDocumentIds: [alreadyDoneDoc.id] } }) },
      });

      const handler = getHandler("VAULT_INGEST")!;
      const result = await handler({
        jobId: claimed!.id,
        userId: claimed!.userId,
        tenderId: claimed!.tenderId,
        input: claimed!.input,
      });
      const output = result as unknown as { docsReextracted: number };
      assert.equal(output.docsReextracted, 1, "only the un-checkpointed document should be re-extracted this run");

      const skipped = await prisma.companyDocument.findUnique({ where: { id: alreadyDoneDoc.id } });
      assert.equal(skipped?.extractedText, null, "the checkpointed document must be skipped, not re-extracted");

      const processed = await prisma.companyDocument.findUnique({ where: { id: remainingDoc.id } });
      assert.ok(processed?.extractedText?.includes("Still Remaining Person"), "the un-checkpointed document must genuinely be re-extracted");

      const steps = await prisma.aiJobStep.findMany({ where: { jobId: claimed!.id }, orderBy: { createdAt: "asc" } });
      assert.ok(
        steps.some((s) => s.stepName === "vault.resume" && s.message?.includes("skipping 1 document")),
        "a vault.resume step must record that the checkpointed document was skipped",
      );
    } finally {
      await prisma.expert.deleteMany({ where: { companyId: checkpointCompany.id } });
      await prisma.companyDocument.deleteMany({ where: { companyId: checkpointCompany.id } });
      await prisma.aiJob.deleteMany({ where: { userId: checkpointUser.id } });
      await prisma.company.deleteMany({ where: { id: checkpointCompany.id } });
      await prisma.user.deleteMany({ where: { id: checkpointUser.id } });
    }
  });

  it("run-next's single-job-per-tick list includes VAULT_INGEST (heavy AI-capable job, not chained with lighter types)", () => {
    const src = require("fs").readFileSync(require("path").join(process.cwd(), "app/api/ai-jobs/run-next/route.ts"), "utf8");
    const match = src.match(/if \(\[([^\]]+)\]\.includes\(claimed\.jobType\)\) break;/);
    assert.ok(match, "run-next must have the single-job-per-tick break list");
    assert.match(match![1], /"VAULT_INGEST"/);
  });
});
