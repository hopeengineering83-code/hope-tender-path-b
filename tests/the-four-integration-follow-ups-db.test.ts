// Follow-ups 2 and 3 after PR #1175, through the real routes on PostgreSQL:
// a deactivated account can neither receive nor redeem a password-reset link,
// and a tender file whose deletion is pending is not counted in the
// extraction-quality report.

import { after, before, describe, it, mock } from "node:test";
import { strict as assert } from "node:assert";
import { createHash, createHmac, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";
import { prisma, prismaReady } from "../lib/prisma";
import { hashResetToken } from "../lib/reset-token";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for this test suite.");
  process.exit(1);
}

let sessionCookie: string | undefined;
const Module = require("module");
const originalResolve = Module._resolveFilename;
const nextHeadersMockPath = "__four_follow_ups_next_headers_mock__";
Module._resolveFilename = function (request: string, ...args: unknown[]) {
  if (request === "next/headers") return nextHeadersMockPath;
  return originalResolve.call(this, request, ...args);
};
require.cache[nextHeadersMockPath] = {
  id: nextHeadersMockPath, filename: nextHeadersMockPath, loaded: true,
  exports: { cookies: async () => ({ get: (name: string) => (name === "hope_session" && sessionCookie ? { name, value: sessionCookie } : undefined) }) },
} as unknown as NodeModule;

const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const PASSWORD = "Old-password-1234";
const userIds: string[] = [];
const sent: Array<{ to: string }> = [];
const savedEnv: Record<string, string | undefined> = {};
let adminId = "";
let ip = 0;

const post = (path: string, body: unknown) => new Request(`http://localhost${path}`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-forwarded-for": `10.88.${(ip += 1) % 250}.${Math.floor(Math.random() * 250)}` },
  body: JSON.stringify(body),
});

async function newUser(label: string, role = "PROPOSAL_MANAGER") {
  const user = await prisma.user.create({ data: { email: `${label}-${nonce}@example.test`, name: label, role, passwordHash: await bcrypt.hash(PASSWORD, 10) } });
  userIds.push(user.id);
  return user;
}

async function issueToken(userId: string): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  await prisma.passwordResetToken.create({ data: { userId, tokenHash: hashResetToken(raw), expiresAt: new Date(Date.now() + 20 * 60_000) } });
  return raw;
}

async function signIn(userId: string) {
  const secret = process.env.SESSION_SECRET ?? process.env.AUTH_SECRET ?? "";
  assert.ok(secret.length >= 32, "a test session secret of at least 32 characters is required");
  const expiresAt = new Date(Date.now() + 120_000);
  const encoded = Buffer.from(JSON.stringify({ userId, exp: Math.floor(expiresAt.getTime() / 1000), nonce: randomBytes(24).toString("base64url") })).toString("base64url");
  sessionCookie = `${encoded}.${createHmac("sha256", secret).update(encoded).digest("base64url")}`;
  await prisma.session.create({ data: { token: createHash("sha256").update(sessionCookie).digest("hex"), userId, expiresAt } });
}

describe("the four integration follow-ups — real PostgreSQL", () => {
  before(async () => {
    await prismaReady;
    for (const key of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "EMAIL_FROM", "TRUST_PROXY", "APP_URL"]) savedEnv[key] = process.env[key];
    Object.assign(process.env, { SMTP_HOST: "smtp.example.test", SMTP_PORT: "587", SMTP_USER: "mailer", SMTP_PASS: "not-a-real-secret", EMAIL_FROM: "Hope Tender <no-reply@example.test>", TRUST_PROXY: "true", APP_URL: "https://app.example.test" });
    mock.method(nodemailer, "createTransport", () => ({ sendMail: async (message: { to: string }) => { sent.push(message); return { messageId: "x" }; } }));
    adminId = (await newUser("followup-admin", "ADMIN")).id;
    await signIn(adminId);
  });

  after(async () => {
    mock.restoreAll();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    sessionCookie = undefined;
    await prisma.tender.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    Module._resolveFilename = originalResolve;
    delete require.cache[nextHeadersMockPath];
  });

  it("2a. deactivating an account deletes its outstanding reset links", async () => {
    const user = await newUser("followup-leaver");
    await issueToken(user.id);
    const { DELETE } = await import("../app/api/users/[id]/route");
    const res = await DELETE(new Request(`http://localhost/api/users/${user.id}`, { method: "DELETE" }), { params: Promise.resolve({ id: user.id }) });
    assert.equal(res.status, 200);
    assert.equal(await prisma.passwordResetToken.count({ where: { userId: user.id } }), 0);
  });

  it("2b. a deactivated account is answered like an unknown address: no link, no mail", async () => {
    const user = await newUser("followup-deactivated");
    await prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });
    const { POST: forgot } = await import("../app/api/auth/forgot-password/route");
    const unknown = await forgot(post("/api/auth/forgot-password", { email: `nobody-${nonce}@example.test` }));
    const deactivated = await forgot(post("/api/auth/forgot-password", { email: user.email }));
    assert.equal(deactivated.status, unknown.status);
    assert.deepEqual(await deactivated.json(), await unknown.json());
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(await prisma.passwordResetToken.count({ where: { userId: user.id } }), 0, "no token issued");
    assert.ok(!sent.some((m) => m.to === user.email), "no mail sent");
  });

  it("2c. a link issued before deactivation cannot set a password afterwards", async () => {
    const user = await newUser("followup-late-link");
    const raw = await issueToken(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });
    const { POST: reset } = await import("../app/api/auth/reset-password/route");
    const res = await reset(post("/api/auth/reset-password", { token: raw, password: "New-password-5678" }));
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "Invalid or expired reset link" });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(await bcrypt.compare(PASSWORD, after.passwordHash), true, "the password is unchanged");
    const token = await prisma.passwordResetToken.findUniqueOrThrow({ where: { tokenHash: hashResetToken(raw) } });
    assert.ok(token.consumedAt, "the link is spent");
  });

  it("2d. an active account still resets normally", async () => {
    const user = await newUser("followup-active");
    const raw = await issueToken(user.id);
    const { POST: reset } = await import("../app/api/auth/reset-password/route");
    const res = await reset(post("/api/auth/reset-password", { token: raw, password: "New-password-5678" }));
    assert.equal(res.status, 200);
    assert.equal(await bcrypt.compare("New-password-5678", (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash), true);
  });

  it("2e. a reset racing a deactivation never deadlocks: both finish, and the account ends deactivated", async () => {
    const { POST: reset } = await import("../app/api/auth/reset-password/route");
    const { DELETE } = await import("../app/api/users/[id]/route");
    for (let round = 0; round < 6; round += 1) {
      const user = await newUser(`followup-race-${round}`);
      // A consumed earlier link as well, so both sides touch several token rows.
      const spent = await issueToken(user.id);
      await prisma.passwordResetToken.update({ where: { tokenHash: hashResetToken(spent) }, data: { consumedAt: new Date() } });
      const raw = await issueToken(user.id);
      const [resetRes, deleteRes] = await Promise.all([
        reset(post("/api/auth/reset-password", { token: raw, password: "New-password-5678" })),
        DELETE(new Request(`http://localhost/api/users/${user.id}`, { method: "DELETE" }), { params: Promise.resolve({ id: user.id }) }),
      ]);
      assert.ok([200, 400].includes(resetRes.status), `reset answered ${resetRes.status}`);
      assert.equal(deleteRes.status, 200, "deactivation is never the deadlock victim");
      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      assert.ok(after.deletedAt, "the account is deactivated");
      assert.equal(await prisma.passwordResetToken.count({ where: { userId: user.id, consumedAt: null } }), 0, "no usable link survives");
    }
  });

  it("2f. the reset locks the account before its token (deactivation's order)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("lib/secure-password-reset.ts", "utf8");
    const userLock = src.indexOf('FROM "User" WHERE "id" = ${holder[0].userId} FOR UPDATE');
    const tokenLock = src.indexOf("WHERE \"tokenHash\" = ${tokenHash}\n        FOR UPDATE");
    assert.ok(userLock > -1 && tokenLock > -1 && userLock < tokenLock, "user row first, then the token");
  });

  it("2g. a deactivation that lands mid-request leaves no reset link and sends no mail", async () => {
    const user = await newUser("followup-mid-request");
    const { POST: forgot } = await import("../app/api/auth/forgot-password/route");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    // Deactivation holds the account's row lock while the request runs.
    const deactivation = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE`;
      await gate;
      await tx.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });
      await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });
    }, { timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 200));
    const request = forgot(post("/api/auth/forgot-password", { email: user.email }));
    await new Promise((r) => setTimeout(r, 1_500));
    release();
    await deactivation;
    const res = await request;
    assert.equal(res.status, 202);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(await prisma.passwordResetToken.count({ where: { userId: user.id } }), 0, "no token for the deactivated account");
    assert.ok(!sent.some((m) => m.to === user.email), "no mail sent");
  });

  it("2h. the deferred reset mail re-checks that its link and account are still live before sending", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("app/api/auth/forgot-password/route.ts", "utf8");
    const task = src.slice(src.indexOf("afterResponse(async () => {"));
    const check = task.indexOf("where: { id: tokenId, consumedAt: null, user: { deletedAt: null } }");
    const send = task.indexOf("sendEmail(");
    assert.ok(check > -1 && send > -1 && check < send, "the liveness check precedes the send");
    assert.match(task.slice(check, send), /if \(!live\) return;/);
  });

  it("3. a file whose deletion is pending is not in the extraction-quality report", async () => {
    const tender = await prisma.tender.create({
      data: {
        userId: adminId, title: `Extraction follow-up ${nonce}`, status: "DRAFT", stage: "TENDER_INTAKE",
        files: { create: [
          { fileName: "tor.pdf", originalFileName: "tor.pdf", mimeType: "application/pdf", size: 10, totalPages: 2, extractedPages: 2, failedPages: 0, extractionScore: 95, extractedText: "Terms of reference. ".repeat(80) },
          { fileName: "old.pdf", originalFileName: "old-scan.pdf", mimeType: "application/pdf", size: 10, totalPages: 9, extractedPages: 1, failedPages: 8, extractionScore: 5, extractedText: "x", deletionStatus: "PENDING_DELETE" },
        ] },
      },
    });
    const { GET } = await import("../app/api/tenders/[id]/extraction-quality/route");
    const res = await GET(new Request(`http://localhost/api/tenders/${tender.id}/extraction-quality`), { params: Promise.resolve({ id: tender.id }) });
    assert.equal(res.status, 200);
    const body = JSON.stringify(await res.json());
    assert.match(body, /tor\.pdf/);
    assert.doesNotMatch(body, /old-scan\.pdf/, "the pending-deletion file is not reported");
  });
});
