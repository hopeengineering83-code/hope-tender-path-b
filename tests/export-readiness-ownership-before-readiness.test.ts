// DB-backed regression test: export-readiness route must confirm tender
// ownership BEFORE invoking getFinalSubmissionReadiness/getFinalPackageReadinessModel.
//
// Root cause of the bug this guards against: getFinalPackageReadinessModel
// throws a generic Error("Tender not found") for a missing/foreign tender.
// Running it in Promise.all before ownership was confirmed meant that throw
// propagated to the route's outer catch -> safeApiError, which defaults to
// HTTP 500 -- so an invalid/foreign tender ID returned 500 instead of a
// clean, non-enumerating 404. This directly caused the "Export gates"
// production-smoke test failure (which asserts a strict, non-500 status).
//
// Requires RUN_DB_INTEGRATION=true and an isolated PostgreSQL instance.

import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes, createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

const RUN_DB = process.env.RUN_DB_INTEGRATION === "true";
const dbDescribe = RUN_DB ? describe : describe.skip;
const SESSION_COOKIE = "hope_session";
let prisma: PrismaClient;
let __TEST_COOKIE_STORE: Record<string, string> = {};

if (RUN_DB) {
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
    if (request === "next/headers") return (require.resolve as any).__export_readiness_next_headers_mock_path || "";
    return originalResolve.call(this, request, ...args);
  };
  const mockModulePath = "__export_readiness_next_headers_mock__";
  require.cache[mockModulePath] = { id: mockModulePath, filename: mockModulePath, loaded: true, exports: nextHeadersMock, paths: [], children: [], parent: null } as any;
  (require.resolve as any).__export_readiness_next_headers_mock_path = mockModulePath;
}

function secret(): string {
  return process.env.SESSION_SECRET || process.env.AUTH_SECRET || "test-session-secret-at-least-32-characters-long";
}
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
function makeToken(userId: string): { token: string; expiresAt: Date } {
  const expiresAt = new Date(Date.now() + 14 * 86400 * 1000);
  const payload = { userId, exp: Math.floor(expiresAt.getTime() / 1000), nonce: randomBytes(16).toString("base64url") };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret()).update(encoded).digest("base64url");
  return { token: `${encoded}.${sig}`, expiresAt };
}
async function setAuthCookie(userId: string) {
  const { token, expiresAt } = makeToken(userId);
  await (prisma as any).session.create({ data: { token: hashToken(token), userId, expiresAt } });
  __TEST_COOKIE_STORE[SESSION_COOKIE] = token;
}

dbDescribe("export-readiness route — ownership confirmed before readiness models (DB integration)", () => {
  let GET: any;
  let primaryUser: any;
  let secondaryUser: any;
  let ownedTender: any;
  let foreignTender: any;

  before(async () => {
    const prismaModule = await import("../lib/prisma");
    prisma = prismaModule.prisma as PrismaClient;
    await prismaModule.prismaReady;
    const routeModule = await import("../app/api/tenders/[id]/export-readiness/route");
    GET = routeModule.GET;

    primaryUser = await (prisma as any).user.create({ data: { email: `export-readiness-primary-${Date.now()}@example.test`, name: "Primary", passwordHash: "$2a$10$test", role: "ADMIN" } });
    secondaryUser = await (prisma as any).user.create({ data: { email: `export-readiness-secondary-${Date.now()}@example.test`, name: "Secondary", passwordHash: "$2a$10$test", role: "ADMIN" } });
    await (prisma as any).company.create({ data: { userId: primaryUser.id, name: "Primary Co" } });

    ownedTender = await (prisma as any).tender.create({
      data: { userId: primaryUser.id, title: "Owned tender", status: "DRAFT", stage: "TENDER_INTAKE" },
    });
    foreignTender = await (prisma as any).tender.create({
      data: { userId: secondaryUser.id, title: "Foreign tender", status: "DRAFT", stage: "TENDER_INTAKE" },
    });
  });

  after(async () => {
    await (prisma as any).tender.deleteMany({ where: { id: { in: [ownedTender.id, foreignTender.id] } } }).catch(() => {});
    await (prisma as any).company.deleteMany({ where: { userId: primaryUser.id } }).catch(() => {});
    await (prisma as any).user.deleteMany({ where: { id: { in: [primaryUser.id, secondaryUser.id] } } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("an invalid/nonexistent tender ID returns 404 TENDER_NOT_FOUND, never 500", async () => {
    await setAuthCookie(primaryUser.id);
    const res = await GET(new Request("http://localhost/api/tenders/not-a-real-uuid-shaped-id/export-readiness"), { params: Promise.resolve({ id: "not-a-real-uuid-shaped-id" }) });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.code, "TENDER_NOT_FOUND");
  });

  it("a foreign tender ID (owned by another user) returns a non-enumerating 404, never 500", async () => {
    await setAuthCookie(primaryUser.id);
    const res = await GET(new Request(`http://localhost/api/tenders/${foreignTender.id}/export-readiness`), { params: Promise.resolve({ id: foreignTender.id }) });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.code, "TENDER_NOT_FOUND");
    // Must not reveal the foreign tender's title or any other detail.
    assert.ok(!JSON.stringify(body).includes("Foreign tender"));
  });

  it("a valid, owned tender proceeds to readiness evaluation (no exception-derived 500)", async () => {
    await setAuthCookie(primaryUser.id);
    const res = await GET(new Request(`http://localhost/api/tenders/${ownedTender.id}/export-readiness`), { params: Promise.resolve({ id: ownedTender.id }) });
    assert.ok(res.status < 500, `expected a non-500 response, got ${res.status}`);
    const body = await res.json();
    assert.equal(typeof body.exportReadiness?.ok, "boolean");
  });
});
