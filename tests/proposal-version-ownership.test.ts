// Real authenticated PostgreSQL route tests for Proposal Version ownership.
// RUN_DB_INTEGRATION=true is MANDATORY for these tests to execute.

import { before, after, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { prisma, prismaReady } from "../lib/prisma";
import { createHmac, randomBytes, createHash } from "node:crypto";

const dbDescribe = process.env.RUN_DB_INTEGRATION === "true" ? describe : describe.skip;

// Minimal clean DOCX archive: [Content_Types].xml + word/document.xml.
// The restore route now verifies real byte signatures and OpenXML structure.
const VALID_DOCX_BASE64 = "UEsDBBQAAAAIACyy7FzHHBc8CgAAAAgAAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbLMJqSxILda3AwBQSwMEFAAAAAgALLLsXBFe50wJAAAABwAAABEAAAB3b3JkL2RvY3VtZW50LnhtbLMpys8v0bcDAFBLAQIUAxQAAAAIACyy7FzHHBc8CgAAAAgAAAATAAAAAAAAAAAAAACAAQAAAABbQ29udGVudF9UeXBlc10ueG1sUEsBAhQDFAAAAAgALLLsXBFe50wJAAAABwAAABEAAAAAAAAAAAAAAIABOwAAAHdvcmQvZG9jdW1lbnQueG1sUEsFBgAAAAACAAIAgAAAAHMAAAAAAA==";

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
  id: mockModulePath,
  filename: mockModulePath,
  loaded: true,
  exports: nextHeadersMock,
  paths: [],
  children: [],
  parent: null,
} as any;

const SESSION_COOKIE = "hope_session";

function getSecret(): string {
  return process.env.SESSION_SECRET
    || process.env.AUTH_SECRET
    || "test-session-secret-at-least-32-characters-long-for-hmac";
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function makeToken(userId: string): { token: string; expiresAt: Date } {
  const expiresAt = new Date(Date.now() + 14 * 86400 * 1000);
  const payload = {
    userId,
    exp: Math.floor(expiresAt.getTime() / 1000),
    nonce: randomBytes(24).toString("base64url"),
  };
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
    await prisma.session.deleteMany({ where: { token: hashToken(token) } }).catch(() => undefined);
  }
  __TEST_COOKIE_STORE = {};
}

dbDescribe("Proposal Version Ownership Enforcement", () => {
  let ownerUser: any;
  let foreignUser: any;
  let adminUser: any;
  let tender: any;
  let version: any;
  let routeModule: any;
  let generatedDoc: any;

  before(async () => {
    await prismaReady;
    const nonce = Date.now();

    ownerUser = await prisma.user.create({
      data: {
        email: `owner-${nonce}@test.com`,
        name: "Owner",
        passwordHash: "$2a$10$test",
        role: "PROPOSAL_MANAGER",
      },
    });
    foreignUser = await prisma.user.create({
      data: {
        email: `foreign-${nonce}@test.com`,
        name: "Foreign PM",
        passwordHash: "$2a$10$test",
        role: "PROPOSAL_MANAGER",
      },
    });
    adminUser = await prisma.user.create({
      data: {
        email: `admin-${nonce}@test.com`,
        name: "Admin",
        passwordHash: "$2a$10$test",
        role: "ADMIN",
      },
    });

    tender = await prisma.tender.create({
      data: {
        userId: ownerUser.id,
        title: `Version Test Tender ${nonce}`,
        clientName: "Test Client",
        reference: "HTB-TEST",
        status: "DRAFT",
        stage: "TENDER_INTAKE",
      },
    });

    const pv = (prisma as any).proposalVersion;
    version = await pv.create({
      data: {
        tenderId: tender.id,
        version: 1,
        markdown: "# Test",
        fileContent: VALID_DOCX_BASE64,
        summary: "Test",
        benchmarkScore: 80,
        qualityScore: 85,
        winProbabilityScore: 70,
        mode: "AI",
      },
    });

    generatedDoc = await prisma.generatedDocument.create({
      data: {
        tenderId: tender.id,
        name: "Test Technical Proposal",
        exactFileName: "Test-Technical-Proposal.docx",
        documentType: "TECHNICAL_PROPOSAL",
        format: "DOCX",
        fileContent: "Original content",
        contentSummary: "Original summary",
        generationStatus: "GENERATED",
        validationStatus: "VALIDATED",
        reviewStatus: "APPROVED",
      },
    });

    routeModule = await import("../app/api/tenders/[id]/proposal-versions/[versionId]/route");
  });

  after(async () => {
    (Module as any)._resolveFilename = originalResolve;
    delete require.cache[mockModulePath];

    if (tender) {
      await prisma.generatedDocument.deleteMany({ where: { tenderId: tender.id } }).catch(() => undefined);
      await (prisma as any).proposalVersion.deleteMany({ where: { tenderId: tender.id } }).catch(() => undefined);
      await prisma.tender.delete({ where: { id: tender.id } }).catch(() => undefined);
    }
    const userIds = [ownerUser?.id, foreignUser?.id, adminUser?.id].filter(Boolean);
    if (userIds.length > 0) {
      await prisma.session.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
    }
    if (ownerUser) await prisma.user.delete({ where: { id: ownerUser.id } }).catch(() => undefined);
    if (foreignUser) await prisma.user.delete({ where: { id: foreignUser.id } }).catch(() => undefined);
    if (adminUser) await prisma.user.delete({ where: { id: adminUser.id } }).catch(() => undefined);
  });

  it("owner receives 200 on list GET", async () => {
    await setAuthCookie(ownerUser.id);
    const listModule = await import("../app/api/tenders/[id]/proposal-versions/route");
    const req = new Request(`http://localhost/api/tenders/${tender.id}/proposal-versions`, { method: "GET" });
    const res = await listModule.GET(req, { params: Promise.resolve({ id: tender.id }) });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.versions));
    assert.equal(data.versions.length, 1);
    await clearAuthCookie();
  });

  it("foreign PROPOSAL_MANAGER receives 404 on list GET with no data leakage", async () => {
    await setAuthCookie(foreignUser.id);
    const listModule = await import("../app/api/tenders/[id]/proposal-versions/route");
    const req = new Request(`http://localhost/api/tenders/${tender.id}/proposal-versions`, { method: "GET" });
    const res = await listModule.GET(req, { params: Promise.resolve({ id: tender.id }) });
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.ok(!data.versions);
    await clearAuthCookie();
  });

  it("owner receives 200 on single-version GET", async () => {
    await setAuthCookie(ownerUser.id);
    const req = new Request(`http://localhost/api/tenders/${tender.id}/proposal-versions/${version.id}`, { method: "GET" });
    const res = await routeModule.GET(req, { params: Promise.resolve({ id: tender.id, versionId: version.id }) });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.version.id, version.id);
    await clearAuthCookie();
  });

  it("foreign PROPOSAL_MANAGER receives 404 on single-version GET with no data leakage", async () => {
    await setAuthCookie(foreignUser.id);
    const req = new Request(`http://localhost/api/tenders/${tender.id}/proposal-versions/${version.id}`, { method: "GET" });
    const res = await routeModule.GET(req, { params: Promise.resolve({ id: tender.id, versionId: version.id }) });
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.ok(!data.version);
    assert.ok(!data.markdown);
    assert.ok(!data.fileContent);
    await clearAuthCookie();
  });

  it("owner receives 200 on diff GET", async () => {
    const pv = (prisma as any).proposalVersion;
    const v2 = await pv.create({
      data: { tenderId: tender.id, version: 2, markdown: "# Test V2", summary: "Test V2", mode: "AI" },
    });
    await setAuthCookie(ownerUser.id);
    const diffModule = await import("../app/api/tenders/[id]/proposal-versions/[versionId]/diff/route");
    const req = new Request(`http://localhost/api/tenders/${tender.id}/proposal-versions/${version.id}/diff?compare_to=${v2.id}`, { method: "GET" });
    const res = await diffModule.GET(req, { params: Promise.resolve({ id: tender.id, versionId: version.id }) });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.hunks || data.diff);
    await clearAuthCookie();
    await pv.delete({ where: { id: v2.id } });
  });

  it("foreign PROPOSAL_MANAGER receives 404 on diff GET with no data leakage", async () => {
    const pv = (prisma as any).proposalVersion;
    const v2 = await pv.create({
      data: { tenderId: tender.id, version: 3, markdown: "# Test V3", summary: "Test V3", mode: "AI" },
    });
    await setAuthCookie(foreignUser.id);
    const diffModule = await import("../app/api/tenders/[id]/proposal-versions/[versionId]/diff/route");
    const req = new Request(`http://localhost/api/tenders/${tender.id}/proposal-versions/${version.id}/diff?compare_to=${v2.id}`, { method: "GET" });
    const res = await diffModule.GET(req, { params: Promise.resolve({ id: tender.id, versionId: version.id }) });
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.ok(!data.hunks);
    assert.ok(!data.diff);
    assert.ok(!data.markdown);
    await clearAuthCookie();
    await pv.delete({ where: { id: v2.id } });
  });

  it("owner can delete own version", async () => {
    const pv = (prisma as any).proposalVersion;
    const tempVersion = await pv.create({
      data: { tenderId: tender.id, version: 99, markdown: "# Delete Me", summary: "To delete", mode: "AI" },
    });
    await setAuthCookie(ownerUser.id);
    const req = new Request(`http://localhost/api/tenders/${tender.id}/proposal-versions/${tempVersion.id}`, { method: "DELETE" });
    const res = await routeModule.DELETE(req, { params: Promise.resolve({ id: tender.id, versionId: tempVersion.id }) });
    assert.equal(res.status, 200);
    assert.equal(await pv.findFirst({ where: { id: tempVersion.id } }), null);
    await clearAuthCookie();
  });

  it("foreign PROPOSAL_MANAGER receives 404 on DELETE with no data leakage", async () => {
    const pv = (prisma as any).proposalVersion;
    const tempVersion = await pv.create({
      data: { tenderId: tender.id, version: 98, markdown: "# Foreign Delete Me", summary: "To delete by foreign", mode: "AI" },
    });
    await setAuthCookie(foreignUser.id);
    const req = new Request(`http://localhost/api/tenders/${tender.id}/proposal-versions/${tempVersion.id}`, { method: "DELETE" });
    const res = await routeModule.DELETE(req, { params: Promise.resolve({ id: tender.id, versionId: tempVersion.id }) });
    assert.equal(res.status, 404);
    assert.ok(await pv.findFirst({ where: { id: tempVersion.id } }));
    await clearAuthCookie();
    await pv.delete({ where: { id: tempVersion.id } });
  });

  it("owner restore persists verified bytes and resets release statuses", async () => {
    await setAuthCookie(ownerUser.id);
    const req = new Request(`http://localhost/api/tenders/${tender.id}/proposal-versions/${version.id}`, {
      method: "POST",
      body: JSON.stringify({ action: "restore" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await routeModule.POST(req, { params: Promise.resolve({ id: tender.id, versionId: version.id }) });
    assert.equal(res.status, 200);

    const updatedDoc = await prisma.generatedDocument.findUnique({ where: { id: generatedDoc.id } });
    assert.ok(updatedDoc?.fileContent || updatedDoc?.storagePath);
    assert.equal(updatedDoc?.integrityStatus, "VERIFIED");
    assert.ok(updatedDoc?.contentSha256);
    assert.equal(updatedDoc?.validationStatus, "PENDING");
    assert.equal(updatedDoc?.reviewStatus, "PENDING");
    await clearAuthCookie();
  });

  it("foreign restore leaves GeneratedDocument content and statuses unchanged", async () => {
    await prisma.generatedDocument.update({
      where: { id: generatedDoc.id },
      data: {
        fileContent: "Original content again",
        validationStatus: "VALIDATED",
        reviewStatus: "APPROVED",
      },
    });

    await setAuthCookie(foreignUser.id);
    const req = new Request(`http://localhost/api/tenders/${tender.id}/proposal-versions/${version.id}`, {
      method: "POST",
      body: JSON.stringify({ action: "restore" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await routeModule.POST(req, { params: Promise.resolve({ id: tender.id, versionId: version.id }) });
    assert.equal(res.status, 404);

    const unchangedDoc = await prisma.generatedDocument.findUnique({ where: { id: generatedDoc.id } });
    assert.equal(unchangedDoc?.fileContent, "Original content again");
    assert.equal(unchangedDoc?.validationStatus, "VALIDATED");
    assert.equal(unchangedDoc?.reviewStatus, "APPROVED");
    await clearAuthCookie();
  });

  it("ADMIN retains global access on all routes", async () => {
    await setAuthCookie(adminUser.id);
    const listModule = await import("../app/api/tenders/[id]/proposal-versions/route");

    const listReq = new Request(`http://localhost/api/tenders/${tender.id}/proposal-versions`, { method: "GET" });
    const listRes = await listModule.GET(listReq, { params: Promise.resolve({ id: tender.id }) });
    assert.equal(listRes.status, 200);

    const getReq = new Request(`http://localhost/api/tenders/${tender.id}/proposal-versions/${version.id}`, { method: "GET" });
    const getRes = await routeModule.GET(getReq, { params: Promise.resolve({ id: tender.id, versionId: version.id }) });
    assert.equal(getRes.status, 200);

    const postReq = new Request(`http://localhost/api/tenders/${tender.id}/proposal-versions/${version.id}`, {
      method: "POST",
      body: JSON.stringify({ action: "restore" }),
      headers: { "Content-Type": "application/json" },
    });
    const postRes = await routeModule.POST(postReq, { params: Promise.resolve({ id: tender.id, versionId: version.id }) });
    assert.equal(postRes.status, 200);

    await clearAuthCookie();
  });
});
