import { describe, it } from "node:test";
import assert from "node:assert";

// Logic-only verification of the scheduler's authentication patterns

describe("AI Job Scheduler Authentication", () => {
  const CRON_SECRET = "very-secret-cron-token-1234567890";
  const WORKER_SECRET = "very-secret-worker-token-1234567890";

  function isAuthorized(headers: Record<string, string>): boolean {
    const workerSecret = headers["x-worker-secret"];
    const isWorkerSecret = Boolean(WORKER_SECRET && WORKER_SECRET.length >= 16 && workerSecret === WORKER_SECRET);

    const authHeader = headers["authorization"] ?? "";
    const isVercelCron = Boolean(CRON_SECRET && CRON_SECRET.length >= 16 && authHeader === `Bearer ${CRON_SECRET}`);

    return isWorkerSecret || isVercelCron;
  }

  it("should accept valid Vercel Cron secret", () => {
    const headers = { authorization: `Bearer ${CRON_SECRET}` };
    assert.strictEqual(isAuthorized(headers), true);
  });

  it("should accept valid Worker secret", () => {
    const headers = { "x-worker-secret": WORKER_SECRET };
    assert.strictEqual(isAuthorized(headers), true);
  });

  it("should reject incorrect secrets", () => {
    const headers = { authorization: "Bearer wrong" };
    assert.strictEqual(isAuthorized(headers), false);
  });

  it("should reject short secrets (under 16 chars) even if matching", () => {
    // This is a security guard: secrets must be long enough to be secure.
    const SHORT_SECRET = "short";
    const headers = { authorization: `Bearer ${SHORT_SECRET}` };

    function isAuthorizedShort(headers: Record<string, string>): boolean {
      const cronSecret = SHORT_SECRET;
      const authHeader = headers["authorization"] ?? "";
      return Boolean(cronSecret && cronSecret.length >= 16 && authHeader === `Bearer ${cronSecret}`);
    }

    assert.strictEqual(isAuthorizedShort(headers), false);
  });
});
