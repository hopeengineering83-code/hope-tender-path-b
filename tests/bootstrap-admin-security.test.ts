// Tests for the bootstrap-admin password policy (Gap 2).
//
// The policy is loaded from env at the time of resolveBootstrapAdminPolicy()
// so we mutate process.env between cases. NODE_ENV is restored in afterEach.

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";

import {
  resolveBootstrapAdminPolicy,
  validateProductionBootstrapPassword,
  isRuntimeBootstrapAdminAllowed,
  BANNED_PASSWORDS,
  MIN_PRODUCTION_PASSWORD_LENGTH,
  _resetBootstrapAdminWarning,
} from "../lib/bootstrap-admin-policy";

// Snapshot + restore process.env keys we mutate.
const ENV_KEYS = [
  "NODE_ENV",
  "BOOTSTRAP_ADMIN_ENABLED",
  "BOOTSTRAP_ADMIN_PASSWORD",
  "ADMIN_PASSWORD",
] as const;

type EnvSnapshot = Record<(typeof ENV_KEYS)[number], string | undefined>;

function snapshotEnv(): EnvSnapshot {
  return ENV_KEYS.reduce<EnvSnapshot>((acc, key) => {
    acc[key] = process.env[key];
    return acc;
  }, {} as EnvSnapshot);
}

function restoreEnv(snap: EnvSnapshot): void {
  const mutableEnv = process.env as Record<string, string | undefined>;
  for (const key of ENV_KEYS) {
    if (snap[key] === undefined) delete mutableEnv[key];
    else mutableEnv[key] = snap[key];
  }
}

describe("validateProductionBootstrapPassword", () => {
  it("rejects undefined and empty", () => {
    assert.match(validateProductionBootstrapPassword(undefined) ?? "", /required/i);
    assert.match(validateProductionBootstrapPassword("") ?? "", /required/i);
  });

  it("rejects passwords shorter than 16 chars", () => {
    assert.match(validateProductionBootstrapPassword("short-pw") ?? "", /at least/i);
    assert.equal(validateProductionBootstrapPassword("x".repeat(MIN_PRODUCTION_PASSWORD_LENGTH - 1))?.includes("at least"), true);
  });

  it("rejects banned defaults", () => {
    for (const banned of BANNED_PASSWORDS) {
      // Even if the banned default is long enough, it's still rejected.
      const padded = banned.padEnd(MIN_PRODUCTION_PASSWORD_LENGTH, "x");
      // The banned check is on exact value, so only exact bans should fail.
      assert.equal(
        validateProductionBootstrapPassword(banned)?.includes("banned"),
        true,
        `should reject banned "${banned}"`,
      );
      // The padded variant is permissible because banned is an exact set.
      // (We only assert this when the padded variant is actually long enough.)
      if (padded.length >= MIN_PRODUCTION_PASSWORD_LENGTH && !BANNED_PASSWORDS.includes(padded)) {
        assert.equal(validateProductionBootstrapPassword(padded), null);
      }
    }
  });

  it("accepts a strong unique password", () => {
    assert.equal(validateProductionBootstrapPassword("Tr0ub4dor&3-correct-horse"), null);
  });
});

describe("resolveBootstrapAdminPolicy — production path", () => {
  let snap: EnvSnapshot;
  beforeEach(() => {
    snap = snapshotEnv();
    _resetBootstrapAdminWarning();
  });
  afterEach(() => restoreEnv(snap));

  it("refuses to repair without BOOTSTRAP_ADMIN_ENABLED=true", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    delete process.env.BOOTSTRAP_ADMIN_ENABLED;
    process.env.BOOTSTRAP_ADMIN_PASSWORD = "Tr0ub4dor&3-correct-horse";
    const policy = resolveBootstrapAdminPolicy();
    assert.equal(policy.allowRepair, false);
    assert.equal(policy.password, "");
    assert.match(policy.reason ?? "", /BOOTSTRAP_ADMIN_ENABLED/);
    assert.equal(isRuntimeBootstrapAdminAllowed(), false);
  });

  it("refuses to repair when BOOTSTRAP_ADMIN_PASSWORD is the legacy default", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.BOOTSTRAP_ADMIN_ENABLED = "true";
    process.env.BOOTSTRAP_ADMIN_PASSWORD = "Admin123!";
    const policy = resolveBootstrapAdminPolicy();
    assert.equal(policy.allowRepair, false);
    assert.match(policy.reason ?? "", /banned/);
  });

  it("refuses to repair when BOOTSTRAP_ADMIN_PASSWORD is too short", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.BOOTSTRAP_ADMIN_ENABLED = "true";
    process.env.BOOTSTRAP_ADMIN_PASSWORD = "short-pw";
    const policy = resolveBootstrapAdminPolicy();
    assert.equal(policy.allowRepair, false);
    assert.match(policy.reason ?? "", /at least/);
  });

  it("refuses to repair when BOOTSTRAP_ADMIN_PASSWORD is in banned list (changeme)", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.BOOTSTRAP_ADMIN_ENABLED = "true";
    process.env.BOOTSTRAP_ADMIN_PASSWORD = "changeme";
    const policy = resolveBootstrapAdminPolicy();
    assert.equal(policy.allowRepair, false);
  });

  it("permits repair when production opt-in is set with a strong password", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.BOOTSTRAP_ADMIN_ENABLED = "true";
    process.env.BOOTSTRAP_ADMIN_PASSWORD = "Tr0ub4dor&3-correct-horse";
    const policy = resolveBootstrapAdminPolicy();
    assert.equal(policy.allowRepair, true);
    assert.equal(policy.password, "Tr0ub4dor&3-correct-horse");
    assert.equal(policy.reason, null);
    assert.equal(isRuntimeBootstrapAdminAllowed(), true);
  });

  it("ignores ADMIN_PASSWORD in production unless it passes strict validation", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.BOOTSTRAP_ADMIN_ENABLED = "true";
    delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
    process.env.ADMIN_PASSWORD = "Admin123!";
    const policy = resolveBootstrapAdminPolicy();
    assert.equal(policy.allowRepair, false);
  });
});

describe("resolveBootstrapAdminPolicy — development path", () => {
  let snap: EnvSnapshot;
  beforeEach(() => {
    snap = snapshotEnv();
    _resetBootstrapAdminWarning();
  });
  afterEach(() => restoreEnv(snap));

  it("falls back to the legacy default password in development", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
    delete process.env.ADMIN_PASSWORD;
    delete process.env.BOOTSTRAP_ADMIN_ENABLED;
    const policy = resolveBootstrapAdminPolicy();
    assert.equal(policy.allowRepair, true);
    assert.equal(policy.password, "Admin123!");
  });

  it("uses BOOTSTRAP_ADMIN_PASSWORD when set in development", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    process.env.BOOTSTRAP_ADMIN_PASSWORD = "dev-only-password-xyz";
    const policy = resolveBootstrapAdminPolicy();
    assert.equal(policy.allowRepair, true);
    assert.equal(policy.password, "dev-only-password-xyz");
  });

  it("test env behaves like development for convenience", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
    delete process.env.ADMIN_PASSWORD;
    delete process.env.BOOTSTRAP_ADMIN_ENABLED;
    const policy = resolveBootstrapAdminPolicy();
    assert.equal(policy.allowRepair, true);
    assert.equal(policy.password, "Admin123!");
  });
});

describe("Production never uses the built-in Admin123! default", () => {
  let snap: EnvSnapshot;
  beforeEach(() => {
    snap = snapshotEnv();
    _resetBootstrapAdminWarning();
  });
  afterEach(() => restoreEnv(snap));

  it("when no env vars are set, production refuses repair", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    delete process.env.BOOTSTRAP_ADMIN_ENABLED;
    delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
    delete process.env.ADMIN_PASSWORD;
    const policy = resolveBootstrapAdminPolicy();
    assert.equal(policy.allowRepair, false);
    assert.equal(policy.password, "");
    assert.notEqual(policy.password, "Admin123!");
  });
});
