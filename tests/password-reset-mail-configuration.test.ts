import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

const emailSource = read("lib/email.ts");
const forgotSource = read("app/api/auth/forgot-password/route.ts");
const systemReadinessSource = read("lib/system-readiness.ts");

describe("password reset mail configuration truth", () => {
  it("does not synthesize a default sender for password-reset delivery", () => {
    assert.doesNotMatch(emailSource, /noreply@hopetender\.com/);
    assert.match(emailSource, /const from = process\.env\.EMAIL_FROM\?\.trim\(\)/);
  });

  it("uses a deterministic delivery-configuration helper that requires EMAIL_FROM", () => {
    assert.match(emailSource, /export function getEmailDeliveryConfig\(\): EmailDeliveryConfig \| null/);
    assert.match(emailSource, /export function isEmailDeliveryConfigured\(\): boolean/);
    assert.match(emailSource, /!host \|\| !user \|\| !pass \|\| !from/);
    assert.match(emailSource, /return \{ host, port, user, pass, from \}/);
    assert.match(systemReadinessSource, /import \{ isEmailDeliveryConfigured \} from "\.\/email"/);
    assert.match(systemReadinessSource, /const smtpConfigured = isEmailDeliveryConfigured\(\)/);
  });

  it("does not load nodemailer from inside the delivery try block", () => {
    assert.match(emailSource, /import nodemailer from "nodemailer"/);
    assert.doesNotMatch(emailSource, /require\("nodemailer"\)/);
    const tryBlock = emailSource.slice(emailSource.indexOf("try {"), emailSource.indexOf("} catch"));
    assert.doesNotMatch(tryBlock, /import\(|require\(/);
  });

  it("keeps forgot-password anti-enumeration copy honest when delivery is not configured", () => {
    assert.match(forgotSource, /If that email is registered and email delivery is configured/);
    assert.doesNotMatch(forgotSource, /If that email is registered, password reset instructions will be sent\./);
  });

  it("still revokes undelivered reset tokens instead of leaving usable tokens after mail failure", () => {
    assert.match(forgotSource, /if \(!delivery\.delivered\)/);
    assert.match(forgotSource, /DELETE FROM "PasswordResetToken"[\s\S]*WHERE "id" = \$\{tokenId\}/);
  });
});


describe("password reset mail configuration behavior", () => {
  const keys = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "EMAIL_FROM"] as const;

  async function withEnv<T>(values: Partial<Record<(typeof keys)[number], string | undefined>>, fn: () => Promise<T> | T): Promise<T> {
    const previous = new Map<string, string | undefined>();
    for (const key of keys) {
      previous.set(key, process.env[key]);
      const next = values[key];
      if (next === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = next;
      }
    }
    try {
      return await fn();
    } finally {
      for (const key of keys) {
        const value = previous.get(key);
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  }

  it("returns null and NOT_CONFIGURED when EMAIL_FROM is missing", async () => {
    const { getEmailDeliveryConfig, isEmailDeliveryConfigured, sendEmail } = await import("../lib/email");
    await withEnv({
      SMTP_HOST: "smtp.example.test",
      SMTP_PORT: "587",
      SMTP_USER: "mailer",
      SMTP_PASS: "secret",
      EMAIL_FROM: undefined,
    }, async () => {
      assert.equal(getEmailDeliveryConfig(), null);
      assert.equal(isEmailDeliveryConfigured(), false);
      const result = await sendEmail({ to: "user@example.test", subject: "Reset", html: "<p>Reset</p>" });
      assert.deepEqual(result, { delivered: false, reason: "NOT_CONFIGURED" });
    });
  });

  it("rejects invalid SMTP ports before attempting delivery", async () => {
    const { getEmailDeliveryConfig, isEmailDeliveryConfigured } = await import("../lib/email");
    await withEnv({
      SMTP_HOST: "smtp.example.test",
      SMTP_PORT: "not-a-port",
      SMTP_USER: "mailer",
      SMTP_PASS: "secret",
      EMAIL_FROM: "security@example.test",
    }, () => {
      assert.equal(getEmailDeliveryConfig(), null);
      assert.equal(isEmailDeliveryConfigured(), false);
    });
  });

  it("returns a trimmed config when every required field is present", async () => {
    const { getEmailDeliveryConfig, isEmailDeliveryConfigured } = await import("../lib/email");
    await withEnv({
      SMTP_HOST: " smtp.example.test ",
      SMTP_PORT: "465",
      SMTP_USER: " mailer ",
      SMTP_PASS: " secret ",
      EMAIL_FROM: " security@example.test ",
    }, () => {
      assert.deepEqual(getEmailDeliveryConfig(), {
        host: "smtp.example.test",
        port: 465,
        user: "mailer",
        pass: "secret",
        from: "security@example.test",
      });
      assert.equal(isEmailDeliveryConfigured(), true);
    });
  });
});
