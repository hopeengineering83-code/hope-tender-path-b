// P0 closure regression suite — analysis authority, source-revision binding,
// terminal-state honesty and deadline propagation.
//
// Each block pins one confirmed defect that existed at PR #1175 head
// f2be6001dab762d43b18a4f131c967a31aa07709. They are written to FAIL against
// that head and pass only against the fixed implementation.
//
// Evidence levels:
//   • Deadline propagation      — C (pure function, real execution)
//   • Canonical input identity   — C (real builder, real fixtures)
//   • Pre-provider drift block   — B (PostgreSQL, real job rows, fetch spy
//                                    proving providerCallCount === 0)
//   • Superseded terminal state  — B (PostgreSQL, real promotion race)
//
// The B-level blocks require RUN_DB_INTEGRATION=true and a real PostgreSQL
// DATABASE_URL (CI provides an ephemeral postgres:16 service container).

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import crypto from "crypto";

const RUN_DB = process.env.RUN_DB_INTEGRATION === "true";

// ─── Fixture text: long enough to clear the 100-char minimum ────────────────
const TENDER_TEXT_A =
  "SECTION 1 — INSTRUCTIONS TO BIDDERS. The procuring entity is the Ministry of Works. " +
  "Bids must be submitted by email to tenders@ministry.example before the deadline. " +
  "Evaluation criteria are set out in Section 3 and required forms in Annex A. " +
  "This paragraph exists to comfortably exceed the minimum extracted-text length.";

const TENDER_TEXT_B =
  "SECTION 1 — REVISED INSTRUCTIONS TO BIDDERS. The procuring entity is the Ministry of Transport. " +
  "Bids must be delivered in hard copy to the tender box before the revised deadline. " +
  "Evaluation criteria have been restated and Annex A has been replaced in full. " +
  "This revised paragraph also exceeds the minimum extracted-text length requirement.";

// ════════════════════════════════════════════════════════════════════════════
// P0-D — Deadline propagation: a child must never create more time than its
// parent has left.
//
// Defect at f2be600: the AI_ANALYZE handler hardcoded `deadlineMs: 55_000`
// while /api/ai-jobs/run-next runs a 40s soft loop (maxRunMs) inside a 60s
// platform hard limit and hands each handler at most
// `remaining - 5s persistence reserve` (≤ 35s) via input.deadlineMs.
// ════════════════════════════════════════════════════════════════════════════
describe("P0-D: AI_ANALYZE deadline derives from the parent worker budget", () => {
  it("never exceeds the parent's stated budget", async () => {
    const { resolveAnalyzeDeadlineMs, ANALYZE_PERSISTENCE_RESERVE_MS } = await import(
      "../lib/ai-job-handlers-legacy"
    );

    const parentBudget = 35_000;
    const resolved = resolveAnalyzeDeadlineMs({ deadlineMs: parentBudget });

    assert.ok(
      resolved <= parentBudget,
      `child budget ${resolved}ms must not exceed parent budget ${parentBudget}ms`,
    );
    assert.equal(resolved, parentBudget - ANALYZE_PERSISTENCE_RESERVE_MS);
  });

  it("clamps to the time actually remaining before the parent's absolute deadline", async () => {
    const { resolveAnalyzeDeadlineMs } = await import("../lib/ai-job-handlers-legacy");

    // Parent claims a 35s budget but its absolute deadline is only 12s away —
    // e.g. this is the second job claimed in the same worker invocation.
    const now = 1_000_000;
    const resolved = resolveAnalyzeDeadlineMs(
      { deadlineMs: 35_000, absoluteDeadline: now + 12_000 },
      now,
    );

    assert.ok(
      resolved <= 12_000,
      `child budget ${resolved}ms must not exceed the ${12_000}ms remaining to the absolute deadline`,
    );
  });

  it("always reserves time to persist checkpoints and terminal status", async () => {
    const { resolveAnalyzeDeadlineMs, ANALYZE_PERSISTENCE_RESERVE_MS, ANALYZE_MIN_BUDGET_MS } =
      await import("../lib/ai-job-handlers-legacy");

    const now = 1_000_000;
    for (const remaining of [8_000, 15_000, 30_000]) {
      const resolved = resolveAnalyzeDeadlineMs(
        { deadlineMs: remaining, absoluteDeadline: now + remaining },
        now,
      );
      assert.ok(
        resolved <= remaining - ANALYZE_PERSISTENCE_RESERVE_MS || resolved === ANALYZE_MIN_BUDGET_MS,
        `budget ${resolved}ms from ${remaining}ms leaves no persistence reserve`,
      );
    }
  });

  it("never returns the old hardcoded 55s, even without parent budget info", async () => {
    const { resolveAnalyzeDeadlineMs, ANALYZE_FALLBACK_BUDGET_MS } = await import(
      "../lib/ai-job-handlers-legacy"
    );

    // The worker's absolute ceiling: 40s soft loop minus the 5s reserve.
    const MAX_POSSIBLE_PARENT_BUDGET_MS = 35_000;

    for (const input of [undefined, {}, { deadlineMs: "bad" }, { absoluteDeadline: null }]) {
      const resolved = resolveAnalyzeDeadlineMs(input as Record<string, unknown> | undefined);
      assert.notEqual(resolved, 55_000, "55s exceeds the worker's entire 40s loop");
      assert.ok(
        resolved <= MAX_POSSIBLE_PARENT_BUDGET_MS,
        `fallback ${resolved}ms exceeds the largest budget a parent can ever grant`,
      );
    }
    assert.ok(ANALYZE_FALLBACK_BUDGET_MS <= MAX_POSSIBLE_PARENT_BUDGET_MS);
  });

  it("stays positive when the parent deadline has already passed", async () => {
    const { resolveAnalyzeDeadlineMs, ANALYZE_MIN_BUDGET_MS } = await import(
      "../lib/ai-job-handlers-legacy"
    );

    const now = 1_000_000;
    const resolved = resolveAnalyzeDeadlineMs({ deadlineMs: 1_000, absoluteDeadline: now - 5_000 }, now);
    assert.equal(resolved, ANALYZE_MIN_BUDGET_MS, "must floor at the minimum, never go negative");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// P0-A — Exactly one canonical algorithm defines the AI Analyze input.
//
// Defect at f2be600: runNextChunk rebuilt the input as
// `[FILE_ID:…|FILE_NAME:…]\n<raw extractedText>` joined by "\n\n---\n\n",
// omitting title/description/intake notes and the Company Vault digest and
// applying none of the builder's truncation. It could never hash to the value
// createAnalysisJob froze into analysisInputHash.
// ════════════════════════════════════════════════════════════════════════════
describe("P0-A: one canonical AI Analyze input builder", () => {
  it("the builder binds tender scalars and Vault documents into the hashed input", async () => {
    const { buildTenderAnalysisContent, computeAnalysisContentHash } = await import(
      "../lib/engine/tender-analysis-content"
    );

    const files = [
      {
        id: "file-1",
        originalFileName: "itb.pdf",
        fileName: "itb.pdf",
        extractedText: TENDER_TEXT_A,
        classification: "TENDER_DOCUMENT",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        deletionStatus: "ACTIVE",
      },
    ];
    const base = {
      title: "Supply of Equipment",
      description: "Description of the works.",
      intakeSummary: "Intake notes from the bid team.",
      files,
    };
    const company = {
      documents: [
        { originalFileName: "iso9001.pdf", category: "CERTIFICATE", extractedText: "ISO 9001 certificate body." },
      ],
    };

    const baseline = computeAnalysisContentHash(buildTenderAnalysisContent(base, company));

    // Every dependency that feeds the builder must change the hash. If any of
    // these did not, that input could drift without invalidating the analysis.
    const mutations: Array<[string, string]> = [
      ["title", computeAnalysisContentHash(buildTenderAnalysisContent({ ...base, title: "Different Title" }, company))],
      ["description", computeAnalysisContentHash(buildTenderAnalysisContent({ ...base, description: "Changed." }, company))],
      ["intakeSummary", computeAnalysisContentHash(buildTenderAnalysisContent({ ...base, intakeSummary: "Changed." }, company))],
      [
        "file extracted text",
        computeAnalysisContentHash(
          buildTenderAnalysisContent({ ...base, files: [{ ...files[0], extractedText: TENDER_TEXT_B }] }, company),
        ),
      ],
      [
        "Vault document text",
        computeAnalysisContentHash(
          buildTenderAnalysisContent(base, {
            documents: [{ originalFileName: "iso9001.pdf", category: "CERTIFICATE", extractedText: "Revised body." }],
          }),
        ),
      ],
      [
        "Vault document set",
        computeAnalysisContentHash(
          buildTenderAnalysisContent(base, {
            documents: [
              ...company.documents,
              { originalFileName: "extra.pdf", category: "CERTIFICATE", extractedText: "Additional vault document." },
            ],
          }),
        ),
      ],
    ];

    for (const [label, hash] of mutations) {
      assert.notEqual(hash, baseline, `${label} must change canonicalAnalysisInputSha256`);
    }
  });

  it("is deterministic — identical inputs produce identical bytes and hash", async () => {
    const { buildTenderAnalysisContent, computeAnalysisContentHash } = await import(
      "../lib/engine/tender-analysis-content"
    );

    const build = () =>
      buildTenderAnalysisContent(
        {
          title: "Supply of Equipment",
          description: "Description of the works.",
          intakeSummary: "Intake notes.",
          files: [
            {
              id: "file-1",
              originalFileName: "itb.pdf",
              fileName: "itb.pdf",
              extractedText: TENDER_TEXT_A,
              createdAt: new Date("2026-01-01T00:00:00Z"),
              deletionStatus: "ACTIVE",
            },
            {
              id: "file-2",
              originalFileName: "annex.pdf",
              fileName: "annex.pdf",
              extractedText: TENDER_TEXT_B,
              createdAt: new Date("2026-01-02T00:00:00Z"),
              deletionStatus: "ACTIVE",
            },
          ],
        },
        { documents: [{ originalFileName: "iso.pdf", category: "CERTIFICATE", extractedText: "ISO body." }] },
      );

    assert.equal(build(), build(), "builder must be byte-deterministic");
    assert.equal(computeAnalysisContentHash(build()), computeAnalysisContentHash(build()));
  });

  it("no code path reconstructs the analysis input with the ad-hoc FILE_ID concatenation", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("lib/ai-jobs/analysis-job-service.ts", "utf8");

    // The exact shape of the removed second algorithm.
    const adHocReconstruction = /\.map\(\s*\(\s*f\s*\)\s*=>\s*`\[FILE_ID:\$\{f\.id\}\|FILE_NAME:/;
    assert.ok(
      !adHocReconstruction.test(source),
      "runNextChunk must not rebuild the analysis input with its own concatenation",
    );
    assert.match(
      source,
      /buildTenderAnalysisContent/,
      "runNextChunk must reconstruct the input through the canonical builder",
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// P0-B — Source drift must be blocked BEFORE any provider request.
//
// Defect at f2be600: executeAnalysis recomputed the canonical content from
// CURRENT sources and called analyzeWithAI without ever comparing it to the
// authorized job's analysisInputHash. verifyAnalysisSnapshot existed but had no
// live caller — only the dead runNextChunk referenced it.
//
// The fetch spy is the real evidence: provider adapters issue their requests
// through global fetch, so a zero call count proves no provider was contacted
// and no tokens were spent.
// ════════════════════════════════════════════════════════════════════════════
describe("P0-B: pre-provider source-drift block", { skip: !RUN_DB }, () => {
  async function seedAuthorizedAnalysis(label: string) {
    const { prisma } = await import("../lib/prisma");
    const { createAnalysisJob } = await import("../lib/ai-jobs/analysis-job-service");
    const bcrypt = (await import("bcryptjs")).default;

    const user = await prisma.user.create({
      data: {
        email: `${label}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}@example.test`,
        passwordHash: await bcrypt.hash("Drift-password-2026-secure!", 10),
        role: "ADMIN",
        name: "Drift Test",
      },
    });
    await prisma.company.create({
      data: { userId: user.id, name: "Drift Co", legalName: "Drift Co", setupCompletedAt: new Date() },
    });
    const tender = await prisma.tender.create({
      data: {
        userId: user.id,
        title: "Drift Test Tender",
        description: "Original description.",
        intakeSummary: "Original intake notes.",
        files: {
          create: [
            {
              originalFileName: "itb.pdf",
              fileName: "itb.pdf",
              mimeType: "text/plain",
              size: 5000,
              extractedText: TENDER_TEXT_A,
              deletionStatus: "ACTIVE",
              contentSha256: "a".repeat(64),
              integrityStatus: "VERIFIED",
              extractionScore: 90,
              extractionMethod: "text",
            },
          ],
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

    return { prisma, user, tender, jobId: job.jobId };
  }

  async function cleanup(prisma: any, userId: string, tenderId: string) {
    await prisma.aiAnalyzeChunk.deleteMany({ where: { userId } });
    await prisma.aiJobStep.deleteMany({ where: { job: { userId } } }).catch(() => {});
    await prisma.aiJob.deleteMany({ where: { userId } });
    await prisma.tenderFile.deleteMany({ where: { tenderId } });
    await prisma.tender.deleteMany({ where: { userId } });
    await prisma.companyDocument.deleteMany({ where: { company: { userId } } }).catch(() => {});
    await prisma.company.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  }

  /**
   * Run executeAnalysis with global fetch replaced by a counting spy, so the
   * assertion "no provider was called" is a measured fact, not an inference.
   */
  async function runWithFetchSpy(tenderId: string, userId: string, jobId: string) {
    const { executeAnalysis } = await import("../lib/engine/analysis-orchestrator");
    const realFetch = globalThis.fetch;
    let providerCallCount = 0;
    const attemptedUrls: string[] = [];

    globalThis.fetch = (async (input: any, init?: any) => {
      providerCallCount += 1;
      attemptedUrls.push(typeof input === "string" ? input : String(input?.url ?? input));
      return realFetch(input, init);
    }) as typeof globalThis.fetch;

    let error: Error | null = null;
    try {
      await executeAnalysis(tenderId, userId, { existingJobId: jobId });
    } catch (err) {
      error = err instanceof Error ? err : new Error(String(err));
    } finally {
      globalThis.fetch = realFetch;
    }

    return { providerCallCount, attemptedUrls, error };
  }

  const driftCases: Array<{ name: string; mutate: (ctx: any) => Promise<void> }> = [
    {
      name: "title mutation",
      mutate: async ({ prisma, tender }) =>
        void (await prisma.tender.update({ where: { id: tender.id }, data: { title: "Retitled Tender" } })),
    },
    {
      name: "description mutation",
      mutate: async ({ prisma, tender }) =>
        void (await prisma.tender.update({ where: { id: tender.id }, data: { description: "Amended description." } })),
    },
    {
      name: "intakeSummary mutation",
      mutate: async ({ prisma, tender }) =>
        void (await prisma.tender.update({
          where: { id: tender.id },
          data: { intakeSummary: "Amended intake notes." },
        })),
    },
    {
      name: "file content mutation",
      mutate: async ({ prisma, tender }) =>
        void (await prisma.tenderFile.update({
          where: { id: tender.files[0].id },
          data: { extractedText: TENDER_TEXT_B },
        })),
    },
    {
      name: "active file addition",
      mutate: async ({ prisma, tender }) =>
        void (await prisma.tenderFile.create({
          data: {
            tenderId: tender.id,
            originalFileName: "addendum.pdf",
            fileName: "addendum.pdf",
            mimeType: "text/plain",
            size: 4000,
            extractedText: TENDER_TEXT_B,
            deletionStatus: "ACTIVE",
            contentSha256: "b".repeat(64),
            integrityStatus: "VERIFIED",
            extractionScore: 90,
            extractionMethod: "text",
          },
        })),
    },
    {
      name: "file deletion",
      mutate: async ({ prisma, tender }) =>
        void (await prisma.tenderFile.update({
          where: { id: tender.files[0].id },
          data: { deletionStatus: "DELETED" },
        })),
    },
    {
      name: "Company Vault document added",
      mutate: async ({ prisma, user }) => {
        const company = await prisma.company.findUnique({ where: { userId: user.id } });
        await prisma.companyDocument.create({
          data: {
            companyId: company.id,
            originalFileName: "new-cert.pdf",
            fileName: "new-cert.pdf",
            category: "CERTIFICATE",
            mimeType: "text/plain",
            size: 1200,
            extractedText: "A newly uploaded certificate that feeds the canonical analysis input.",
          },
        });
      },
    },
  ];

  for (const testCase of driftCases) {
    it(`spends zero provider calls and fails closed on ${testCase.name}`, async () => {
      const ctx = await seedAuthorizedAnalysis("drift");
      const { prisma, user, tender, jobId } = ctx;

      try {
        await testCase.mutate(ctx);

        const { providerCallCount, attemptedUrls, error } = await runWithFetchSpy(tender.id, user.id, jobId);

        assert.equal(
          providerCallCount,
          0,
          `a drifted revision must not reach any provider (attempted: ${attemptedUrls.join(", ")})`,
        );
        assert.ok(error, "executeAnalysis must fail closed on drift");
        assert.match(
          error!.message,
          /ANALYSIS_SOURCE_DRIFT/,
          `expected ANALYSIS_SOURCE_DRIFT, got: ${error!.message}`,
        );

        const row = await prisma.aiJob.findUnique({ where: { id: jobId } });
        assert.ok(row, "job row must still exist");
        assert.equal(row!.status, "SUPERSEDED", "drifted run must not hold a success or running status");
        assert.equal(row!.promotedAt, null, "a drifted run must never promote");

        // No checkpoint may be written under the drifted revision's hash.
        const chunkStatuses = await prisma.aiAnalyzeChunk.findMany({
          where: { jobId },
          select: { status: true },
        });
        assert.ok(
          chunkStatuses.every((c: any) => c.status === "QUEUED"),
          "drift must not advance any chunk checkpoint",
        );
      } finally {
        await cleanup(prisma, user.id, tender.id);
      }
    });
  }

  it("does not block when the sources are unchanged (no false positives)", async () => {
    const { prisma, user, tender, jobId } = await seedAuthorizedAnalysis("nodrift");
    try {
      const { error } = await runWithFetchSpy(tender.id, user.id, jobId);

      // With no provider keys configured the run still fails, but it must NOT
      // fail as drift — an unchanged revision is authorized to proceed.
      if (error) {
        assert.doesNotMatch(
          error.message,
          /ANALYSIS_SOURCE_DRIFT/,
          "an unchanged source revision must not be reported as drift",
        );
      }
      const row = await prisma.aiJob.findUnique({ where: { id: jobId } });
      assert.ok(row, "job row must still exist");
      assert.notEqual(row!.status, "SUPERSEDED", "unchanged sources must not be marked superseded");
    } finally {
      await cleanup(prisma, user.id, tender.id);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// P0-C — A superseded analysis must never report SUCCEEDED.
//
// Defect at f2be600: finalizeJob wrote
// `status: failed.length > 0 ? "PARTIAL_SUCCESS" : "SUCCEEDED"` in the very
// same update that recorded `superseded: true` and
// "Not promoted to canonical" — a success status on a run that promoted
// nothing. The transactional branch additionally returned "SUPERSEDED" to its
// caller while writing "SUCCEEDED" to the row.
// ════════════════════════════════════════════════════════════════════════════
describe("P0-C: superseded analysis terminal-state semantics", { skip: !RUN_DB }, () => {
  it("loser of a promotion race is SUPERSEDED, never SUCCEEDED, and never promotes", async () => {
    const { prisma } = await import("../lib/prisma");
    const { finalizeJob } = await import("../lib/ai-jobs/analysis-job-service");
    const bcrypt = (await import("bcryptjs")).default;

    const user = await prisma.user.create({
      data: {
        email: `superseded-${Date.now()}-${crypto.randomUUID().slice(0, 8)}@example.test`,
        passwordHash: await bcrypt.hash("Superseded-password-2026-secure!", 10),
        role: "ADMIN",
        name: "Superseded Test",
      },
    });
    const tender = await prisma.tender.create({
      data: { userId: user.id, title: "Superseded Race Tender" },
    });

    try {
      const contentHash = crypto.createHash("sha256").update(TENDER_TEXT_A).digest("hex");

      // Analysis A starts first (lower autoincrement analysisVersion).
      const jobA = await prisma.aiJob.create({
        data: {
          tenderId: tender.id,
          userId: user.id,
          jobType: "AI_ANALYZE",
          status: "RUNNING",
          analysisInputHash: contentHash,
          runId: crypto.randomUUID(),
          input: JSON.stringify({
            tenderId: tender.id,
            contentHash,
            source: "manual-ai-analyze",
            manualRequested: true,
            actorUserId: user.id,
            authorizedAt: new Date().toISOString(),
          }),
        },
      });

      // A produced real work: one SUCCEEDED chunk. Requirements are
      // non-mandatory so the strict-grounding gate is not what stops promotion —
      // the supersession is.
      await prisma.aiAnalyzeChunk.create({
        data: {
          tenderId: tender.id,
          userId: user.id,
          contentHash,
          chunkIndex: 0,
          totalChunks: 1,
          status: "SUCCEEDED",
          jobId: jobA.id,
          resultJson: JSON.stringify({
            summary: "Analysis A summary",
            requirements: [
              {
                title: "Optional supporting document",
                description: "Provide a company profile.",
                requirementType: "DOCUMENT",
                priority: "OPTIONAL",
              },
            ],
            exactFileNaming: [],
            exactFileOrder: [],
            evaluationMethodology: "",
            submissionNotes: "",
          }),
        },
      });

      // Analysis B becomes authoritative afterwards (higher analysisVersion).
      const jobB = await prisma.aiJob.create({
        data: {
          tenderId: tender.id,
          userId: user.id,
          jobType: "AI_ANALYZE",
          status: "RUNNING",
          analysisInputHash: contentHash,
          runId: crypto.randomUUID(),
          input: JSON.stringify({
            tenderId: tender.id,
            contentHash,
            source: "manual-ai-analyze",
            manualRequested: true,
            actorUserId: user.id,
            authorizedAt: new Date().toISOString(),
          }),
        },
      });

      // A finishes last and attempts to finalize.
      const result = await finalizeJob(jobA.id, user.id);

      assert.notEqual(result.status, "SUCCEEDED", "a superseded run must not return SUCCEEDED");
      assert.notEqual(result.status, "PARTIAL_SUCCESS", "a superseded run must not return a success state");
      assert.equal(result.status, "SUPERSEDED");

      const rowAMaybe = await prisma.aiJob.findUnique({ where: { id: jobA.id } });
      assert.ok(rowAMaybe, "job A row must still exist");
      const rowA = rowAMaybe!;
      assert.notEqual(rowA.status, "SUCCEEDED", "the persisted row must not claim SUCCEEDED");
      assert.notEqual(rowA.status, "PARTIAL_SUCCESS", "the persisted row must not claim a success state");
      assert.equal(rowA.status, "SUPERSEDED");
      assert.equal(rowA.promotedAt, null, "a superseded run must never be promoted to canonical");
      assert.equal(rowA.supersededBy, jobB.id, "the winning job must be recorded");

      // The row and its own output must agree.
      const output = JSON.parse(rowA.output ?? "{}");
      assert.equal(output.superseded, true);
      assert.equal(output.promoted, false);

      // B must be untouched by A's late finalization.
      const rowB = await prisma.aiJob.findUnique({ where: { id: jobB.id } });
      assert.ok(rowB, "job B row must still exist");
      assert.equal(rowB!.status, "RUNNING", "the authoritative run must not be overwritten by the loser");

      // The canonical resolver must report this as SUPERSEDED, not success.
      const { deriveAnalysisStateDetail } = await import("../lib/engine/analysis-state-resolver");
      const detail = deriveAnalysisStateDetail({
        job: {
          id: rowA.id,
          status: rowA.status,
          analysisInputHash: rowA.analysisInputHash,
          stagedMergedResult: rowA.stagedMergedResult,
          promotedAt: rowA.promotedAt,
          supersededBy: rowA.supersededBy,
          errorMessage: rowA.errorMessage,
          output: rowA.output,
          startedAt: rowA.startedAt,
          finishedAt: rowA.finishedAt,
        },
        chunks: [],
        legacyNotesAiAnalyzed: false,
        requirementsExtracted: 1,
        requirementsPersisted: 0,
        sourceReferencesCreated: false,
        metadataFieldsPersisted: false,
        sectionsDetectedButNoRequirements: false,
      } as any);
      assert.notEqual(detail.state, "AI_SUCCEEDED", "resolver must never call a superseded run successful");
      assert.equal(detail.state, "SUPERSEDED", "resolver must report the run as superseded");
      assert.equal(detail.canonicalJobId, null, "a superseded run must never be the canonical job");
    } finally {
      await prisma.aiAnalyzeChunk.deleteMany({ where: { userId: user.id } });
      await prisma.aiJobStep.deleteMany({ where: { job: { userId: user.id } } }).catch(() => {});
      await prisma.aiJob.deleteMany({ where: { userId: user.id } });
      await prisma.tender.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it("no finalizer branch pairs a success status with a superseded outcome", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("lib/ai-jobs/analysis-job-service.ts", "utf8");

    // The exact contradictory write that existed at f2be600.
    const contradictorySupersededWrite =
      /status:\s*failed\.length\s*>\s*0\s*\?\s*"PARTIAL_SUCCESS"\s*:\s*"SUCCEEDED",[\s\S]{0,400}?[Ss]uperseded/;
    assert.ok(
      !contradictorySupersededWrite.test(source),
      "a superseded run must never be written with a success status",
    );
  });
});
