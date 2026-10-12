// Password reset, end to end, on real PostgreSQL with a mocked mail transport:
// request → the e-mailed link → a new password that works and an old one that
// does not → every session revoked → the link dead after one use → audited.
// An unknown address gets the same answer and no mail; an expired, reused or
// made-up token gets the same generic refusal; with no SMTP configured no
// usable token is left behind; a burst of requests is throttled silently.

import { after, before, describe, it, mock } from "node:test";
import { strict as assert } from "node:assert";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";
import { prisma, prismaReady } from "../lib/prisma";
import { POST as forgotPassword } from "../app/api/auth/forgot-password/route";
import { POST as resetPassword } from "../app/api/auth/reset-password/route";
import { hashResetToken } from "../lib/reset-token";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for this test suite.");
  process.exit(1);
}

const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const email = `reset-e2e-${nonce}@example.test`;
const OLD_PASSWORD = "Old-password-1234";
const NEW_PASSWORD = "New-password-5678";
let userId = "";
const sent: Array<{ to: string; subject: string; html: string; text?: string }> = [];
const savedEnv: Record<string, string | undefined> = {};
let ipCounter = 0;

const request = (path: string, body: unknown) => new Request(`http://localhost${path}`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-forwarded-for": `10.77.${(ipCounter += 1) % 250}.${Math.floor(Math.random() * 250)}` },
  body: JSON.stringify(body),
});

async function waitFor<T>(read: () => Promise<T | null | undefined> | T | null | undefined, label: string): Promise<T> {
  for (let i = 0; i < 100; i += 1) {
    const value = await read();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for ${label}`);
}

const tokenFrom = (mail: { text?: string }) => decodeURIComponent(/token=([^\s&"]+)/.exec(mail.text ?? "")![1]!);

describe("password reset end to end — real PostgreSQL, mocked mail", () => {
  before(async () => {
    await prismaReady;
    for (const key of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "EMAIL_FROM", "TRUST_PROXY", "APP_URL"]) savedEnv[key] = process.env[key];
    Object.assign(process.env, { SMTP_HOST: "smtp.example.test", SMTP_PORT: "587", SMTP_USER: "mailer", SMTP_PASS: "not-a-real-secret", EMAIL_FROM: "Hope Tender <no-reply@example.test>", TRUST_PROXY: "true", APP_URL: "https://app.example.test" });
    mock.method(nodemailer, "createTransport", () => ({ sendMail: async (message: { to: string; subject: string; html: string; text?: string }) => { sent.push(message); return { messageId: "x" }; } }));
    userId = (await prisma.user.create({ data: { email, name: "Reset", passwordHash: await bcrypt.hash(OLD_PASSWORD, 10) } })).id;
    for (let i = 0; i < 2; i += 1) {
      await prisma.session.create({ data: { userId, token: `reset-e2e-session-${nonce}-${i}`, expiresAt: new Date(Date.now() + 86_400_000) } });
    }
  });

  after(async () => {
    mock.restoreAll();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await prisma.auditLog.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("an unknown address gets the same answer as a registered one, and no mail", async () => {
    const unknown = await forgotPassword(request("/api/auth/forgot-password", { email: `nobody-${nonce}@example.test` }));
    const known = await forgotPassword(request("/api/auth/forgot-password", { email }));
    assert.equal(unknown.status, known.status);
    assert.deepEqual(await unknown.json(), await known.json());
    const mail = await waitFor(() => sent.find((m) => m.to === email), "the reset mail");
    assert.equal(sent.filter((m) => m.to !== email).length, 0, "nothing is sent to an unregistered address");
    assert.match(mail.text ?? "", /^A password reset was requested/);
    assert.match(mail.html, /https:\/\/app\.example\.test\/reset-password\?token=/);
    assert.match(mail.text ?? "", /expires in 20 minutes and can be used once/);
  });

  it("a made-up token and a weak password are refused without changing anything", async () => {
    const madeUp = await resetPassword(request("/api/auth/reset-password", { token: "not-a-real-token", password: NEW_PASSWORD }));
    assert.equal(madeUp.status, 400);
    assert.deepEqual(await madeUp.json(), { error: "Invalid or expired reset link" });
    const token = tokenFrom(sent.find((m) => m.to === email)!);
    const weak = await resetPassword(request("/api/auth/reset-password", { token, password: "short" }));
    assert.equal(weak.status, 400);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    assert.equal(await bcrypt.compare(OLD_PASSWORD, user.passwordHash), true);
    assert.equal(await prisma.session.count({ where: { userId } }), 2);
  });

  it("the e-mailed link sets the new password, revokes every session, and works once", async () => {
    const token = tokenFrom(sent.find((m) => m.to === email)!);
    const res = await resetPassword(request("/api/auth/reset-password", { token, password: NEW_PASSWORD }));
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    assert.equal(await bcrypt.compare(NEW_PASSWORD, user.passwordHash), true, "the new password works");
    assert.equal(await bcrypt.compare(OLD_PASSWORD, user.passwordHash), false, "the old one does not");
    assert.equal(await prisma.session.count({ where: { userId } }), 0, "every session is revoked");
    const row = await prisma.passwordResetToken.findFirst({ where: { tokenHash: hashResetToken(token) } });
    assert.ok(row?.consumedAt, "the token is consumed");

    const again = await resetPassword(request("/api/auth/reset-password", { token, password: "Another-password-9" }));
    assert.equal(again.status, 400, "a used link is dead");
    assert.equal(await bcrypt.compare(NEW_PASSWORD, (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).passwordHash), true);

    const audit = await prisma.auditLog.findMany({ where: { userId, entityType: "UserSecurity" }, select: { description: true } });
    const said = audit.map((a) => a.description);
    assert.ok(said.includes("Password reset instructions requested and delivered"), said.join(" | "));
    assert.ok(said.includes("Password reset completed and active sessions revoked"), said.join(" | "));
  });

  it("an expired link is refused", async () => {
    sent.length = 0;
    await forgotPassword(request("/api/auth/forgot-password", { email }));
    const token = tokenFrom(await waitFor(() => sent.find((m) => m.to === email), "a second reset mail"));
    await prisma.passwordResetToken.updateMany({ where: { tokenHash: hashResetToken(token) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await resetPassword(request("/api/auth/reset-password", { token, password: "Expired-link-1234" }));
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "Invalid or expired reset link" });
  });

  it("with no SMTP configured the answer is the same and no usable token is left", async () => {
    const smtpHost = process.env.SMTP_HOST;
    delete process.env.SMTP_HOST;
    try {
      const before = sent.length;
      const res = await forgotPassword(request("/api/auth/forgot-password", { email }));
      assert.equal(res.status, 202);
      await waitFor(async () => (await prisma.auditLog.findFirst({ where: { userId, description: "Password reset instructions requested but delivery was unavailable" } })), "the undelivered audit entry");
      assert.equal(sent.length, before, "nothing was sent");
      assert.equal(await prisma.passwordResetToken.count({ where: { userId, consumedAt: null } }), 0, "no usable token exists that its owner never received");
    } finally {
      process.env.SMTP_HOST = smtpHost;
    }
  });

  it("a burst of requests for one account is throttled with the same generic answer", async () => {
    sent.length = 0;
    const burstEmail = `reset-burst-${nonce}@example.test`;
    const burstUser = await prisma.user.create({ data: { email: burstEmail, name: "Burst", passwordHash: "h" } });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 7; i += 1) statuses.push((await forgotPassword(request("/api/auth/forgot-password", { email: burstEmail }))).status);
      assert.ok(statuses.every((s) => s === 202), statuses.join(","));
      await new Promise((r) => setTimeout(r, 500));
      assert.ok(sent.filter((m) => m.to === burstEmail).length <= 5, `at most the limit's worth of mail (${sent.length})`);
    } finally {
      await prisma.auditLog.deleteMany({ where: { userId: burstUser.id } });
      await prisma.user.delete({ where: { id: burstUser.id } });
    }
  });
});
