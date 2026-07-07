import { before, after, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { prisma, prismaReady } from "../lib/prisma";
import { createHmac, randomBytes, createHash } from "node:crypto";
import { classifyReferenceNumber, classifySubmissionMethod, classifyConditionalNote } from "../lib/engine/tender-facts-ledger";
import { resolveEffectiveTenderContext } from "../lib/engine/resolve-effective-tender-context";

const RUN_DB = process.env.RUN_DB_INTEGRATION === "true";

if (RUN_DB) {
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
    if (request === "next/headers") return "__next_headers_mock__";
    return originalResolve.call(this, request, ...args);
  };
  require.cache["__next_headers_mock__"] = { id: "__next_headers_mock__", filename: "__next_headers_mock__", loaded: true, exports: nextHeadersMock, paths: [], children: [], parent: null } as any;

  function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }
  function makeToken(userId: string) {
    const expiresAt = new Date(Date.now() + 14 * 86400 * 1000);
    const payload = { userId, exp: Math.floor(expiresAt.getTime() / 1000), nonce: randomBytes(24).toString("base64url") };
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = createHmac("sha256", process.env.SESSION_SECRET || "test-secret-32-chars-long-minimum!!").update(encoded).digest("base64url");
    return { token: `${encoded}.${sig}`, expiresAt };
  }
  async function setAuthCookie(userId: string) {
    const { token, expiresAt } = makeToken(userId);
    await prisma.session.create({ data: { token: hashToken(token), userId, expiresAt } });
    __TEST_COOKIE_STORE["hope_session"] = token;
  }
  async function clearAuthCookie() {
    const token = __TEST_COOKIE_STORE["hope_session"];
    if (token) await prisma.session.deleteMany({ where: { token: hashToken(token) } }).catch(() => {});
    __TEST_COOKIE_STORE = {};
  }

  describe("Universal Tender Facts Ledger & Metadata Completion", () => {
    let adminUser: any, pmUser: any, viewerUser: any, foreignUser: any, tender: any;
    let factsRoute: any, repairRoute: any;

    before(async () => {
      await prismaReady;
      const n = Date.now();
      adminUser = await prisma.user.create({ data: { email: `admin-${n}@test.com`, passwordHash: "x", role: "ADMIN" } });
      pmUser = await prisma.user.create({ data: { email: `pm-${n}@test.com`, passwordHash: "x", role: "PROPOSAL_MANAGER" } });
      viewerUser = await prisma.user.create({ data: { email: `viewer-${n}@test.com`, passwordHash: "x", role: "VIEWER" } });
      foreignUser = await prisma.user.create({ data: { email: `foreign-${n}@test.com`, passwordHash: "x", role: "PROPOSAL_MANAGER" } });
      tender = await prisma.tender.create({ data: { userId: adminUser.id, title: "Test", clientName: "Client", status: "DRAFT", stage: "TENDER_INTAKE" } });
      factsRoute = await import("../app/api/tenders/[id]/facts/route");
      repairRoute = await import("../app/api/tenders/[id]/repair-metadata/route");
    });

    after(async () => {
      (Module as any)._resolveFilename = originalResolve;
      delete require.cache["__next_headers_mock__"];
      await prisma.tenderFact.deleteMany({ where: { tenderId: tender.id } }).catch(() => {});
      await prisma.tender.delete({ where: { id: tender.id } }).catch(() => {});
      await prisma.session.deleteMany({ where: { userId: { in: [adminUser.id, pmUser.id, viewerUser.id, foreignUser.id] } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: [adminUser.id, pmUser.id, viewerUser.id, foreignUser.id] } } }).catch(() => {});
    });

    const postFact = async (userId: string, body: any) => {
      await setAuthCookie(userId);
      const req = new Request("http://localhost/test", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
      const res = await factsRoute.POST(req, { params: Promise.resolve({ id: tender.id }) });
      await clearAuthCookie();
      return res;
    };

    it("Letter-only reference is accepted", () => {
      const res = classifyReferenceNumber("RFP/CONSULTANCY");
      assert.strictEqual(res.isValid, true);
    });

    it("Email/Portal/Physical methods accepted", () => {
      assert.strictEqual(classifySubmissionMethod("Email").normalized, "EMAIL");
      assert.strictEqual(classifySubmissionMethod("Upload through e-procurement portal").normalized, "PORTAL");
      assert.strictEqual(classifySubmissionMethod("Sealed envelope").normalized, "PHYSICAL");
    });

    it("Garbage rejected without draft blocking", () => {
      const res = classifyReferenceNumber("Not");
      assert.strictEqual(res.state, "REJECTED_EXTRACTION");
    });

    it("Conditional location note remains conditional", () => {
      const res = classifyConditionalNote("Exact site to be determined with consultant assistance");
      assert.strictEqual(res.isConditional, true);
      assert.strictEqual(res.state, "CONDITIONAL_OR_UNSCHEDULED");
    });

    it("Multiple emails have individual evidence", async () => {
      const res = await postFact(adminUser.id, {
        semanticKey: "submission_email", displayLabel: "Emails", category: "submission",
        valueType: "EMAIL_LIST", structuredValue: [{ email: "a@test.com" }, { email: "b@test.com" }],
        authorityState: "SOURCE_GROUNDED_CONFIRMED"
      });
      assert.strictEqual(res.status, 200);
      const ctx = await resolveEffectiveTenderContext(tender.id);
      assert.strictEqual(ctx.submissionEmails.length, 2);
    });

    it("Human-confirmed operational facts work with audit", async () => {
      const res = await postFact(pmUser.id, {
        semanticKey: "deadline", displayLabel: "Deadline", category: "submission",
        valueType: "DATETIME", normalizedValue: "2026-08-25T17:00:00Z",
        authorityState: "HUMAN_CONFIRMED_OPERATIONAL", manualBasis: "Procurement portal"
      });
      assert.strictEqual(res.status, 200);
    });

    it("Reviewer/Viewer denied mutation", async () => {
      const res = await postFact(viewerUser.id, { semanticKey: "test", displayLabel: "Test", category: "custom", valueType: "TEXT", normalizedValue: "x" });
      assert.strictEqual(res.status, 403);
    });

    it("Tenant isolation holds (no existence leakage)", async () => {
      await setAuthCookie(foreignUser.id);
      const req = new Request("http://localhost/test", { method: "GET" });
      const res = await factsRoute.GET(req, { params: Promise.resolve({ id: tender.id }) });
      await clearAuthCookie();
      assert.strictEqual(res.status, 404);
    });

    it("Effective context resolves unified snapshot", async () => {
      const ctx = await resolveEffectiveTenderContext(tender.id);
      assert.ok(ctx.snapshotRevision);
      assert.strictEqual(ctx.facts["deadline"].state, "HUMAN_CONFIRMED_OPERATIONAL");
    });
  });
}
