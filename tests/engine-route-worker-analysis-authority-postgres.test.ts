import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";

const RUN_DB = process.env.RUN_DB_INTEGRATION === "true";
const SESSION_COOKIE = "hope_session";
const sessionSecret = process.env.SESSION_SECRET
  ?? process.env.AUTH_SECRET
  ?? "engine-authority-test-secret-at-least-32-characters";
process.env.SESSION_SECRET = sessionSecret;

let cookieStore: Record<string, string> = {};
if (RUN_DB) {
  const nextHeadersMock = {
    cookies: async () => ({
      get: (name: string) => cookieStore[name] ? { name, value: cookieStore[name] } : undefined,
      set: (name: string, value: string) => { cookieStore[name] = value; },
      delete: (name: string) => { delete cookieStore[name]; },
      getAll: () => Object.entries(cookieStore).map(([name, value]) => ({ name, value })),
    }),
  };
  const Module = require("module");
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request: string, ...args: unknown[]) {
    if (request === "next/headers") return (require.resolve as { __engine_headers_mock?: string }).__engine_headers_mock ?? "";
    return originalResolve.call(this, request, ...args);
  };
  const mockPath = "__engine_analysis_authority_next_headers_mock__";
  require.cache[mockPath] = { id: mockPath, filename: mockPath, loaded: true, exports: nextHeadersMock, paths: [], children: [], parent: null } as any;
  (require.resolve as { __engine_headers_mock?: string }).__engine_headers_mock = mockPath;
}

function makeSessionToken(userId: string) {
  const expiresAt = new Date(Date.now() + 86_400_000);
  const encoded = Buffer.from(JSON.stringify({
    userId,
    exp: Math.floor(expiresAt.getTime() / 1000),
    nonce: randomBytes(16).toString("base64url"),
  })).toString("base64url");
  const signature = createHmac("sha256", sessionSecret).update(encoded).digest("base64url");
  return { token: `${encoded}.${signature}`, expiresAt };
}

test("Engine route and worker share canonical current-analysis authority", {
  skip: !RUN_DB,
  timeout: 120_000,
}, async () => {
  const { prisma, prismaReady } = await import("../lib/prisma");
  const { buildTenderAnalysisContent, computeAnalysisContentHash } = await import("../lib/engine/tender-analysis-content");
  const { getTenderReleaseSnapshot } = await import("../lib/engine/tender-release-snapshot");
  const { claimJobForCaller } = await import("../lib/job-claim-policy");
  const { completeJob } = await import("../lib/ai-jobs");
  const { runTenderEngine } = await import("../lib/engine/run-tender-engine");
  const engineRoute = await import("../app/api/tenders/[id]/engine/route");
  await prismaReady;

  const user = await prisma.user.create({ data: {
    email: `engine-authority-${randomUUID()}@test.local`, passwordHash: "unused", role: "PROPOSAL_MANAGER",
  } });
  let tenderId: string | null = null;
  try {
    await prisma.company.create({ data: { userId: user.id, name: "Canonical Authority Engineering" } });
    const sourceText = [
      "REQUEST FOR PROPOSALS — REGIONAL WATER INFRASTRUCTURE",
      ...Array.from({ length: 7 }, (_, index) => `Requirement ${index + 1}: The consultant shall deliver source-grounded water engineering output ${index + 1}.`),
      "Submission shall be made electronically before the stated deadline. This source text is intentionally complete for extraction quality assessment.",
    ].join("\n");
    const tender = await prisma.tender.create({ data: {
      userId: user.id,
      title: "Canonical Engine Authority Tender",
      clientName: "Regional Water Authority",
      reference: "CEA-2026-001",
      analysisSummary: "Seven promoted grounded requirements from manual AI Analyze.",
      // Deliberately stale legacy metadata reproduces the Preview failure.
      analysisExtractionStatus: "AI_COMPLETE",
      status: "AI_ANALYZED",
    } });
    tenderId = tender.id;
    const source = await prisma.tenderFile.create({ data: {
      tenderId: tender.id,
      fileName: "authority-rfp.pdf",
      originalFileName: "authority-rfp.pdf",
      mimeType: "application/pdf",
      size: Buffer.byteLength(sourceText),
      extractedText: sourceText,
      totalPages: 1,
      extractedPages: 1,
      failedPages: 0,
      extractionScore: 100,
      extractionMethod: "text",
      integrityStatus: "VERIFIED",
      contentSha256: createHash("sha256").update(sourceText).digest("hex"),
      contentByteLength: Buffer.byteLength(sourceText),
    } });
    for (let index = 0; index < 7; index++) {
      const quote = `The consultant shall deliver source-grounded water engineering output ${index + 1}.`;
      await prisma.tenderRequirement.create({ data: {
        tenderId: tender.id,
        title: `Grounded requirement ${index + 1}`,
        description: quote,
        requirementType: "TECHNICAL",
        priority: "MANDATORY",
        sourceTenderFileId: source.id,
        sourcePageNumber: 1,
        sourceExactQuote: quote,
        sourceConfidence: 1,
        sourceExtractionMethod: "text",
      } });
    }

    const contentHash = computeAnalysisContentHash(buildTenderAnalysisContent({
      title: tender.title,
      description: null,
      intakeSummary: null,
      files: [{ ...source, createdAt: source.createdAt }],
    }, { documents: [] }));
    await prisma.aiJob.create({ data: {
      userId: user.id,
      tenderId: tender.id,
      jobType: "AI_ANALYZE",
      status: "SUCCEEDED",
      analysisInputHash: contentHash,
      promotedAt: new Date(),
      promotedBy: user.id,
      finishedAt: new Date(),
      input: "{}",
      output: JSON.stringify({ analysisSource: "AI" }),
    } });

    const snapshot = await getTenderReleaseSnapshot(prisma, tender.id, user.id);
    assert.equal(snapshot?.analysis.state, "AI_SUCCEEDED");
    assert.equal(snapshot?.analysis.contentHashMatch, true);
    assert.ok(snapshot?.analysis.canonicalJobId);
    assert.equal(await prisma.tenderRequirement.count({ where: { tenderId: tender.id } }), 7);

    const { token, expiresAt } = makeSessionToken(user.id);
    await prisma.session.create({ data: {
      token: createHash("sha256").update(token).digest("hex"), userId: user.id, expiresAt,
    } });
    cookieStore[SESSION_COOKIE] = token;
    const accepted = await engineRoute.POST(
      new Request(`http://localhost/api/tenders/${tender.id}/engine`, { method: "POST" }),
      { params: Promise.resolve({ id: tender.id }) },
    );
    assert.equal(accepted.status, 202, JSON.stringify(await accepted.clone().json()));
    const acceptedBody = await accepted.json() as { jobId: string };
    const claimed = await claimJobForCaller({ jobType: "ENGINE_RUN", tenderId: tender.id, userId: user.id, global: false });
    assert.equal(claimed?.id, acceptedBody.jobId);

    const result = await runTenderEngine(tender.id, user.id, undefined, { safe: true, skipAiRematch: true });
    assert.equal(result.reusedPromotedAnalysis, true);
    assert.equal(result.analysisMethod, "AI");
    const matchedTender = await prisma.tender.findUniqueOrThrow({ where: { id: tender.id }, include: { requirements: true } });
    assert.equal(matchedTender.requirements.length, 7);
    assert.match(matchedTender.notes ?? "", /current manual AI Analyze output/i);
    await completeJob(acceptedBody.jobId, { reusedPromotedAnalysis: true });

    const secondAccepted = await engineRoute.POST(
      new Request(`http://localhost/api/tenders/${tender.id}/engine`, { method: "POST" }),
      { params: Promise.resolve({ id: tender.id }) },
    );
    assert.equal(secondAccepted.status, 202);
    await secondAccepted.json();
    await claimJobForCaller({ jobType: "ENGINE_RUN", tenderId: tender.id, userId: user.id, global: false });
    const driftedText = `${sourceText}\nAddendum: the canonical source changed after Engine enqueue.`;
    await prisma.tenderFile.update({ where: { id: source.id }, data: {
      extractedText: driftedText,
      size: Buffer.byteLength(driftedText),
      contentSha256: createHash("sha256").update(driftedText).digest("hex"),
      contentByteLength: Buffer.byteLength(driftedText),
    } });
    await assert.rejects(
      runTenderEngine(tender.id, user.id, undefined, { safe: true, skipAiRematch: true }),
      /CURRENT_ANALYSIS_REQUIRED/,
    );
    assert.equal(await prisma.tenderRequirement.count({ where: { tenderId: tender.id } }), 7, "stale analysis must not replace promoted requirements");
  } finally {
    cookieStore = {};
    if (tenderId) await prisma.tender.deleteMany({ where: { id: tenderId } });
    await prisma.company.deleteMany({ where: { userId: user.id } });
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
  }
});
