import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { countTraceable } from "../lib/engine/requirement-source-traceability";
import { prisma, prismaReady } from "../lib/prisma";
import { buildTenderAnalysisContent, computeAnalysisContentHash } from "../lib/engine/tender-analysis-content";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  throw new Error("RUN_DB_INTEGRATION=true is required for the Bid Strategy traceability regression");
}

let sessionCookie: string | undefined;
const Module = require("module");
const originalResolve = Module._resolveFilename;
const nextHeadersMockPath = "__bid_strategy_traceability_next_headers_mock__";
Module._resolveFilename = function (request: string, ...args: unknown[]) {
  if (request === "next/headers") return nextHeadersMockPath;
  return originalResolve.call(this, request, ...args);
};
require.cache[nextHeadersMockPath] = {
  id: nextHeadersMockPath,
  filename: nextHeadersMockPath,
  loaded: true,
  exports: {
    cookies: async () => ({
      get: (name: string) => name === "hope_session" && sessionCookie
        ? { name, value: sessionCookie }
        : undefined,
    }),
  },
} as unknown as NodeModule;

const createdUserIds: string[] = [];

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET ?? process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("A test session secret of at least 32 characters is required");
  return secret;
}

async function authenticate(userId: string): Promise<void> {
  const expiresAt = new Date(Date.now() + 60_000);
  const payload = {
    userId,
    exp: Math.floor(expiresAt.getTime() / 1000),
    nonce: randomBytes(24).toString("base64url"),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", sessionSecret()).update(encoded).digest("base64url");
  sessionCookie = `${encoded}.${signature}`;
  await prisma.session.create({
    data: {
      token: createHash("sha256").update(sessionCookie).digest("hex"),
      userId,
      expiresAt,
    },
  });
}

before(async () => {
  await prismaReady;
});

after(async () => {
  sessionCookie = undefined;
  if (createdUserIds.length > 0) {
    // Audit C-5: Tender.user now uses onDelete: Restrict, so we must delete
    // the user's tenders BEFORE deleting the user. Previously the Cascade
    // rule handled this automatically.
    await prisma.tender.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.company.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  Module._resolveFilename = originalResolve;
  delete require.cache[nextHeadersMockPath];
});

test("Bid Strategy counts persisted file/page/quote provenance when sourceConfidence is zero", async () => {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      email: `bid-strategy-traceability-${suffix}@example.test`,
      name: "Bid Strategy Traceability Test",
      passwordHash: "unused",
      role: "PROPOSAL_MANAGER",
    },
  });
  createdUserIds.push(user.id);
  await prisma.company.create({ data: { userId: user.id, name: "Traceable Bid Company" } });
  const tender = await prisma.tender.create({
    data: {
      userId: user.id,
      title: "Traceable Bid Strategy Tender",
      notes: "Analysis source: AI.",
      status: "AI_ANALYZED",
      analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED",
    },
  });
  const source = await prisma.tenderFile.create({
    data: {
      tenderId: tender.id,
      fileName: "traceable-tender.pdf",
      originalFileName: "traceable-tender.pdf",
      mimeType: "application/pdf",
      size: 256,
      extractedText: "The bidder shall provide a signed technical methodology.",
      totalPages: 1,
      extractedPages: 1,
      extractionScore: 100,
      integrityStatus: "VERIFIED",
    },
  });
  await prisma.tenderRequirement.create({
    data: {
      tenderId: tender.id,
      title: "Signed technical methodology",
      description: "Provide a signed technical methodology.",
      requirementType: "DOCUMENT",
      priority: "MANDATORY",
      sourceTenderFileId: source.id,
      sourcePageNumber: 1,
      sourceExactQuote: "The bidder shall provide a signed technical methodology.",
      sectionReference: "Technical Requirements",
      sourceConfidence: 0,
    },
  });
  const canonicalHash = computeAnalysisContentHash(buildTenderAnalysisContent({
    title: tender.title,
    description: tender.description,
    intakeSummary: tender.intakeSummary,
    files: [{
      id: source.id,
      fileName: source.fileName,
      originalFileName: source.originalFileName,
      extractedText: source.extractedText,
      classification: source.classification,
      createdAt: source.createdAt,
      deletionStatus: source.deletionStatus,
      contentSha256: source.contentSha256,
      integrityStatus: source.integrityStatus,
      extractionScore: source.extractionScore,
      extractionMethod: source.extractionMethod,
      totalPages: source.totalPages,
      extractedPages: source.extractedPages,
      failedPages: source.failedPages,
    }],
  }));
  await prisma.aiJob.create({
    data: {
      tenderId: tender.id,
      userId: user.id,
      jobType: "AI_ANALYZE",
      status: "SUCCEEDED",
      analysisInputHash: canonicalHash,
      promotedAt: new Date(),
      promotedBy: user.id,
      startedAt: new Date(Date.now() - 1_000),
      finishedAt: new Date(),
      input: JSON.stringify({ contentHash: canonicalHash }),
      output: JSON.stringify({ analysisSource: "AI", contentHash: canonicalHash, isPartial: false }),
    },
  });
  const persistedRequirements = await prisma.tenderRequirement.findMany({
    where: { tenderId: tender.id },
    select: {
      sourceTenderFileId: true,
      sourcePageNumber: true,
      sourceExactQuote: true,
      sectionReference: true,
      sourceConfidence: true,
    },
  });
  assert.equal(persistedRequirements[0]?.sourceConfidence, 0);
  assert.equal(countTraceable(persistedRequirements), 1);
  await authenticate(user.id);

  const route = await import("../app/api/tenders/[id]/bid-strategy/route");
  const response = await route.GET(new Request(`http://localhost/api/tenders/${tender.id}/bid-strategy`), {
    params: Promise.resolve({ id: tender.id }),
  });
  const body = await response.json() as {
    strategy?: Record<string, unknown> | null;
    blocked?: boolean;
    unavailable?: boolean;
    blockers?: string[];
  };

  assert.equal(response.status, 200);
  assert.notEqual(body.blocked, true, "the extraction gate must not short-circuit this regression");
  assert.notEqual(body.unavailable, true, "traceable requirements must not make Bid Strategy unavailable");
  assert.ok(body.strategy, "the route must compute Bid Strategy end to end");
  assert.ok(!(body.blockers ?? []).includes("Extracted requirements have no source traceability."));
});
