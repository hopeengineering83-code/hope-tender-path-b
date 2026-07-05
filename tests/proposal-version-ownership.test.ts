// Real authenticated PostgreSQL route tests for Proposal Version ownership.
// RUN_DB_INTEGRATION=true is MANDATORY for these tests to execute.

import { before, after, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { prisma, prismaReady } from "../lib/prisma";

// Accepted DB-test skip/separation pattern:
// If RUN_DB_INTEGRATION is not true, skip all tests in this file.
// DO NOT call process.exit(1) as it kills the entire test runner.
const dbDescribe = process.env.RUN_DB_INTEGRATION === "true" ? describe : describe.skip;

// ─── Mock next/headers cookies() for test mode ──────────────────────────
let __TEST_COOKIE_STORE: Record<string, string> = {};
const nextHeadersMock = {
  cookies: async () => ({
    get: (name: string) => __TEST_COOKIE_STORE[name] ? { name, value: __TEST_COOKIE_STORE[name] } : undefined,
    set: (name: string, value: string) => { __TEST_COOKIE_STORE[name] = value; },
    delete: (name: string) => { delete __TEST_COOKIE_STORE[name]; },
    getAll: () => Object.entries(__TEST_COOKIE_STORE).map(([name, value]) => ({ name, value })),
  }),
};

const Module = require("module");
const originalResolve = (Module as any)._resolveFilename;
const mockModulePath = "__next_headers_mock__";

(Module as any)._resolveFilename = function (request: string, ...args: any[]) {
  if (request === "next/headers") return mockModulePath;
  return originalResolve.call(this, request, ...args);
};

require.cache[mockModulePath] = {
  id: mockModulePath, filename: mockModulePath, loaded: true,
  exports: nextHeadersMock, paths: [], children: [], parent: null,
} as any;

// ─── Real session token creation (same HMAC mechanism as lib/auth.ts) ────
import { createHmac, randomBytes, createHash } from "node:crypto";
const SESSION_COOKIE = "hope_session";

function getSecret(): string {
  return process.env.SESSION_SECRET || process.env.AUTH_SECRET || "test-session-secret-at-least-32-characters-long-for-hmac";
}
function hashToken(token: string): string { return createHash("sha256").update(token).digest("hex"); }
function makeToken(userId: string): { token: string; expiresAt: Date } {
  const expiresAt = new Date(Date.now() + 14 * 86400 * 1000);
  const payload = { userId, exp: Math.floor(expiresAt.getTime() / 1000), nonce: randomBytes(24).toString("base64url") };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", getSecret()).update(encoded).digest("base64url");
  return { token: `${encoded}.${sig}`, expiresAt };
}

async function setAuthCookie(userId: string): Promise<void> {
  const { token, expiresAt } = makeToken(userId);
  await prisma.session.create({ data: { token: hashToken(token), userId, expiresAt } });
  __TEST_COOKIE_STORE[SESSION_COOKIE] = token;
}

async function clearAuthCookie(): Promise<void> {
  const token = __TEST_COOKIE_STORE[SESSION_COOKIE];
  if (token) {
    await prisma.session.deleteMany({ where: { token: hashToken(token) } }).catch(() => {});
  }
  __TEST_COOKIE_STORE = {};
}

dbDescribe("Proposal Version Ownership Enforcement", () => {
  let ownerUser: any, foreignUser: any, adminUser: any, tender: any, version: any, routeModule: any;
  let generatedDoc: any;

  before(async () => {
    await prismaReady;
    const nonce = Date.now();
    
    // Create users
    ownerUser = await prisma.user.create({ data: { email: `owner-${nonce}@test.com`, name: "Owner", passwordHash: "$2a$10$test", role: "PROPOSAL_MANAGER" } });
    foreignUser = await prisma.user.create({ data: { email: `foreign-${nonce}@test.com`, name: "Foreign PM", passwordHash: "$2a$10$test", role: "PROPOSAL_MANAGER" } });
    adminUser = await prisma.user.create({ data: { email: `admin-${nonce}@test.com`, name: "Admin", passwordHash: "$2a$10$test", role: "ADMIN" } });
    
    // Create tender
    tender = await prisma.tender.create({ data: { userId: ownerUser.id, title: `Version Test Tender ${nonce}`, clientName: "Test Client", reference: "HTB-TEST", status: "DRAFT", stage: "TENDER_INTAKE" } });
    
    // Create proposal version
    const pv = (prisma as any).proposalVersion;
    version = await pv.create({ data: { tenderId: tender.id, version: 1, markdown: "# Test", fileContent: "dummy", summary: "Test", benchmarkScore: 80, qualityScore: 85, winProbabilityScore: 70, mode: "AI" } });
    
    // Create GeneratedDocument fixture
    generatedDoc = await prisma.generatedDocument.create({
      data: {
        tenderId: tender.id,
        documentType: "TECHNICAL_PROPOSAL",
        format: "DOCX",
        fileContent: "Original content",
        contentSummary: "Original summary",
        generationStatus: "GENERATED",
        validationStatus: "VALIDATED",
        reviewStatus: "APPROVED",
      }
    });

    // Import route module AFTER mocking next/headers
    routeModule = await import("../app/api/tenders/[id]/proposal-versions/[versionId]/route");
  });

  after(async () => {
    // Restore Node module-resolution state
    (Module as any)._resolveFilename = originalResolve;
    delete require.cache[mockModulePath];

    // Robust cleanup: delete in correct order to respect foreign keys
    // 1. Delete GeneratedDocuments
    if (tender) {
      await prisma.generatedDocument.deleteMany({ where: { tenderId: tender.id } }).catch(() => {});
    }
    // 2. Delete ProposalVersions
    if (tender) {
      await (prisma as any).proposalVersion.deleteMany({ where: { tenderId: tender.id } }).catch(() => {});
    }
    // 3. Delete Tender
    if (tender) {
      await prisma.tender.delete({ where: { id: tender.id } }).catch(() => {});
    }
    // 4. Delete Sessions for all test users
    const userIds = [ownerUser?.id, foreignUser?.id, adminUser?.id].filter(Boolean);
    if (userIds.length > 0) {
      await prisma.session.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
    }
    // 5. Delete Users
    if (ownerUser) await prisma.user.delete({ where: { id: ownerUser.id } }).catch(() => {});
    if (foreignUser) await prisma.user.delete({ where: { id: foreignUser.id } }).catch(() => {});
    if (adminUser) await prisma.user.delete({ where: { id: adminUser.id } }).catch(() => {});
  });

  it("owner receives 200 on list GET", async () => {
    await setAuthCookie(ownerUser.id);
    const listModule = await import("../app/api/tenders/[id]/proposal-versions/route");
    const req = new Request("http://localhost/api/tenders/" + tender.id + "/proposal-versions", { method: "GET" });
    const res = await listModule.GET(req, { params: Promise.resolve({ id: tender.id }) });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.versions));
    assert.strictEqual(data.versions.length, 1);
    await clearAuthCookie();
  });

  it("foreign PROPOSAL_MANAGER receives 404 on list GET with no data leakage", async () => {
    await setAuthCookie(foreignUser.id);
    const listModule = await import("../app/api/tenders/[id]/proposal-versions/route");
    const req = new Request("http://localhost/api/tenders/" + tender.id + "/proposal-versions", { method: "GET" });
    const res = await listModule.GET(req, { params: Promise.resolve({ id: tender.id }) });
    assert.strictEqual(res.status, 404);
    const data = await res.json();
    assert.ok(!data.versions, "Foreign response must not contain versions array");
    await clearAuthCookie();
  });

  it("owner receives 200 on single-version GET", async () => {
    await setAuthCookie(ownerUser.id);
    const req = new Request("http://localhost/api/tenders/" + tender.id + "/proposal-versions/" + version.id, { method: "GET" });
    const res = await routeModule.GET(req, { params: Promise.resolve({ id: tender.id, versionId: version.id }) });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.version.id, version.id);
    await clearAuthCookie();
  });

  it("foreign PROPOSAL_MANAGER receives 404 on single-version GET with no data leakage", async () => {
    await setAuthCookie(foreignUser.id);
    const req = new Request("http://localhost/api/tenders/" + tender.id + "/proposal-versions/" + version.id, { method: "GET" });
    const res = await routeModule.GET(req, { params: Promise.resolve({ id: tender.id, versionId: version.id }) });
    assert.strictEqual(res.status, 404);
    const data = await res.json();
    assert.ok(!data.version, "Foreign response must not contain version object");
    assert.ok(!data.markdown, "Foreign response must not contain markdown");
    assert.ok(!data.fileContent, "Foreign response must not contain fileContent");
    await clearAuthCookie();
  });

  it("owner receives 200 on diff GET", async () => {
    const pv = (prisma as any).proposalVersion;
    const v2 = await pv.create({ data: { tenderId: tender.id, version: 2, markdown: "# Test V2", summary: "Test V2", mode: "AI" } });
    
    await setAuthCookie(ownerUser.id);
    const diffModule = await import("../app/api/tenders/[id]/proposal-versions/[versionId]/diff/route");
    const req = new Request(`http://localhost/api/tenders/${tender.id}/proposal-versions/${version.id}/diff?compare_to=${v2.id}`, { method: "GET" });
    const res = await diffModule.GET(req, { params: Promise.resolve({ id: tender.id, versionId: version.id }) });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.hunks || data.diff, "Diff response should contain hunks or diff");
    await clearAuthCookie();
    
    await pv.delete({ where: { id: v2.id } });
  });

  it("foreign PROPOSAL_MANAGER receives 404 on diff GET with no data leakage", async () => {
    const pv = (prisma as any).proposalVersion;
    const v2 = await pv.create({ data: { tenderId: tender.id, version: 3, markdown: "# Test V3", summary: "Test V3", mode: "AI" } });
    
    await setAuthCookie(foreignUser.id);
    const diffModule = await import("../app/api/tenders/[id]/proposal-versions/[versionId]/diff/route");
    const req = new Request(`http://localhost/api/tenders/${tender.id}/proposal-versions/${version.id}/diff?compare_to=${v2.id}`, { method: "GET" });
    const res = await diffModule.GET(req, { params: Promise.resolve({ id: tender.id, versionId: version.id }) });
    assert.strictEqual(res.status, 404);
    const data = await res.json();
    assert.ok(!data.hunks, "Foreign response must not contain hunks");
    assert.ok(!data.diff, "Foreign response must not contain diff");
    assert.ok(!data.markdown, "Foreign response must not contain markdown");
    await clearAuthCookie();
    
    await pv.delete({ where: { id: v2.id } });
  });

  it("owner can delete own version", async () => {
    const pv = (prisma as any).proposalVersion;
    const tempVersion = await pv.create({ data: { tenderId: tender.id, version: 99, markdown: "# Delete Me", summary: "To delete", mode: "AI" } });
    
    await setAuthCookie(ownerUser.id);
    const req = new Request("http://localhost/api/tenders/" + tender.id + "/proposal-versions/" + tempVersion.id, { method: "DELETE" });
    const res = await routeModule.DELETE(req, { params: Promise.resolve({ id: tender.id, versionId: tempVersion.id }) });
    assert.strictEqual(res.status, 200);
    
    const deleted = await pv.findFirst({ where: { id: tempVersion.id } });
    assert.strictEqual(deleted, null, "Version should be deleted");
    await clearAuthCookie();
  });

  it("foreign PROPOSAL_MANAGER receives 404 on DELETE with no data leakage", async () => {
    const pv = (prisma as any).proposalVersion;
    const tempVersion = await pv.create({ data: { tenderId: tender.id, version: 98, markdown: "# Foreign Delete Me", summary: "To delete by foreign", mode: "AI" } });
    
    await setAuthCookie(foreignUser.id);
    const req = new Request("http://localhost/api/tenders/" + tender.id + "/proposal-versions/" + tempVersion.id, { method: "DELETE" });
    const res = await routeModule.DELETE(req, { params: Promise.resolve({ id: tender.id, versionId: tempVersion.id }) });
    assert.strictEqual(res.status, 404);
    
    const stillExists = await pv.findFirst({ where: { id: tempVersion.id } });
    assert.ok(stillExists, "Version must NOT be deleted by foreign PM");
    await clearAuthCookie();
    
    await pv.delete({ where: { id: tempVersion.id } });
  });

  it("owner restore changes GeneratedDocument content and sets statuses to PENDING", async () => {
    await setAuthCookie(ownerUser.id);
    const req = new Request("http://localhost/api/tenders/" + tender.id + "/proposal-versions/" + version.id, { 
      method: "POST", 
      body: JSON.stringify({ action: "restore" }), 
      headers: { "Content-Type": "application/json" } 
    });
    const res = await routeModule.POST(req, { params: Promise.resolve({ id: tender.id, versionId: version.id }) });
    assert.strictEqual(res.status, 200);
    
    const updatedDoc = await prisma.generatedDocument.findFirst({ where: { id: generatedDoc.id } });
    assert.notStrictEqual(updatedDoc.fileContent, "Original content", "Content should be changed");
    assert.strictEqual(updatedDoc.validationStatus, "PENDING", "validationStatus should be PENDING");
    assert.strictEqual(updatedDoc.reviewStatus, "PENDING", "reviewStatus should be PENDING");
    await clearAuthCookie();
  });

  it("foreign restore leaves GeneratedDocument content and statuses unchanged", async () => {
    // First, reset the document to known state
    await prisma.generatedDocument.update({
      where: { id: generatedDoc.id },
      data: { fileContent: "Original content again", validationStatus: "VALIDATED", reviewStatus: "APPROVED" }
    });
    
    await setAuthCookie(foreignUser.id);
    const req = new Request("http://localhost/api/tenders/" + tender.id + "/proposal-versions/" + version.id, { 
      method: "POST", 
      body: JSON.stringify({ action: "restore" }), 
      headers: { "Content-Type": "application/json" } 
    });
    const res = await routeModule.POST(req, { params: Promise.resolve({ id: tender.id, versionId: version.id }) });
    assert.strictEqual(res.status, 404, "Foreign restore should return 404");
    
    const unchangedDoc = await prisma.generatedDocument.findFirst({ where: { id: generatedDoc.id } });
    assert.strictEqual(unchangedDoc.fileContent, "Original content again", "Content should remain unchanged");
    assert.strictEqual(unchangedDoc.validationStatus, "VALIDATED", "validationStatus should remain VALIDATED");
    assert.strictEqual(unchangedDoc.reviewStatus, "APPROVED", "reviewStatus should remain APPROVED");
    await clearAuthCookie();
  });

  it("ADMIN retains global access on all routes", async () => {
    await setAuthCookie(adminUser.id);
    
    // List GET
    const listModule = await import("../app/api/tenders/[id]/proposal-versions/route");
    const listReq = new Request("http://localhost/api/tenders/" + tender.id + "/proposal-versions", { method: "GET" });
    const listRes = await listModule.GET(listReq, { params: Promise.resolve({ id: tender.id }) });
    assert.strictEqual(listRes.status, 200);
    
    // Single GET
    const getReq = new Request("http://localhost/api/tenders/" + tender.id + "/proposal-versions/" + version.id, { method: "GET" });
    const getRes = await routeModule.GET(getReq, { params: Promise.resolve({ id: tender.id, versionId: version.id }) });
    assert.strictEqual(getRes.status, 200);
    
    // Restore POST
    const postReq = new Request("http://localhost/api/tenders/" + tender.id + "/proposal-versions/" + version.id, { 
      method: "POST", 
      body: JSON.stringify({ action: "restore" }), 
      headers: { "Content-Type": "application/json" } 
    });
    const postRes = await routeModule.POST(postReq, { params: Promise.resolve({ id: tender.id, versionId: version.id }) });
    assert.strictEqual(postRes.status, 200);
    
    await clearAuthCookie();
  });
});
