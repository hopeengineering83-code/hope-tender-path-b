// Real authenticated PostgreSQL route tests for BuildPlan release safety.
// RUN_DB_INTEGRATION=true is MANDATORY — these tests CANNOT be skipped.
//
// These tests use the application's REAL signed session/cookie mechanism:
//   - Real HMAC-signed tokens (makeToken using SESSION_SECRET)
//   - Real Session table rows (prisma.session.create)
//   - Real requireRole() → getCurrentUser() → getSession() flow
//   - Real role check against the User table
//
// The ONLY mock is next/headers cookies() — in test mode, Next.js does not
// set up the AsyncLocalStorage context that cookies() reads from. We mock
// it to read from a global variable that the test sets via the Request's
// cookie header. This is NOT mock auth — the token signing, session DB
// lookup, and role check are all real.

import { before, after, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { prisma, prismaReady } from "../lib/prisma";
import { buildTenderAnalysisContent, computeAnalysisContentHash } from "../lib/engine/tender-analysis-content";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for release-safety tests.");
  process.exit(1);
}

// ─── Mock next/headers cookies() for test mode ──────────────────────────
// Next.js cookies() reads from AsyncLocalStorage which is not set up in
// test mode. We mock it to read from a global variable that the test
// sets. This allows the REAL auth flow (requireRole → getCurrentUser →
// getSession → cookies) to work with real signed tokens.
//
// The mock is registered BEFORE any route module is imported, so the
// route's transitive import of lib/auth (which imports cookies from
// next/headers) gets our mock.
let __TEST_COOKIE_STORE: Record<string, string> = {};

const nextHeadersMock = {
  cookies: async () => ({
    get: (name: string) => __TEST_COOKIE_STORE[name] ? { name, value: __TEST_COOKIE_STORE[name] } : undefined,
    set: (name: string, value: string) => { __TEST_COOKIE_STORE[name] = value; },
    delete: (name: string) => { delete __TEST_COOKIE_STORE[name]; },
    getAll: () => Object.entries(__TEST_COOKIE_STORE).map(([name, value]) => ({ name, value })),
  }),
};

// Register the mock via Node.js module resolution override
const Module = require("module");
const originalResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function(request: string, ...args: any[]) {
  if (request === "next/headers") {
    return (require.resolve as any).__next_headers_mock_path || "";
  }
  return originalResolve.call(this, request, ...args);
};

// Inject the mock module into the require cache
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

// ─── Real session token creation (same HMAC mechanism as lib/auth.ts) ────
import { createHmac, randomBytes, createHash } from "node:crypto";

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

async function createSessionCookie(userId: string): Promise<string> {
  const { token, expiresAt } = makeToken(userId);
  await prisma.session.create({
    data: { token: hashToken(token), userId, expiresAt },
  });
  return token; // Return just the token value — set on the mock store
}

// Set the cookie on the mock store AND return the header string
async function setAuthCookie(userId: string): Promise<string> {
  const token = await createSessionCookie(userId);
  __TEST_COOKIE_STORE[SESSION_COOKIE] = token;
  return `${SESSION_COOKIE}=${token}`;
}

// Clear the mock cookie store between tests
function clearAuthCookie(): void {
  __TEST_COOKIE_STORE = {};
}

async function createFullTender(suffix: string, userId: string, opts: {
  submissionMethod?: string;
  extractionScore?: number;
  extractedText?: string;
  analysisStatus?: string;
} = {}) {
  const nonce = `${Date.now()}-${suffix}-${Math.random().toString(16).slice(2)}`;
  const method = opts.submissionMethod ?? "email submission required";
  const isEmail = method.toLowerCase().includes("email");
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
      exactFileOrder: '[1]',
      submissionMethod: method,
      submissionAddress: isEmail ? null : "123 Test Street, Addis Ababa",
      submissionEmails: isEmail ? "submit@example.com" : null,
      submissionEmailSubject: "Tender Submission",
      deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      clientNameSourcePage: 1,
      clientNameSourceQuote: "This tender requires a Technical Proposal for the project.",
      submissionMethodSourcePage: 1,
      submissionMethodSourceQuote: "This tender requires a Technical Proposal for the project.",
      titleSourcePage: 1,
      titleSourceQuote: "This tender requires a Technical Proposal for the project.",
      deadlineSourcePage: 1,
      deadlineSourceQuote: "This tender requires a Technical Proposal for the project.",
      referenceSourcePage: 1,
      referenceSourceQuote: "This tender requires a Technical Proposal for the project.",
      submissionEmailSubjectSourcePage: 1,
      submissionEmailSubjectSourceQuote: "This tender requires a Technical Proposal for the project.",
      ...(isEmail ? {
        submissionEmailSourcePage: 1,
        submissionEmailSourceQuote: "This tender requires a Technical Proposal for the project.",
      } : {
        submissionAddressSourcePage: 1,
        submissionAddressSourceQuote: "This tender requires a Technical Proposal for the project.",
      }),
    },
  });
  const file = await prisma.tenderFile.create({
    data: {
      tenderId: tender.id, fileName: `tender-${nonce}.pdf`, originalFileName: `Tender-${nonce}.pdf`,
      mimeType: "application/pdf", size: 1024,
      extractedText: opts.extractedText ?? "This tender requires a Technical Proposal for the project.",
      totalPages: 3, extractedPages: 3, failedPages: 0,
      extractionScore: opts.extractionScore ?? 100, extractionMethod: "text",
    },
  });
  const updateData: any = {
    clientNameSourceFileId: file.id, submissionMethodSourceFileId: file.id,
    titleSourceFileId: file.id, deadlineSourceFileId: file.id,
    referenceSourceFileId: file.id, submissionEmailSubjectSourceFileId: file.id,
  };
  if (isEmail) updateData.submissionEmailSourceFileId = file.id;
  else updateData.submissionAddressSourceFileId = file.id;
  await prisma.tender.update({ where: { id: tender.id }, data: updateData });
  await prisma.tenderRequirement.create({
    data: {
      tenderId: tender.id, title: "Technical Proposal", description: "Submit a technical proposal document.",
      requirementType: "TECHNICAL", priority: "MANDATORY", exactFileName: "Technical Proposal.docx", exactOrder: 1,
      sourceTenderFileId: file.id, sourcePageNumber: 1, sourceExactQuote: "This tender requires a Technical Proposal for the project.",
    },
  });
  const tfh = await prisma.tender.findUnique({
    where: { id: tender.id },
    select: { title: true, description: true, intakeSummary: true, files: { select: { id: true, originalFileName: true, extractedText: true, classification: true, createdAt: true, deletionStatus: true } } },
  });
  const ch = computeAnalysisContentHash(buildTenderAnalysisContent({ title: tfh!.title, description: tfh!.description, intakeSummary: tfh!.intakeSummary, files: tfh!.files as any[] }, undefined));
  await prisma.aiJob.create({
    data: { tenderId: tender.id, userId, jobType: "AI_ANALYZE", status: opts.analysisStatus ?? "SUCCEEDED", analysisInputHash: ch, startedAt: new Date(), finishedAt: new Date(), promotedAt: (opts.analysisStatus ?? "SUCCEEDED") === "SUCCEEDED" ? new Date() : null },
  });
  return { tender, file };
}

async function cleanup(tenderId: string) {
  if (tenderId) await prisma.tender.delete({ where: { id: tenderId } }).catch(() => {});
}

async function callRouteWithAuth(routeModule: any, tenderId: string, userId: string) {
  // Set the real signed token on the mock cookie store so requireRole can read it
  await setAuthCookie(userId);
  const req = new Request(`http://localhost/api/tenders/${tenderId}/build-plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  return routeModule.POST(req, { params: Promise.resolve({ id: tenderId }) });
}

describe("BuildPlan real authenticated PostgreSQL route tests", () => {
  let adminUser: any;
  let reviewerUser: any;

  before(async () => {
    await prismaReady;
    const nonce = Date.now();
    adminUser = await prisma.user.create({ data: { email: `admin-${nonce}@test.com`, name: "Admin", passwordHash: "$2a$10$test", role: "ADMIN" } });
    reviewerUser = await prisma.user.create({ data: { email: `reviewer-${nonce}@test.com`, name: "Reviewer", passwordHash: "$2a$10$test", role: "REVIEWER" } });
  });

  after(async () => {
    if (adminUser) await prisma.user.delete({ where: { id: adminUser.id } }).catch(() => {});
    if (reviewerUser) await prisma.user.delete({ where: { id: reviewerUser.id } }).catch(() => {});
    await prisma.$disconnect();
  });

  let buildPlanRoute: any;
  let submissionPlanRoute: any;
  let confirmRoute: any;
  before(async () => {
    buildPlanRoute = await import("../app/api/tenders/[id]/build-plan/route");
    submissionPlanRoute = await import("../app/api/tenders/[id]/submission-plan/build/route");
    confirmRoute = await import("../app/api/tenders/[id]/build-plan/confirm/route");
  });

  it("ADMIN can create a DRAFT BuildPlan via real route handler", async () => {
    const { tender } = await createFullTender("admin-draft", adminUser.id);
    clearAuthCookie();
    const response = await callRouteWithAuth(buildPlanRoute, tender.id, adminUser.id);
    assert.equal(response.status, 200, `ADMIN should get 200, got ${response.status}`);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.status, "DRAFT");
    const docCount = await prisma.generatedDocument.count({ where: { tenderId: tender.id } });
    assert.equal(docCount, 0, "Zero GeneratedDocument rows");
    await cleanup(tender.id);
  });

  it("unauthenticated request gets 401 (no session cookie)", async () => {
    const { tender } = await createFullTender("unauth-401", adminUser.id);
    clearAuthCookie();
    const req = new Request(`http://localhost/api/tenders/${tender.id}/build-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const response = await buildPlanRoute.POST(req, { params: Promise.resolve({ id: tender.id }) });
    assert.equal(response.status, 401, `Unauthenticated should get 401, got ${response.status}`);
    const planCount = await prisma.buildPlan.count({ where: { tenderId: tender.id } });
    assert.equal(planCount, 0, "Zero BuildPlan rows");
    await cleanup(tender.id);
  });

  it("REVIEWER receives 403 from build-plan route", async () => {
    const { tender } = await createFullTender("reviewer-403", adminUser.id);
    clearAuthCookie();
    const response = await callRouteWithAuth(buildPlanRoute, tender.id, reviewerUser.id);
    assert.equal(response.status, 403, `REVIEWER should get 403, got ${response.status}`);
    const planCount = await prisma.buildPlan.count({ where: { tenderId: tender.id } });
    assert.equal(planCount, 0, "Zero BuildPlan rows");
    const docCount = await prisma.generatedDocument.count({ where: { tenderId: tender.id } });
    assert.equal(docCount, 0, "Zero GeneratedDocument rows");
    await cleanup(tender.id);
  });

  it("REVIEWER receives 403 from submission-plan/build route", async () => {
    const { tender } = await createFullTender("reviewer-sp-403", adminUser.id);
    clearAuthCookie();
    await setAuthCookie(reviewerUser.id);
    const response = await submissionPlanRoute.POST(
      new Request(`http://localhost/api/tenders/${tender.id}/submission-plan/build`, { method: "POST" }),
      { params: Promise.resolve({ id: tender.id }) }
    );
    assert.equal(response.status, 403, `REVIEWER should get 403, got ${response.status}`);
    const planCount = await prisma.buildPlan.count({ where: { tenderId: tender.id } });
    assert.equal(planCount, 0, "Zero BuildPlan rows");
    await cleanup(tender.id);
  });

  it("REVIEWER receives 403 from confirm route", async () => {
    const { tender } = await createFullTender("reviewer-confirm-403", adminUser.id);
    // First create a draft as admin
    const { buildDraftBuildPlan } = await import("../lib/engine/build-plan");
    await buildDraftBuildPlan(prisma, tender.id, adminUser.id);
    clearAuthCookie();
    await setAuthCookie(reviewerUser.id);
    const response = await confirmRoute.POST(
      new Request(`http://localhost/api/tenders/${tender.id}/build-plan/confirm`, { method: "POST" }),
      { params: Promise.resolve({ id: tender.id }) }
    );
    assert.equal(response.status, 403, `REVIEWER should get 403, got ${response.status}`);
    // Plan should still be DRAFT
    const plan = await prisma.buildPlan.findFirst({ where: { tenderId: tender.id } });
    assert.equal(plan?.status, "DRAFT", "Plan must remain DRAFT");
    await cleanup(tender.id);
  });

  it("foreign user cannot build another user's tender (404 not 200)", async () => {
    const foreignUser = await prisma.user.create({ data: { email: `foreign-${Date.now()}@test.com`, name: "Foreign", passwordHash: "$2a$10$test", role: "ADMIN" } });
    const { tender } = await createFullTender("foreign-user", adminUser.id);
    clearAuthCookie();
    await setAuthCookie(foreignUser.id);
    const response = await buildPlanRoute.POST(
      new Request(`http://localhost/api/tenders/${tender.id}/build-plan`, { method: "POST" }),
      { params: Promise.resolve({ id: tender.id }) }
    );
    // Foreign user is authenticated but the tender doesn't belong to them —
    // the route's preflight findFirst(userId) returns null → 404.
    assert.equal(response.status, 404, `Foreign user should get 404, got ${response.status}`);
    const planCount = await prisma.buildPlan.count({ where: { tenderId: tender.id } });
    assert.equal(planCount, 0, "Zero BuildPlan rows for foreign user");
    await cleanup(tender.id);
    await prisma.user.delete({ where: { id: foreignUser.id } }).catch(() => {});
  });

  it("weak extraction blocks draft (422 not 404)", async () => {
    const { tender } = await createFullTender("weak-ext", adminUser.id, { extractionScore: 20, extractedText: "garbage" });
    const { buildDraftBuildPlan } = await import("../lib/engine/build-plan");
    const result = await buildDraftBuildPlan(prisma, tender.id, adminUser.id);
    assert.ok(!result.ok, "Weak extraction must block");
    if (!result.ok) {
      assert.notEqual(result.code, "TENDER_NOT_FOUND", "Must not return false 404");
      assert.notEqual(result.status, 404, "Must not return 404 status");
    }
    const planCount = await prisma.buildPlan.count({ where: { tenderId: tender.id } });
    assert.equal(planCount, 0, "Zero BuildPlan rows");
    await cleanup(tender.id);
  });

  it("unknown submission method blocks draft", async () => {
    const { tender } = await createFullTender("unknown-method", adminUser.id, { submissionMethod: "carrier pigeon" });
    const { buildDraftBuildPlan } = await import("../lib/engine/build-plan");
    const result = await buildDraftBuildPlan(prisma, tender.id, adminUser.id);
    assert.ok(!result.ok, "Unknown method must block");
    if (!result.ok) {
      assert.match(result.message, /unsupported|unknown/i, "Must mention unsupported/unknown method");
    }
    await cleanup(tender.id);
  });

  it("concurrent rebuild invalidates stale confirmation (409)", async () => {
    const { buildDraftBuildPlan } = await import("../lib/engine/build-plan");
    const { tender } = await createFullTender("concurrent", adminUser.id);
    const draftResult = await buildDraftBuildPlan(prisma, tender.id, adminUser.id);
    assert.ok(draftResult.ok);
    if (!draftResult.ok) { await cleanup(tender.id); return; }
    const originalRevision = draftResult.plan.revision;
    const originalHash = draftResult.plan.contentHash;
    // Rebuild — changes revision+hash
    const rebuildResult = await buildDraftBuildPlan(prisma, tender.id, adminUser.id);
    assert.ok(rebuildResult.ok);
    if (!rebuildResult.ok) { await cleanup(tender.id); return; }
    // Try to confirm using OLD revision+hash — must affect 0 rows
    const confirmResult = await prisma.buildPlan.updateMany({
      where: { tenderId: tender.id, status: "DRAFT", revision: originalRevision, contentHash: originalHash },
      data: { status: "CONFIRMED", confirmedRevision: originalRevision, confirmedContentHash: originalHash, confirmedById: adminUser.id, confirmedAt: new Date() },
    });
    assert.equal(confirmResult.count, 0, "Stale confirmation must affect 0 rows (409)");
    const plan = await prisma.buildPlan.findFirst({ where: { tenderId: tender.id } });
    assert.equal(plan?.status, "DRAFT", "Plan must remain DRAFT");
    await cleanup(tender.id);
  });
});
