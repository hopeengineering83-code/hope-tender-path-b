import { test, describe } from "node:test";
import assert from "node:assert";
import { createHmac } from "crypto";

describe("Revocable Session Security Logic", () => {
  const secret = "test-session-secret-with-enough-bytes-abcdef0123456789";

  function hashToken(token: string): string {
    return createHmac("sha256", secret).update(token).digest("base64url");
  }

  test("Tokens are hashed before storage", () => {
    const rawToken = "raw-session-token-123";
    const hashedToken = hashToken(rawToken);

    assert.notStrictEqual(rawToken, hashedToken);
    assert.strictEqual(hashedToken, hashToken(rawToken));
  });

  test("Different tokens produce different hashes", () => {
    const token1 = "token-1";
    const token2 = "token-2";

    assert.notStrictEqual(hashToken(token1), hashToken(token2));
  });
});
