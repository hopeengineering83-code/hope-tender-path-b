// PostgreSQL-backed behavioral test for the analysisInputHash binding fix.
//
// Context: the AI Analyze route (streaming + non-streaming) computes the
// canonical content hash but historically never persisted it to
// AiJob.analysisInputHash. The release snapshot and the generation gate confirm
// an analysis is current by comparing the live content hash against that column;
// with it left null, `contentHashMatch` was always false and every tender was
// permanently reported as "Tender content changed since the last analysis",
// blocking generation/export with no possible user resolution.
//
// This test seeds AiJobs the EXACT way each fixed path now persists them — the
// chunked (streaming) shape and the single-shot (non-streaming) shape — using
// the SAME canonical hash builder (lib/engine/tender-analysis-content) the route,
// the snapshot, and the generation gate all share, then drives the REAL snapshot
// and REAL generation gate against real PostgreSQL to prove:
//
//   1. persisted AiJob.analysisInputHash === the canonical computed hash
//   2. the release snapshot reports contentHashMatch === true
//   3. ANALYSIS_HASH_MISMATCH disappears after a successful, hash-bound analysis
//      (and — regression guard — REappears when the hash is not persisted)
//   4. partial and superseded jobs still cannot authorize generation
//   5. zero GeneratedDocument rows are created by analysis persistence
//
// It also confirms the deterministic Company-Vault-document ordering: the hash is
// independent of the physical row order PostgreSQL returns.
//
// RUN_DB_INTEGRATION=true + a real DATABASE_URL are required. The suite skips
// cleanly (dbDescribe) when the DB env is absent; CI runs it against Postgres.

import { after, before, it } from "node:test";
import { strict as assert } from "node:assert";
import type { PrismaClient } from "@prisma/client";
import {
  dbDescribe,
  getPrisma,
  testSuffix,
  seedUser,
  seedCompany,
  seedTender,
  seedTenderFile,
  seedRequirement,
  cleanupTender,
  cleanupUser,
  type TestUser,
} from "./helpers/db-acceptance-harness";
import {
  buildTenderAnalysisContent,
  computeAnalysisContentHash,
  type AnalysisContentFile,
  type AnalysisContentCompanyDocument,
} from "../lib/engine/tender-analysis-content";
import { getTenderReleaseSnapshot } from "../lib/engine/tender-release-snapshot";
import { assertTenderReadyForGenerationAndExport } from "../lib/engine/generation-readiness-gate";
import { createAnalysisJob } from "../lib/ai-jobs/analysis-job-service";

const EXTRACTED = [
  "SECTION 1 — SUBMISSION INSTRUCTIONS. Proposals must be submitted by email to",
  "procurement@ministry.example by 30 September 2026. SECTION 2 — EVALUATION",
  "CRITERIA. Technical 70 points, financial 30 points. SECTION 3 — REQUIRED",
  "DOCUMENTS. Bidders shall provide audited financial statements, company profile,",
  "and CVs of key personnel. Ministry of Test Infrastructure, Capital City.",
].join(" ");

// Recompute the canonical hash the way the release snapshot + generation gate do:
// active tender files (id/originalFileName/extractedText/classification/createdAt)
// plus the company vault-document digest.
function canonicalHashFor(
  files: AnalysisContentFile[],
  companyDocs: AnalysisContentCompanyDocument[],
  tender: { title: string | null; description: string | null; intakeSummary: string | null },
): string {
  return computeAnalysisContentHash(
    buildTenderAnalysisContent(
      { title: tender.title, description: tender.description, intakeSummary: tender.intakeSummary, files },
      companyDocs.length ? { documents: companyDocs } : undefined,
    ),
  );
}

async function loadCanonicalInputs(prisma: PrismaClient, tenderId: string, userId: string) {
  const tender = await prisma.tender.findFirstOrThrow({
    where: { id: tenderId, userId },
    select: { title: true, description: true, intakeSummary: true },
  });
  const files = await prisma.tenderFile.findMany({
    where: { tenderId, deletionStatus: "ACTIVE" },
    select: { id: true, originalFileName: true, extractedText: true, classification: true, createdAt: true },
  });
  const company = await prisma.company.findUnique({
    where: { userId },
    select: { documents: { select: { originalFileName: true, category: true, extractedText: true } } },
  });
  return {
    tender,
    files: files as AnalysisContentFile[],
    companyDocs: (company?.documents ?? []) as AnalysisContentCompanyDocument[],
  };
}

async function seedCompanyDocument(
  prisma: PrismaClient,
  companyId: string,
  originalFileName: string,
  category: string,
  extractedText: string,
) {
  await prisma.companyDocument.create({
    data: {
      companyId,
      fileName: originalFileName.toLowerCase().replace(/\s+/g, "-"),
      originalFileName,
      mimeType: "application/pdf",
      size: 4096,
      category,
      extractedText,
      aiExtractionStatus: "EXTRACTED",
    },
  });
}

// Persist a SUCCEEDED, promoted, hash-bound job exactly as the fixed route does.
// chunkCount === 0 models the non-streaming single-shot path; chunkCount > 0
// models the streaming chunked path (chunk rows keyed by the SAME contentHash).
async function seedSuccessfulHashBoundJob(
  prisma: PrismaClient,
  tenderId: string,
  userId: string,
  contentHash: string,
  chunkCount: number,
) {
  const job = await prisma.aiJob.create({
    data: {
      tenderId,
      userId,
      jobType: "AI_ANALYZE",
      status: "SUCCEEDED",
      analysisInputHash: contentHash, // ← the fix under test
      promotedAt: new Date(),
      promotedBy: userId,
      startedAt: new Date(Date.now() - 5000),
      finishedAt: new Date(),
      input: JSON.stringify({ contentHash }),
      output: JSON.stringify({ analysisSource: "AI", contentHash, isPartial: false }),
    },
    select: { id: true, analysisInputHash: true },
  });
  for (let i = 0; i < chunkCount; i++) {
    await prisma.aiAnalyzeChunk.create({
      data: {
        tenderId,
        userId,
        contentHash,
        chunkIndex: i,
        totalChunks: chunkCount,
        status: "SUCCEEDED",
        jobId: job.id,
        provider: "test-provider",
        finishedAt: new Date(),
      },
    });
  }
  return job;
}

dbDescribe("AI Analyze analysisInputHash binding (PostgreSQL behavioral)", () => {
  const prisma = getPrisma();
  const suffix = testSuffix();
  let user: TestUser;
  let companyId: string;
  const tenderIds: string[] = [];

  before(async () => {
    user = await seedUser(prisma, suffix, "PROPOSAL_MANAGER");
    const company = await seedCompany(prisma, user.id, suffix);
    companyId = company.id;
    // Seed vault documents in a deliberately NON-alphabetical insertion order so
    // the deterministic-sort fix is genuinely exercised (physical order != sorted).
    // SEVEN documents (> the old take:5 cap) so every success assertion below also
    // proves the route now hashes the FULL, unbounded vault-document set — matching
    // the snapshot/gate — rather than a capped subset that could never reproduce.
    await seedCompanyDocument(prisma, companyId, "Zulu Audited Financials.pdf", "FINANCIAL", "Audited statements 2025.");
    await seedCompanyDocument(prisma, companyId, "Alpha Company Profile.pdf", "PROFILE", "Company profile and history.");
    await seedCompanyDocument(prisma, companyId, "Mike Key Personnel CVs.pdf", "CV", "CVs of key experts.");
    await seedCompanyDocument(prisma, companyId, "Delta Tax Clearance.pdf", "LEGAL", "Tax clearance certificate.");
    await seedCompanyDocument(prisma, companyId, "Echo ISO Certificate.pdf", "CERT", "ISO 9001 certificate.");
    await seedCompanyDocument(prisma, companyId, "Foxtrot Bank Reference.pdf", "FINANCIAL", "Bank reference letter.");
    await seedCompanyDocument(prisma, companyId, "Golf Project References.pdf", "PROJECT", "Past project references.");
  });

  after(async () => {
    for (const id of tenderIds) await cleanupTender(prisma, id);
    await cleanupUser(prisma, user.id);
  });

  async function seedTenderWithFile(): Promise<string> {
    const t = await seedTender(prisma, { userId: user.id, suffix: testSuffix() });
    tenderIds.push(t.id);
    await seedTenderFile(prisma, { tenderId: t.id, suffix: testSuffix(), extractedText: EXTRACTED });
    // A soft-deleted file that MUST NOT participate in the content hash. The
    // snapshot/gate exclude deletionStatus !== "ACTIVE"; the fixed route now does
    // too. Its presence proves a non-active file does not break contentHashMatch.
    await seedTenderFile(prisma, {
      tenderId: t.id,
      suffix: testSuffix(),
      extractedText: "SUPERSEDED DRAFT — this soft-deleted file must be excluded from the analysis hash.",
      deletionStatus: "DELETED",
    });
    // At least one requirement so the resolver treats the success as fully
    // structured (avoids SECTION_DETECTED_REQUIREMENTS_NOT_STRUCTURED).
    await seedRequirement(prisma, { tenderId: t.id, title: "Audited financial statements", priority: "MANDATORY" });
    return t.id;
  }

  // ── Both AI Analyze paths: hash bound, snapshot current, no hash-mismatch ──
  for (const path of [
    { name: "non-streaming single-shot path (chunkCount=0)", chunks: 0 },
    { name: "streaming chunked path (chunkCount=2)", chunks: 2 },
  ]) {
    it(`${path.name}: persists canonical hash, snapshot contentHashMatch=true, no ANALYSIS_HASH_MISMATCH, zero docs`, async () => {
      const tenderId = await seedTenderWithFile();
      const { tender, files, companyDocs } = await loadCanonicalInputs(prisma, tenderId, user.id);
      const canonical = canonicalHashFor(files, companyDocs, tender);

      const job = await seedSuccessfulHashBoundJob(prisma, tenderId, user.id, canonical, path.chunks);

      // (1) persisted analysisInputHash === canonical computed hash
      assert.equal(job.analysisInputHash, canonical, "AiJob.analysisInputHash must equal the canonical computed hash");

      // (2) release snapshot reports contentHashMatch === true and recomputes the
      //     identical hash from independent DB reads.
      const snapshot = await getTenderReleaseSnapshot(prisma, tenderId, user.id);
      assert.ok(snapshot, "snapshot must resolve");
      assert.equal(snapshot!.analysis.state, "AI_SUCCEEDED", "analysis must resolve to AI_SUCCEEDED");
      assert.equal(snapshot!.analysis.latestJobHash, canonical, "snapshot latestJobHash must equal the stored canonical hash");
      assert.equal(snapshot!.analysis.currentContentHash, canonical, "snapshot must recompute the identical canonical hash");
      assert.equal(snapshot!.analysis.contentHashMatch, true, "contentHashMatch must be true after a hash-bound success");
      assert.equal(
        snapshot!.analysis.blocker,
        null,
        `analysis blocker must be cleared, got: ${snapshot!.analysis.blocker}`,
      );

      // (3) ANALYSIS_HASH_MISMATCH must NOT be the generation-gate blocker.
      const gate = await assertTenderReadyForGenerationAndExport({ prisma, tenderId, userId: user.id, purpose: "generate" });
      assert.notEqual(
        gate.blockerCode,
        "ANALYSIS_HASH_MISMATCH",
        `hash mismatch must be gone after a successful hash-bound analysis, got blockerCode=${gate.blockerCode}`,
      );

      // (5) analysis persistence created zero generated documents.
      const docCount = await prisma.generatedDocument.count({ where: { tenderId } });
      assert.equal(docCount, 0, "analysis persistence must not create GeneratedDocument rows");
    });
  }

  // ── Regression guard: without the persisted hash, the mismatch returns ──
  it("regression: a promoted success with NULL analysisInputHash re-blocks with ANALYSIS_HASH_MISMATCH", async () => {
    const tenderId = await seedTenderWithFile();
    // Old (broken) behavior: promoted SUCCEEDED job but analysisInputHash left null.
    await prisma.aiJob.create({
      data: {
        tenderId,
        userId: user.id,
        jobType: "AI_ANALYZE",
        status: "SUCCEEDED",
        analysisInputHash: null,
        promotedAt: new Date(),
        promotedBy: user.id,
        startedAt: new Date(Date.now() - 5000),
        finishedAt: new Date(),
        input: "{}",
        output: JSON.stringify({ analysisSource: "AI" }),
      },
    });

    const snapshot = await getTenderReleaseSnapshot(prisma, tenderId, user.id);
    assert.ok(snapshot, "snapshot must resolve");
    assert.equal(snapshot!.analysis.contentHashMatch, false, "null hash must yield contentHashMatch=false");
    assert.match(
      snapshot!.analysis.blocker ?? "",
      /content changed since the last analysis/i,
      "null hash must surface the stale-analysis blocker",
    );

    const gate = await assertTenderReadyForGenerationAndExport({ prisma, tenderId, userId: user.id, purpose: "generate" });
    assert.equal(gate.ok, false, "generation must be blocked when the hash is not persisted");
    assert.equal(gate.blockerCode, "ANALYSIS_HASH_MISMATCH", "missing persisted hash must block with ANALYSIS_HASH_MISMATCH");
  });

  // ── Partial and superseded jobs cannot authorize generation ──
  it("partial (PARTIAL_SUCCESS) job cannot authorize generation", async () => {
    const tenderId = await seedTenderWithFile();
    const { tender, files, companyDocs } = await loadCanonicalInputs(prisma, tenderId, user.id);
    const canonical = canonicalHashFor(files, companyDocs, tender);
    await prisma.aiJob.create({
      data: {
        tenderId,
        userId: user.id,
        jobType: "AI_ANALYZE",
        status: "PARTIAL_SUCCESS",
        analysisInputHash: canonical,
        startedAt: new Date(Date.now() - 5000),
        finishedAt: new Date(),
        input: JSON.stringify({ contentHash: canonical }),
        output: JSON.stringify({ isPartial: true, contentHash: canonical }),
      },
    });

    const snapshot = await getTenderReleaseSnapshot(prisma, tenderId, user.id);
    assert.notEqual(snapshot!.analysis.state, "AI_SUCCEEDED", "partial analysis must not be AI_SUCCEEDED");

    const gate = await assertTenderReadyForGenerationAndExport({ prisma, tenderId, userId: user.id, purpose: "generate" });
    assert.equal(gate.ok, false, "partial analysis must not authorize generation");
  });

  it("superseded job cannot authorize generation", async () => {
    const tenderId = await seedTenderWithFile();
    const { tender, files, companyDocs } = await loadCanonicalInputs(prisma, tenderId, user.id);
    const canonical = canonicalHashFor(files, companyDocs, tender);
    // A SUCCEEDED+promoted+hash-bound job that has been marked superseded must
    // still fail closed — supersession dominates a stale promotion.
    await prisma.aiJob.create({
      data: {
        tenderId,
        userId: user.id,
        jobType: "AI_ANALYZE",
        status: "SUCCEEDED",
        analysisInputHash: canonical,
        promotedAt: new Date(),
        promotedBy: user.id,
        supersededBy: `superseding-${testSuffix()}`,
        startedAt: new Date(Date.now() - 5000),
        finishedAt: new Date(),
        input: JSON.stringify({ contentHash: canonical }),
        output: JSON.stringify({ contentHash: canonical }),
      },
    });

    const snapshot = await getTenderReleaseSnapshot(prisma, tenderId, user.id);
    assert.equal(snapshot!.analysis.state, "SUPERSEDED", "superseded job must resolve to SUPERSEDED");

    const gate = await assertTenderReadyForGenerationAndExport({ prisma, tenderId, userId: user.id, purpose: "generate" });
    assert.equal(gate.ok, false, "superseded analysis must not authorize generation");
  });

  // ── Background/durable path: createAnalysisJob persists the canonical hash ──
  // Invokes the REAL durable job service (the path AI Analyze uses in background
  // mode) against Postgres and proves the persisted analysisInputHash is exactly
  // what the snapshot recomputes — even with a soft-deleted file present and > the
  // old 5-doc vault cap. This is the end-to-end guard for the second P1.
  it("createAnalysisJob persists an analysisInputHash the snapshot reproduces (ACTIVE files + full vault)", async () => {
    const tenderId = await seedTenderWithFile(); // 1 active + 1 DELETED file; company has 7 vault docs
    const { tender, files, companyDocs } = await loadCanonicalInputs(prisma, tenderId, user.id);
    const canonical = canonicalHashFor(files, companyDocs, tender);

    const result = await createAnalysisJob({
      tenderId,
      userId: user.id,
      manualAuthority: {
        source: "manual-ai-analyze",
        actorUserId: user.id,
        authorizedAt: new Date().toISOString(),
      },
    });
    const job = await prisma.aiJob.findUniqueOrThrow({
      where: { id: result.jobId },
      select: { analysisInputHash: true },
    });

    // The durable path must persist the SAME canonical hash (active files + full vault).
    assert.equal(
      job.analysisInputHash,
      canonical,
      "createAnalysisJob must persist the canonical hash built from ACTIVE files + the full vault set",
    );

    // And the snapshot must reproduce it — no ANALYSIS_HASH_MISMATCH from the background path.
    const snapshot = await getTenderReleaseSnapshot(prisma, tenderId, user.id);
    assert.ok(snapshot, "snapshot must resolve");
    assert.equal(snapshot!.analysis.latestJobHash, canonical, "persisted background hash must equal canonical");
    assert.equal(snapshot!.analysis.currentContentHash, canonical, "snapshot must recompute the identical canonical hash");
    assert.equal(snapshot!.analysis.contentHashMatch, true, "background-path hash must be reproducible (contentHashMatch=true)");
  });

  // ── Deterministic Company-Vault ordering: hash is order-independent ──
  it("company vault digest is order-independent (deterministic sort)", async () => {
    const { tender, files, companyDocs } = await loadCanonicalInputs(prisma, tenderIds[0], user.id);
    assert.ok(companyDocs.length >= 3, "expected the seeded vault documents");
    const forward = canonicalHashFor(files, [...companyDocs], tender);
    const reversed = canonicalHashFor(files, [...companyDocs].reverse(), tender);
    // A full permutation of ALL documents (rotate by 2) — not a subset — so the
    // set is identical and only the order differs.
    const shuffled = canonicalHashFor(files, [...companyDocs.slice(2), ...companyDocs.slice(0, 2)], tender);
    assert.equal(forward, reversed, "hash must be identical when vault documents are reversed");
    assert.equal(forward, shuffled, "hash must be identical when vault documents are shuffled");
  });
});
