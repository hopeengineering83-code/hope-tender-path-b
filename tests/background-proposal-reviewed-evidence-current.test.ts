// PROPOSAL_GENERATION handler — real execution against real PostgreSQL.
//
// This used to be a source-regex test pinned to a since-removed bespoke
// implementation (its own AIBidWriterInput construction, its own
// generateProposalSectionsParallel call, its own reviewed-expert/project
// evidence checks keyed off a `sectionFilter` that no production caller ever
// set — see lib/ai-jobs/proposal-continuation-service.ts, the only enqueuer,
// which never sets input.sectionFilter). The handler now delegates entirely
// to generateTenderDocuments() (lib/engine/generate-elite.ts), the same
// canonical pipeline the interactive /api/tenders/[id]/generate route uses.
// generate-elite's own evidence guard (ZERO_REVIEWED_EXPERT_EVIDENCE /
// ZERO_REVIEWED_PROJECT_EVIDENCE / ZERO_REVIEWED_EVIDENCE) is already
// regression-tested in tests/generate-elite-zero-evidence-hardblock.test.ts
// and applies identically regardless of caller, so it is not re-tested here.
//
// What IS specific to this handler and worth proving against a real
// database: the fail-closed readiness gate runs BEFORE any generation work,
// and it genuinely blocks a tender with no AI Analyze / Build Plan history
// rather than silently proceeding. Building a full "generation-ready" fixture
// (source-grounded metadata across every critical field, matching content
// hash, chunk integrity, a confirmed submission plan) mirrors the ~850-line
// gate in lib/engine/generation-readiness-gate.ts closely enough that it is
// out of scope for this file; the gate's own logic has dedicated unit tests
// (tests/generation-readiness-gate.test.ts) covering that decision surface.

import { before, after, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { prisma, prismaReady } from "../lib/prisma";
import { getHandler } from "../lib/ai-job-handlers";
import { enqueueJob } from "../lib/ai-jobs";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for this test suite.");
  process.exit(1);
}

const handlerSource = readFileSync("lib/ai-job-handlers.ts", "utf8");

describe("PROPOSAL_GENERATION — single canonical implementation (import graph)", () => {
  it("imports the canonical generation pipeline and letterhead applier", () => {
    assert.match(handlerSource, /import \{ generateTenderDocuments \} from "\.\/engine\/generate-elite"/);
    assert.match(handlerSource, /import \{ applyActiveUploadedLetterheadToTenderDocuments \} from "\.\/engine\/apply-active-letterhead"/);
  });

  it("no longer imports or calls the removed bespoke background AI-writer path", () => {
    assert.doesNotMatch(handlerSource, /import[^;]*generateProposalSectionsParallel/);
    assert.doesNotMatch(handlerSource, /generateProposalSectionsParallel\(/);
    assert.doesNotMatch(handlerSource, /:\s*AIBidWriterInput/);
  });
});

describe("PROPOSAL_GENERATION handler — real execution against real PostgreSQL", () => {
  let userId: string;
  let tenderId: string;

  before(async () => {
    await prismaReady;
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await prisma.user.create({
      data: {
        email: `proposal-gen-${nonce}@example.test`,
        name: "Proposal Generation Integration Test",
        passwordHash: "test-hash",
      },
    });
    userId = user.id;
    const tender = await prisma.tender.create({
      data: {
        userId,
        title: `Proposal Generation Test Tender ${nonce}`,
      },
    });
    tenderId = tender.id;
  });

  after(async () => {
    await prisma.generatedDocument.deleteMany({ where: { tenderId } });
    await prisma.aiJob.deleteMany({ where: { userId } });
    await prisma.tender.deleteMany({ where: { id: tenderId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("rejects when tenderId is missing on the job", async () => {
    const handler = getHandler("PROPOSAL_GENERATION")!;
    await assert.rejects(
      () => handler({ jobId: "test-job-no-tender", userId, tenderId: null, input: {} }),
      /requires tenderId/,
    );
  });

  it("fails closed: a fresh tender with no AI Analyze / Build Plan history is blocked by the readiness gate before any document is created", async () => {
    const job = await enqueueJob({ userId, tenderId, jobType: "PROPOSAL_GENERATION", input: {} });
    const handler = getHandler("PROPOSAL_GENERATION")!;
    await assert.rejects(
      () => handler({ jobId: job.id, userId, tenderId, input: {} }),
      /PROPOSAL_GENERATION blocked by readiness gate/,
    );
    const docs = await prisma.generatedDocument.findMany({ where: { tenderId } });
    assert.equal(docs.length, 0, "a blocked readiness gate must create zero GeneratedDocument rows");
  });
});
