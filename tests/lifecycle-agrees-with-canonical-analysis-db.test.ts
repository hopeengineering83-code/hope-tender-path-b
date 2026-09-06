/**
 * The lifecycle route may not call a ready package partially ready.
 *
 * Reproduced live on a tender whose ZIP downloads (HTTP 200, three DOCX).
 * Asked at the same instant, on the same tender:
 *
 *   GET /export-readiness  → ok true,  status READY,  0 blockers
 *   GET /readiness-score   → ok true,  status READY,  0 blockers
 *   GET /lifecycle         → ok false, status PARTIAL, 0 blockers, 0 warnings
 *
 * PARTIAL with nothing attached: the owner is told the submission is not
 * fully ready and given nothing to act on.
 *
 * The cause was visible inside the lifecycle response itself, which carried
 * both answers at once:
 *
 *   analysisStatus: { source: "UNKNOWN", canonicalState: "AI_SUCCEEDED", ... }
 *
 * finalExportReady requires analysisSource === "AI". The orchestrator read
 * detectAnalysisSourceWithApproval, which inspects tender.notes alone, so an
 * AI Analyze proven by AiJob/AiAnalyzeChunk rows but carrying no notes marker
 * resolved to UNKNOWN. lib/engine/export-readiness.ts had already moved to
 * resolveCanonicalAnalysisSource — which is documented for exactly this — and
 * the lifecycle orchestrator had not, which is why the two routes disagreed.
 *
 * This test drives the real computeTenderLifecycle against real rows in that
 * exact shape. The second case pins the guard the old call site was protecting:
 * an unapproved regex fallback must still NOT read as AI.
 *
 * Requires RUN_DB_INTEGRATION=true. Skips cleanly otherwise.
 */

import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";

const RUN_DB = process.env.RUN_DB_INTEGRATION === "true";
const dbDescribe = RUN_DB ? describe : describe.skip;

dbDescribe("lifecycle analysis source agrees with the canonical resolver", () => {
  const { PrismaClient } = require("@prisma/client");
  const { randomUUID } = require("node:crypto");
  const { computeTenderLifecycle } = require("../lib/engine/tender-lifecycle-orchestrator");
  const { resolveTenderAnalysisState } = require("../lib/engine/analysis-state-resolver");

  const prisma = new PrismaClient();
  let userId = "";
  let tenderId = "";

  before(async () => {
    const user = await prisma.user.create({
      data: {
        name: "Lifecycle Owner",
        email: `lifecycle-owner+${Date.now()}@example.test`,
        passwordHash: "x",
        role: "ADMIN",
      },
    });
    userId = user.id;
    await prisma.company.create({ data: { userId, name: "Lifecycle Works" } });

    // A tender whose AI Analyze genuinely succeeded and was promoted, with
    // NO notes marker — the shape the notes-only detector cannot see.
    const tender = await prisma.tender.create({
      data: {
        id: randomUUID(),
        userId,
        title: "Rural Water Supply Design Review",
        status: "ACTIVE",
        notes: null,
      },
    });
    tenderId = tender.id;

    // A real source file with usable text, so "has this tender been
    // analysed?" is a meaningful question rather than one the absence of any
    // document already answers.
    await prisma.tenderFile.create({
      data: {
        tenderId,
        fileName: "rfp.pdf",
        originalFileName: "rfp.pdf",
        mimeType: "application/pdf",
        size: 4096,
        extractedText: [
          "REQUEST FOR PROPOSALS",
          "Design review and technical audit of rural water supply schemes.",
          "The Consultant shall submit a technical proposal, a company profile",
          "and a capability statement before the stated deadline.",
        ].join("\n").repeat(4),
        totalPages: 4,
        extractedPages: 4,
        extractionScore: 95,
        extractionMethod: "text",
      },
    });

    await prisma.aiJob.create({
      data: {
        userId,
        tenderId,
        jobType: "AI_ANALYZE",
        status: "SUCCEEDED",
        promotedAt: new Date(),
      },
    });
  });

  after(async () => {
    if (tenderId) await prisma.tenderFile.deleteMany({ where: { tenderId } }).catch(() => {});
    if (userId) await prisma.aiJob.deleteMany({ where: { userId } }).catch(() => {});
    if (tenderId) await prisma.tender.delete({ where: { id: tenderId } }).catch(() => {});
    if (userId) await prisma.company.deleteMany({ where: { userId } }).catch(() => {});
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect().catch(() => {});
  });

  it("the canonical resolver reads this tender as AI_SUCCEEDED", async () => {
    // Establishes the premise: the rows really do prove a successful analysis,
    // so a disagreement below is the reader's fault and not the fixture's.
    const detail = await resolveTenderAnalysisState(prisma, tenderId, userId);
    assert.equal(detail.state, "AI_SUCCEEDED");
  });

  it("does not report the source as UNKNOWN while the canonical state is AI_SUCCEEDED", async () => {
    const result = await computeTenderLifecycle(prisma, tenderId, userId);
    assert.ok(result, "the lifecycle must compute for an owned tender");

    assert.equal(
      result.analysisStatus.canonicalState,
      "AI_SUCCEEDED",
      "premise: the canonical state travels in the same payload",
    );
    assert.notEqual(
      result.analysisStatus.source,
      "UNKNOWN",
      "one response may not carry both 'no analysis' and 'analysis succeeded'",
    );
    assert.equal(result.analysisStatus.source, "AI");
  });

  it("does not place the tender in the analysis-required state", async () => {
    // The consequence of the source field for the state machine. Staleness is
    // a separate, legitimate reason to re-run AI Analyze and this fixture does
    // trigger it, so the lifecycle STATE is asserted rather than the next
    // action — the state is what "has this been analysed at all?" decides.
    const result = await computeTenderLifecycle(prisma, tenderId, userId);
    assert.notEqual(
      result.lifecycleState,
      "AI_ANALYSIS_REQUIRED",
      "a tender with a promoted, successful AI Analyze has been analysed",
    );
  });

  it("still refuses to read an unapproved regex fallback as AI", async () => {
    // The guard the previous call site was protecting. The canonical resolver
    // maps only AI_SUCCEEDED to "AI"; a fallback keeps its blocking source, so
    // adopting the resolver cannot promote fallback analysis into genuine AI.
    const fallbackTender = await prisma.tender.create({
      data: {
        id: randomUUID(),
        userId,
        title: "Fallback Tender",
        status: "ACTIVE",
        notes: "ANALYSIS_SOURCE: REGEX_FALLBACK_AI_ERROR",
      },
    });
    try {
      const result = await computeTenderLifecycle(prisma, fallbackTender.id, userId);
      assert.ok(result);
      assert.notEqual(
        result.analysisStatus.source,
        "AI",
        "an unapproved regex fallback must never read as genuine AI analysis",
      );
      assert.notEqual(
        result.finalSubmissionStatus,
        "READY",
        "and must never reach READY on that basis",
      );
    } finally {
      await prisma.aiJob.deleteMany({ where: { tenderId: fallbackTender.id } }).catch(() => {});
      await prisma.tender.delete({ where: { id: fallbackTender.id } }).catch(() => {});
    }
  });
});
