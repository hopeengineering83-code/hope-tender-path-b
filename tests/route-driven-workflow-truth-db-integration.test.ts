// Optional DB-backed route execution for route-driven workflow truth.
// Runs only with RUN_DB_INTEGRATION=true and a real PostgreSQL DATABASE_URL.

import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes, createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { assertPublicReadinessAgreement, type PublicReadinessEnvelope } from "../lib/engine/public-readiness-envelope";

const RUN_DB = process.env.RUN_DB_INTEGRATION === "true";
const dbDescribe = RUN_DB ? describe : describe.skip;
const SESSION_COOKIE = "hope_session";
let prisma: PrismaClient;
let user: any;
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
    if (request === "next/headers") return (require.resolve as any).__next_headers_mock_path || "";
    return originalResolve.call(this, request, ...args);
  };
  const mockModulePath = "__route_truth_next_headers_mock__";
  require.cache[mockModulePath] = { id: mockModulePath, filename: mockModulePath, loaded: true, exports: nextHeadersMock, paths: [], children: [], parent: null } as any;
  (require.resolve as any).__next_headers_mock_path = mockModulePath;
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
async function jsonFrom(routeModule: any, routeName: string, tenderId: string): Promise<PublicReadinessEnvelope & { route: string }> {
  await setAuthCookie(user.id);
  const response = await routeModule.GET(new Request(`http://localhost/api/tenders/${tenderId}/${routeName}`), { params: Promise.resolve({ id: tenderId }) });
  assert.ok(response.status < 500, `${routeName} returned ${response.status}`);
  const body = await response.json();
  return { route: routeName, ...body };
}
async function createNoConfirmedPlanTender() {
  const tender = await (prisma as any).tender.create({
    data: {
      userId: user.id,
      title: `Route truth ${Date.now()}`,
      clientName: "Ministry of Test Infrastructure",
      reference: "RT-DB-001",
      status: "DRAFT",
      stage: "TENDER_INTAKE",
      notes: "Analysis source: AI (route truth test).",
      analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED",
      submissionMethod: "email submission required",
      submissionEmails: "submit@example.com",
      deadline: new Date(Date.now() + 30 * 86400 * 1000),
    },
  });
  const file = await (prisma as any).tenderFile.create({
    data: {
      tenderId: tender.id,
      fileName: "route-truth.pdf",
      originalFileName: "route-truth.pdf",
      mimeType: "application/pdf",
      size: 1024,
      extractedText: "This tender requires Technical Proposal.pdf and submission by email to submit@example.com.",
      totalPages: 1,
      extractedPages: 1,
      failedPages: 0,
      extractionScore: 100,
      extractionMethod: "text",
    },
  });
  await (prisma as any).tenderRequirement.create({ data: { tenderId: tender.id, title: "Technical Proposal.pdf", description: "Submit Technical Proposal.pdf", requirementType: "TECHNICAL", priority: "MANDATORY", exactFileName: "Technical Proposal.pdf", exactOrder: 1, sourceTenderFileId: file.id, sourcePageNumber: 1, sourceExactQuote: "This tender requires Technical Proposal.pdf" } });
  return tender;
}

dbDescribe("route-driven workflow truth — DB-backed route execution", () => {
  let routes: Record<string, any>;

  before(async () => {
    const prismaModule = await import("../lib/prisma");
    prisma = prismaModule.prisma as PrismaClient;
    await prismaModule.prismaReady;
    user = await (prisma as any).user.create({ data: { email: `route-truth-${Date.now()}@example.test`, name: "Route Truth", passwordHash: "$2a$10$test", role: "ADMIN" } });
    await (prisma as any).company.create({ data: { userId: user.id, name: "Route Truth Co" } });
    routes = {
      lifecycle: await import("../app/api/tenders/[id]/lifecycle/route"),
      "readiness-score": await import("../app/api/tenders/[id]/readiness-score/route"),
      "generation-readiness": await import("../app/api/tenders/[id]/generation-readiness/route"),
      "export-readiness": await import("../app/api/tenders/[id]/export-readiness/route"),
      "workflow-status": await import("../app/api/tenders/[id]/workflow-status/route"),
      detail: await import("../app/api/tenders/[id]/route"),
    };
  });

  after(async () => {
    if (user) await (prisma as any).user.delete({ where: { id: user.id } }).catch(() => {});
    await prisma?.$disconnect();
  });

  it("no confirmed Build Plan stays blocked across real route responses", async () => {
    const tender = await createNoConfirmedPlanTender();
    const payloads = await Promise.all(Object.entries(routes).map(([name, route]) => jsonFrom(route, name, tender.id)));
    for (const payload of payloads) {
      assert.equal(Array.isArray(payload.blockers), true, `${payload.route} blockers[]`);
      assert.equal(Array.isArray(payload.warnings), true, `${payload.route} warnings[]`);
      assert.equal(typeof payload.requiredDocumentsTotal, "number", `${payload.route} requiredDocumentsTotal`);
      assert.equal(typeof payload.generatedDocumentsTotal, "number", `${payload.route} generatedDocumentsTotal`);
      assert.equal(typeof payload.exportReadyDocumentsTotal, "number", `${payload.route} exportReadyDocumentsTotal`);
      assert.notEqual(payload.status, "READY", `${payload.route} must not be READY without confirmed Build Plan/generated docs`);
    }
    assert.deepEqual(assertPublicReadinessAgreement(payloads).contradictions, []);
    await (prisma as any).tender.delete({ where: { id: tender.id } });
  });
});
