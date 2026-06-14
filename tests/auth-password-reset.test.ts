import { test, describe } from "node:test";
import assert from "node:assert";
import { createHash } from "crypto";

describe("Password Reset Security Logic", () => {
  function hashToken(token: string): string {
    return createHash("sha256").update(token).digest("base64url");
  }

  test("Reset tokens are hashed for storage", () => {
    const rawToken = "reset-token-abc-123";
    const hashedToken = hashToken(rawToken);

    assert.notStrictEqual(rawToken, hashedToken);
    assert.strictEqual(hashedToken.length > 20, true);
  });

  test("Same token produces same hash", () => {
    const token = "my-secret-reset-token";
    assert.strictEqual(hashToken(token), hashToken(token));
  });
});
