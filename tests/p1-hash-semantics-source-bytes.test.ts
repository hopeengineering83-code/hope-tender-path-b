// Hash semantics: a SHA-256 of extracted text is not byte integrity.
//
// The canonical analysis snapshot documented `fileContentHashes` as verifying
// "byte integrity", but it hashes `TenderFile.extractedText` — a DERIVED
// artifact. The original uploaded bytes are hashed separately into
// `TenderFile.contentSha256` (computeByteSha256, lib/engine/persisted-byte-integrity.ts).
// Conflating the two meant the snapshot could report a source as unchanged when
// the actual document had been replaced.
//
// The identities move independently in both directions:
//   • re-extraction / OCR changes the text while the bytes stay the same
//   • replacing the file with a different document that extracts to the same
//     text changes the bytes while the text stays the same
//
// The snapshot now freezes both and names each one honestly. The source-byte
// field is OPTIONAL so snapshots written before it existed keep verifying on
// extracted text alone — deploying this must not invalidate an in-flight job.
//
// Evidence level B (PostgreSQL, real snapshot creation and verification).

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";

const RUN_DB = process.env.RUN_DB_INTEGRATION === "true";

const EXTRACTED_TEXT =
  "SECTION 1 — INSTRUCTIONS TO BIDDERS. Bids must be submitted by 30 June 2026 at 15:00. " +
  "Annex A lists the required forms and Section 3 sets out the evaluation criteria. " +
  "This paragraph exists so the tender clears the minimum extracted-text length.";

const ORIGINAL_BYTE_SHA = "a".repeat(64);
const REPLACED_BYTE_SHA = "b".repeat(64);

type Seeded = { userId: string; tenderId: string; fileId: string; jobId: string };

async function seedAnalysisJob(): Promise<Seeded> {
  const { prisma } = await import("../lib/prisma");
  const { createAnalysisJob } = await import("../lib/ai-jobs/analysis-job-service");
  const bcrypt = (await import("bcryptjs")).default;

  const user = await prisma.user.create({
    data: {
      email: `hash-${randomUUID().slice(0, 8)}@example.test`,
      passwordHash: await bcrypt.hash("Hash-password-2026-secure!", 10),
      role: "ADMIN",
      name: "Hash Semantics Test",
    },
  });
  await prisma.company.create({
    data: { userId: user.id, name: "Hash Co", legalName: "Hash Co Ltd", setupCompletedAt: new Date() },
  });
  const tender = await prisma.tender.create({
    data: {
      userId: user.id,
      title: "Hash Semantics Tender",
      files: {
        create: [{
          originalFileName: "itb.pdf",
          fileName: "itb.pdf",
          mimeType: "application/pdf",
          size: 8192,
          extractedText: EXTRACTED_TEXT,
          deletionStatus: "ACTIVE",
          contentSha256: ORIGINAL_BYTE_SHA,
          integrityStatus: "VERIFIED",
          extractionScore: 94,
          extractionMethod: "text",
          totalPages: 10,
        }],
      },
    },
    include: { files: true },
  });

  const job = await createAnalysisJob({
    tenderId: tender.id,
    userId: user.id,
    manualAuthority: {
      source: "manual-ai-analyze",
      actorUserId: user.id,
      authorizedAt: new Date().toISOString(),
    },
  });

  return { userId: user.id, tenderId: tender.id, fileId: tender.files[0].id, jobId: job.jobId };
}

async function cleanup(seeded: Seeded) {
  const { prisma } = await import("../lib/prisma");
  const { userId, tenderId } = seeded;
  await prisma.aiAnalyzeChunk.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.aiJob.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.tenderFile.deleteMany({ where: { tenderId } }).catch(() => {});
  await prisma.tender.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.company.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
}

async function readSnapshot(jobId: string) {
  const { prisma } = await import("../lib/prisma");
  const job = await prisma.aiJob.findUnique({ where: { id: jobId }, select: { input: true } });
  return JSON.parse(job?.input ?? "{}").snapshot as {
    fileContentHashes: Record<string, string>;
    fileSourceByteHashes?: Record<string, string | null>;
  };
}

describe("hash semantics: extracted text and source bytes are distinct", { skip: !RUN_DB }, () => {
  it("freezes both identities, and they are not the same value", async () => {
    const seeded = await seedAnalysisJob();
    try {
      const snapshot = await readSnapshot(seeded.jobId);

      assert.ok(snapshot.fileContentHashes?.[seeded.fileId], "extracted-text hash must be recorded");
      assert.ok(snapshot.fileSourceByteHashes, "source-byte hashes must be recorded");
      assert.equal(
        snapshot.fileSourceByteHashes![seeded.fileId],
        ORIGINAL_BYTE_SHA,
        "the source-byte hash must be the file's contentSha256, not a hash of its text",
      );
      assert.notEqual(
        snapshot.fileContentHashes[seeded.fileId],
        snapshot.fileSourceByteHashes![seeded.fileId],
        "the two identities must not be the same value — conflating them was the defect",
      );
    } finally {
      await cleanup(seeded);
    }
  });

  it("detects replaced source bytes even when the extracted text is unchanged", async () => {
    const { prisma } = await import("../lib/prisma");
    const { verifyAnalysisSnapshot } = await import("../lib/ai-jobs/analysis-job-service");

    const seeded = await seedAnalysisJob();
    try {
      // The exact blind spot: a different document swapped in, extracting to
      // identical text. Before this change the snapshot reported valid.
      await prisma.tenderFile.update({
        where: { id: seeded.fileId },
        data: { contentSha256: REPLACED_BYTE_SHA },
      });

      const check = await verifyAnalysisSnapshot(seeded.jobId, seeded.tenderId, seeded.userId);
      assert.equal(check.valid, false, "replaced source bytes must invalidate the snapshot");
      assert.equal(check.superseded, true, "replaced source bytes must supersede the analysis");
      assert.equal(check.reason, "SOURCE_BYTE_DRIFT", `expected SOURCE_BYTE_DRIFT, got ${check.reason}`);
    } finally {
      await cleanup(seeded);
    }
  });

  it("still detects extracted-text drift, and names it accurately", async () => {
    const { prisma } = await import("../lib/prisma");
    const { verifyAnalysisSnapshot } = await import("../lib/ai-jobs/analysis-job-service");

    const seeded = await seedAnalysisJob();
    try {
      await prisma.tenderFile.update({
        where: { id: seeded.fileId },
        data: { extractedText: `${EXTRACTED_TEXT} Addendum 1 revises the deadline.` },
      });

      const check = await verifyAnalysisSnapshot(seeded.jobId, seeded.tenderId, seeded.userId);
      assert.equal(check.valid, false, "changed extracted text must invalidate the snapshot");
      // Renamed from FILE_CONTENT_DRIFT: the old name did not say WHICH content.
      assert.equal(check.reason, "EXTRACTED_TEXT_DRIFT", `expected EXTRACTED_TEXT_DRIFT, got ${check.reason}`);
    } finally {
      await cleanup(seeded);
    }
  });

  it("remains valid when nothing changed", async () => {
    const { verifyAnalysisSnapshot } = await import("../lib/ai-jobs/analysis-job-service");

    // Without this, a check that always failed would satisfy the tests above.
    const seeded = await seedAnalysisJob();
    try {
      const check = await verifyAnalysisSnapshot(seeded.jobId, seeded.tenderId, seeded.userId);
      assert.equal(check.valid, true, `unchanged sources must verify: ${check.reason}`);
      assert.equal(check.superseded, false);
    } finally {
      await cleanup(seeded);
    }
  });

  it("does not invalidate a legacy snapshot that predates the source-byte field", async () => {
    const { prisma } = await import("../lib/prisma");
    const { verifyAnalysisSnapshot } = await import("../lib/ai-jobs/analysis-job-service");

    const seeded = await seedAnalysisJob();
    try {
      // Simulate a job created before this change: no fileSourceByteHashes.
      const job = await prisma.aiJob.findUnique({ where: { id: seeded.jobId }, select: { input: true } });
      const parsed = JSON.parse(job!.input);
      delete parsed.snapshot.fileSourceByteHashes;
      await prisma.aiJob.update({ where: { id: seeded.jobId }, data: { input: JSON.stringify(parsed) } });

      // Even with the bytes replaced, a legacy snapshot verifies on extracted
      // text alone — deploying this must not strand in-flight work.
      await prisma.tenderFile.update({
        where: { id: seeded.fileId },
        data: { contentSha256: REPLACED_BYTE_SHA },
      });

      const check = await verifyAnalysisSnapshot(seeded.jobId, seeded.tenderId, seeded.userId);
      assert.equal(check.valid, true, `legacy snapshot must still verify: ${check.reason}`);
    } finally {
      await cleanup(seeded);
    }
  });

  it("tolerates a file that had no recorded byte hash at snapshot time", async () => {
    const { prisma } = await import("../lib/prisma");
    const { verifyAnalysisSnapshot } = await import("../lib/ai-jobs/analysis-job-service");

    const seeded = await seedAnalysisJob();
    try {
      const job = await prisma.aiJob.findUnique({ where: { id: seeded.jobId }, select: { input: true } });
      const parsed = JSON.parse(job!.input);
      parsed.snapshot.fileSourceByteHashes[seeded.fileId] = null;
      await prisma.aiJob.update({ where: { id: seeded.jobId }, data: { input: JSON.stringify(parsed) } });

      const check = await verifyAnalysisSnapshot(seeded.jobId, seeded.tenderId, seeded.userId);
      assert.equal(check.valid, true, `a null recorded byte hash is not comparable: ${check.reason}`);
    } finally {
      await cleanup(seeded);
    }
  });
});
