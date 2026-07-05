// Real authenticated PostgreSQL route tests for Proposal Version ownership.
// RUN_DB_INTEGRATION=true is MANDATORY — these tests CANNOT be skipped.

import { before, after, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { prisma, prismaReady } from "../lib/prisma";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for release-safety tests.");
  process.exit(1);
}

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
(Module as any)._resolveFilename = function (request: string, ...args: any[]) {
  if (request === "next/headers") return (require.resolve as any).__next_headers_mock_path || "";
  return originalResolve.call(this, request, ...args);
};
const mockModulePath = "__next_headers_mock__";
require.cache[mockModulePath] = {
  id: mockModulePath, filename: mockModulePath, loaded: true,
  exports: nextHeadersMock, paths: [], children: [], parent: null,
} as any;
(require.resolve as any).__next_headers_mock_path = mockModulePath;

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

// FIX: Made async to actually delete the session record from the DB
async function clearAuthCookie(): Promise<void> {
  const token = __TEST_COOKIE_STORE[SESSION_COOKIE];
  if (token) {
    await prisma.session.deleteMany({ where: { token: hashToken(token) } }).catch(() => {});
  }
  __TEST_COOKIE_STORE = {};
}

describe("Proposal Version Ownership Enforcement", () => {
  let ownerUser: any, foreignUser: any, adminUser: any, tender: any, version: any, routeModule: any;

  before(async () => {
    await prismaReady;
    const nonce = Date.now();
    ownerUser = await prisma.user.create({ data: { email: `owner-${nonce}@test.com`, name: "Owner", passwordHash: "$2a$10$test", role: "PROPOSAL_MANAGER" } });
    foreignUser = await prisma.user.create({ data: { email: `foreign-${nonce}@test.com`, name: "Foreign PM", passwordHash: "$2a$10$test", role: "PROPOSAL_MANAGER" } });
    adminUser = await prisma.user.create({ data: { email: `admin-${nonce}@test.com`, name: "Admin", passwordHash: "$2a$10$test", role: "ADMIN" } });
    tender = await prisma.tender.create({ data: { userId: ownerUser.id, title: `Version Test Tender ${nonce}`, clientName: "Test Client", reference: "HTB-TEST", status: "DRAFT", stage: "TENDER_INTAKE" } });
    
    const pv = (prisma as any).proposalVersion;
    version = await pv.create({ data: { tenderId: tender.id, version: 1, markdown: "# Test", fileContent: "dummy", summary: "Test", benchmarkScore: 80, qualityScore: 85, winProbabilityScore: 70, mode: "AI" } });
    routeModule = await import("../app/api/tenders/[id]/proposal-versions/[versionId]/route");
  });

  after(async () => {
    // FIX: Clean up sessions FIRST to prevent foreign key constraint violations 
    // when deleting the test users below.
    await prisma.session.deleteMany({
      where: {
        userId: {
          in: [ownerUser?.id, foreignUser?.id, adminUser?.id].filter(Boolean)
        }
      }
    }).catch(() => {});

    if (version) await (prisma as any).proposalVersion.delete({ where: { id: version.id } }).catch(() => {});
    if (tender) await prisma.tender.delete({ where: { id: tender.id } }).catch(() => {});
    if (ownerUser) await prisma.user.delete({ where: { id: ownerUser.id } }).catch(() => {});
    if (foreignUser) await prisma.user.delete({ where: { id: foreignUser.id } }).catch(() => {});
    if (adminUser) await prisma.user.delete({ where: { id: adminUser.id } }).catch(() => {});
  });

  it("owner can restore own version", async () => {
    await setAuthCookie(ownerUser.id);
    const req = new Request("http://localhost/api/tenders/" + tender.id + "/proposal-versions/" + version.id, { method: "POST", body: JSON.stringify({ action: "restore" }), headers: { "Content-Type": "application/json" } });
    const res = await routeModule.POST(req, { params: Promise.resolve({ id: tender.id, versionId: version.id }) });
    assert.strictEqual(res.status, 200);
    await clearAuthCookie();
  });

  it("PROPOSAL_MANAGER receives 404 for foreign tender (restore)", async () => {
    await setAuthCookie(foreignUser.id);
    const req = new Request("http://localhost/api/tenders/" + tender.id + "/proposal-versions/" + version.id, { method: "POST", body: JSON.stringify({ action: "restore" }), headers: { "Content-Type": "application/json" } });
    const res = await routeModule.POST(req, { params: Promise.resolve({ id: tender.id, versionId: version.id }) });
    assert.strictEqual(res.status, 404, "Foreign IDs must never leak existence -> 404");
    await clearAuthCookie();
  });

  it("ADMIN may perform global restore on foreign tender", async () => {
    await setAuthCookie(adminUser.id);
    const req = new Request("http://localhost/api/tenders/" + tender.id + "/proposal-versions/" + version.id, { method: "POST", body: JSON.stringify({ action: "restore" }), headers: { "Content-Type": "application/json" } });
    const res = await routeModule.POST(req, { params: Promise.resolve({ id: tender.id, versionId: version.id }) });
    assert.strictEqual(res.status, 200);
    await clearAuthCookie();
  });

  it("owner can delete own version", async () => {
    const pv = (prisma as any).proposalVersion;
    const tempVersion = await pv.create({ data: { tenderId: tender.id, version: 99, markdown: "# Delete Me", summary: "To delete", mode: "AI" } });
    await setAuthCookie(ownerUser.id);
    const req = new Request("http://localhost/api/tenders/" + tender.id + "/proposal-versions/" + tempVersion.id, { method: "DELETE" });
    const res = await routeModule.DELETE(req, { params: Promise.resolve({ id: tender.id, versionId: tempVersion.id }) });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(await pv.findFirst({ where: { id: tempVersion.id } }), null);
    await clearAuthCookie();
  });

  it("cross-tenant rollback (DELETE) blocked for PROPOSAL_MANAGER", async () => {
    const pv = (prisma as any).proposalVersion;
    const tempVersion = await pv.create({ data: { tenderId: tender.id, version: 98, markdown: "# Foreign Delete Me", summary: "To delete by foreign", mode: "AI" } });
    await setAuthCookie(foreignUser.id);
    const req = new Request("http://localhost/api/tenders/" + tender.id + "/proposal-versions/" + tempVersion.id, { method: "DELETE" });
    const res = await routeModule.DELETE(req, { params: Promise.resolve({ id: tender.id, versionId: tempVersion.id }) });
    assert.strictEqual(res.status, 404);
    assert.ok(await pv.findFirst({ where: { id: tempVersion.id } }), "Version must NOT be deleted by foreign PM");
    await pv.delete({ where: { id: tempVersion.id } });
    await clearAuthCookie();
  });
});
