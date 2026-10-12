import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { redactSecrets, sanitizeError } from "../lib/sanitize-error";

describe("redactSecrets", () => {
  it("redacts provider keys, bearer tokens, named API-key assignments, and connection strings", () => {
    const providerKey = ["s", "k", "-", "abcdefgh_123456"].join("");
    const googleKey = ["AI", "za", "1234567890abcdefghijklmnop"].join("");
    const bearerValue = ["header", "payload", "signature"].join(".");
    const namedKey = ["super", "secret", "value"].join("-");
    const alternateKey = ["another", "secret"].join("-");
    const databaseCredential = ["user", "password"].join(":");
    const cacheCredential = ["default", "password"].join(":");
    const databaseUrl = ["post", "gresql://", databaseCredential, "@db.example.test:5432/app"].join("");
    const cacheUrl = ["re", "dis://", cacheCredential, "@cache.example.test:6379"].join("");
    const input = [providerKey, googleKey, `Bearer ${bearerValue}`, `API_KEY = ${namedKey}`, `api-key: ${alternateKey}`, databaseUrl, cacheUrl].join(" | ");
    const redacted = redactSecrets(input);
    for (const sensitive of [providerKey, googleKey, bearerValue, namedKey, alternateKey, databaseCredential, cacheCredential]) {
      assert.equal(redacted.includes(sensitive), false);
    }
    assert.match(redacted, /API_KEY\s*=\s*\[KEY_REDACTED\]/i);
    assert.match(redacted, /api-key:\s*\[KEY_REDACTED\]/i);
    assert.match(redacted, /postgresql:\/\/\[redacted\]/i);
    assert.match(redacted, /redis:\/\/\[redacted\]/i);
  });

  it("leaves ordinary diagnostic text unchanged", () => {
    const message = "Provider returned timeout after 30 seconds";
    assert.equal(redactSecrets(message), message);
  });

  it("sanitizeError composes secret and database-detail redaction", () => {
    const namedKey = ["secret", "value", "123"].join("-");
    const result = sanitizeError(["PrismaClientKnownRequestError", `API_KEY=${namedKey}`, "SELECT password FROM users"].join(" "));
    assert.equal(result.includes(namedKey), false);
    assert.equal(result.includes("PrismaClientKnownRequestError"), false);
    assert.equal(result.includes("SELECT password FROM users"), false);
  });
});
