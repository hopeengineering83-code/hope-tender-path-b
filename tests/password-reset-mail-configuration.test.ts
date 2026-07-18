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
    assert.match(systemReadinessSource, /SMTP_HOST\) && has\(process\.env\.SMTP_USER\) && has\(process\.env\.SMTP_PASS\) && has\(process\.env\.EMAIL_FROM\)/);
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
