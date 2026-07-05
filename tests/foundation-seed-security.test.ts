import { test, describe } from "node:test";
import assert from "node:assert";

describe("Seed & Bootstrap Security Logic", () => {
  const BANNED_PASSWORDS = ["Admin123!", "admin123!", "changeme", "password", "secret"];

  function validateProductionBootstrapPassword(value: string | undefined): string | null {
    if (!value) return "required";
    if (BANNED_PASSWORDS.includes(value)) return "banned";
    if (value.length < 16) return "too-short";
    return null;
  }

  test("Rejects banned passwords in production", () => {
    assert.strictEqual(validateProductionBootstrapPassword("Admin123!"), "banned");
    assert.strictEqual(validateProductionBootstrapPassword("password"), "banned");
  });

  test("Rejects short passwords in production", () => {
    assert.strictEqual(validateProductionBootstrapPassword("short123"), "too-short");
  });

  test("Accepts long, unique passwords", () => {
    assert.strictEqual(validateProductionBootstrapPassword("this-is-a-long-and-secure-password-123"), null);
  });
});
