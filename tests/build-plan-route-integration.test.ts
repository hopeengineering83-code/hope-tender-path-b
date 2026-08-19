// Real authenticated PostgreSQL route tests for automatic Build Plan safety.

import { before, after, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHmac, randomBytes, createHash } from "node:crypto";
import { prisma, prismaReady } from "../lib/prisma";
import { buildTenderAnalysisContent, computeAnalysisContentHash } from "../lib/engine/tender-analysis-content";
import { buildAndVerifyBuildPlan } from "../lib/engine/automatic-build-plan";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for release-safety tests.");
  process.exit(1);
}

let testCookieStore: Record<string, string> = {};
const nextHeadersMock = {
  cookies: async () => ({
    get: (name: string) => testCookieStore[name] ? { name, value: testCookieStore[name] } : undefined,
    set: (name: string, value: string) => { testCookieStore[name] = value; },
    delete: (name: string) => { delete testCookieStore[name]; },
    getAll: () => Object.entries(testCookieStore).map(([name, value]) => ({ name, value })),
  }),
};

const Module = require("module");
const originalResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function(request: string, ...args: any[]) {
  if (request === "next/headers") return (require.resolve as any).__next_headers_mock_path || "";
  return originalResolve.call(this, request, ...args);
};
const mockModulePath = "__next_headers_mock__";
require.cache[mockModulePath] = {
  id: mockModulePath,
  filename: mockModulePath,
  loaded: true,
  exports: nextHeadersMock,
  paths: [],
  children: [],
  parent: null,
} as any;
(require.resolve as any).__next_headers_mock_path = mockModulePath;

const SESSION_COOKIE = "hope_session";
const SESSION_TTL_DAYS = 14;

function getSecret(): string {
  return process.env.SESSION_SECRET || process.env.AUTH_SECRET || "test-session-secret-at-least-32-characters-long-for-hmac";
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function makeToken(userId: string): { token: string; expiresAt: Date } {
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400 * 1000);
  const payload = { userId, exp: Math.floor(expiresAt.getTime() / 1000), nonce: randomBytes(24).toString("base64url") };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", getSecret()).update(encoded).digest("base64url");
  return { token: `${encoded}.${sig}`, expiresAt };
}

async function setAuthCookie(userId: string): Promise<void> {
  const { token, expiresAt } = makeToken(userId);
  await prisma.session.create({ data: { token: hashToken(token), userId, expiresAt } });
  testCookieStore[SESSION_COOKIE] = token;
}

function clearAuthCookie(): void {
  testCookieStore = {};
}

async function createFullTender(suffix: string, userId: string, options: {
  submissionMethod?: string;
  extractionScore?: number;
  extractedText?: string;
} = {}) {
  const nonce = `${Date.now()}-${suffix}-${Math.random().toString(16).slice(2)}`;
  const method = options.submissionMethod ?? "email submission required";
  const isEmail = method.toLowerCase().includes("email");
  const quote = "This tender requires a Technical Proposal for the project.";
  const tender = await prisma.tender.create({
    data: {
      userId,
      title: `Route Test Tender ${nonce}`,
      clientName: "Ministry of Test Infrastructure",
      reference: `RT-${nonce}`,
      country: "Ethiopia",
      status: "DRAFT",
      stage: "TENDER_INTAKE",
      exactFileNaming: '["Technical Proposal.docx"]',
      exactFileOrder: "[1]",
      submissionMethod: method,
      submissionAddress: isEmail ? null : "123 Test Street, Addis Ababa",
      submissionEmails: isEmail ? "submit@example.com" : null,
      submissionEmailSubject: "Tender Submission",
      deadline: new Date(Date.now() + 30 * 86400 * 1000),
      clientNameSourcePage: 1,
      clientNameSourceQuote: quote,
      submissionMethodSourcePage: 1,
      submissionMethodSourceQuote: quote,
      titleSourcePage: 1,
      titleSourceQuote: quote,
      deadlineSourcePage: 1,
      deadlineSourceQuote: quote,
      referenceSourcePage: 1,
      referenceSourceQuote: quote,
      submissionEmailSubjectSourcePage: 1,
      submissionEmailSubjectSourceQuote: quote,
      ...(isEmail ? {
        submissionEmailSourcePage: 1,
        submissionEmailSourceQuote: quote,
      } : {
        submissionAddressSourcePage: 1,
        submissionAddressSourceQuote: quote,
      }),
    },
  });
  const file = await prisma.tenderFile.create({
    data: {
      tenderId: tender.id,
      fileName: `tender-${nonce}.pdf`,
      originalFileName: `Tender-${nonce}.pdf`,
      mimeType: "application/pdf",
      size: 1024,
      extractedText: options.extractedText ?? quote,
      totalPages: 3,
      extractedPages: 3,
      failedPages: 0,
      extractionScore: options.extractionScore ?? 100,
      extractionMethod: "text",
    },
  });
  const updateData: Record<string, string> = {
    clientNameSourceFileId: file.id,
    submissionMethodSourceFileId: file.id,
    titleSourceFileId: file.id,
    deadlineSourceFileId: file.id,
    referenceSourceFileId: file.id,
    submissionEmailSubjectSourceFileId: file.id,
  };
  if (isEmail) updateData.submissionEmailSourceFileId = file.id;
  else updateData.submissionAddressSourceFileId = file.id;
  await prisma.tender.update({ where: { id: tender.id }, data: updateData });
  await prisma.tenderRequirement.create({
    data: {
      tenderId: tender.id,
      title: "Technical Proposal",
      description: "Submit a technical proposal document.",
      requirementType: "TECHNICAL",
      priority: "MANDATORY",
      exactFileName: "Technical Proposal.docx",
      exactOrder: 1,
      sourceTenderFileId: file.id,
      sourcePageNumber: 1,
      sourceExactQuote: quote,
    },
  });
  const current = await prisma.tender.findUniqueOrThrow({
    where: { id: tender.id },
    select: {
      title: true,
      description: true,
      intakeSummary: true,
      files: { select: { id: true, originalFileName: true, extractedText: true, classification: true, createdAt: true, deletionStatus: true } },
    },
  });
  const analysisInputHash = computeAnalysisContentHash(buildTenderAnalysisContent({
    title: current.title,
    description: current.description,
    intakeSummary: current.intakeSummary,
    files: current.files as any[],
  }, undefined));
  await prisma.aiJob.create({
    data: {
      tenderId: tender.id,
      userId,
      jobType: "AI_ANALYZE",
      status: "SUCCEEDED",
      analysisInputHash,
      startedAt: new Date(),
      finishedAt: new Date(),
      promotedAt: new Date(),
    },
  });
  return tender.id;
}

async function cleanupTender(tenderId: string): Promise<void> {
  await prisma.tender.delete({ where: { id: tenderId } }).catch(() => {});
}

async function callPost(route: any, path: string, tenderId: string, userId?: string) {
  clearAuthCookie();
  if (userId) await setAuthCookie(userId);
  return route.POST(
    new Request(`http://localhost/api/tenders/${tenderId}/${path}`, { method: "POST" }),
    { params: Promise.resolve({ id: tenderId }) },
  );
}

describe("automatic Build Plan authenticated PostgreSQL routes", () => {
  let admin: any;
  let reviewer: any;
  let canonical: any;
  let compatibility: any;

  before(async () => {
    await prismaReady;
    const nonce = Date.now();
    admin = await prisma.user.create({ data: { email: `admin-${nonce}@test.com`, name: "Admin", passwordHash: "$2a$10$test", role: "ADMIN" } });
    reviewer = await prisma.user.create({ data: { email: `reviewer-${nonce}@test.com`, name: "Reviewer", passwordHash: "$2a$10$test", role: "REVIEWER" } });
    canonical = await import("../app/api/tenders/[id]/build-plan/route");
    compatibility = await import("../app/api/tenders/[id]/submission-plan/build/route");
  });

  after(async () => {
    await prisma.session.deleteMany({ where: { userId: { in: [admin.id, reviewer.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [admin.id, reviewer.id] } } });
    await prisma.$disconnect();
  });

  it("ADMIN automatically creates a source-verified CONFIRMED plan with zero documents", async () => {
    const tenderId = await createFullTender("canonical", admin.id);
    const response = await callPost(canonical, "build-plan", tenderId, admin.id);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.state, "CONFIRMED");
    assert.equal(body.authorizesGeneration, true);
    assert.equal(body.generatedDocumentsCreated, 0);
    const plan = await prisma.buildPlan.findUniqueOrThrow({ where: { tenderId } });
    assert.equal(plan.status, "CONFIRMED");
    assert.equal(await prisma.generatedDocument.count({ where: { tenderId } }), 0);
    await cleanupTender(tenderId);
  });

  it("legacy submission-plan/build converges on the same confirmed authority", async () => {
    const tenderId = await createFullTender("compat", admin.id);
    const response = await callPost(compatibility, "submission-plan/build", tenderId, admin.id);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.state, "CONFIRMED");
    assert.equal(body.authorizesGeneration, true);
    assert.equal(body.generatedDocumentsCreated, 0);
    await cleanupTender(tenderId);
  });

  it("rejects unauthenticated and REVIEWER mutations", async () => {
    const tenderId = await createFullTender("rbac", admin.id);
    assert.equal((await callPost(canonical, "build-plan", tenderId)).status, 401);
    assert.equal((await callPost(canonical, "build-plan", tenderId, reviewer.id)).status, 403);
    assert.equal((await callPost(compatibility, "submission-plan/build", tenderId, reviewer.id)).status, 403);
    assert.equal(await prisma.buildPlan.count({ where: { tenderId } }), 0);
    await cleanupTender(tenderId);
  });

  it("hides another tenant's tender", async () => {
    const foreign = await prisma.user.create({
      data: { email: `foreign-${Date.now()}@test.com`, name: "Foreign", passwordHash: "$2a$10$test", role: "ADMIN" },
    });
    const tenderId = await createFullTender("foreign", admin.id);
    const response = await callPost(canonical, "build-plan", tenderId, foreign.id);
    assert.equal(response.status, 404);
    assert.equal(await prisma.buildPlan.count({ where: { tenderId } }), 0);
    await cleanupTender(tenderId);
    await prisma.session.deleteMany({ where: { userId: foreign.id } });
    await prisma.user.delete({ where: { id: foreign.id } });
  });

  it("fails closed on weak extraction and unsupported submission methods", async () => {
    const weakId = await createFullTender("weak", admin.id, { extractionScore: 20, extractedText: "garbage" });
    const weak = await buildAndVerifyBuildPlan(prisma, weakId, admin.id, { reuseCurrent: false });
    assert.equal(weak.ok, false);
    assert.equal(await prisma.buildPlan.count({ where: { tenderId: weakId } }), 0);
    await cleanupTender(weakId);

    const methodId = await createFullTender("method", admin.id, { submissionMethod: "carrier pigeon" });
    const method = await buildAndVerifyBuildPlan(prisma, methodId, admin.id, { reuseCurrent: false });
    assert.equal(method.ok, false);
    if (!method.ok) assert.match(method.message, /unsupported|unknown/i);
    await cleanupTender(methodId);
  });

  it("reuses the current machine-confirmed plan for unchanged sources", async () => {
    const tenderId = await createFullTender("reuse", admin.id);
    const first = await buildAndVerifyBuildPlan(prisma, tenderId, admin.id, { reuseCurrent: true });
    const second = await buildAndVerifyBuildPlan(prisma, tenderId, admin.id, { reuseCurrent: true });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (first.ok && second.ok) {
      assert.equal(second.revision, first.revision);
      assert.equal(second.contentHash, first.contentHash);
      assert.equal(second.reusedCurrentPlan, true);
    }
    await cleanupTender(tenderId);
  });
});
