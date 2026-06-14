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
  it("rejects missing, short, and banned passwords", () => {
    assert.match(validateProductionBootstrapPassword(undefined) ?? "", /required/i);
    assert.match(validateProductionBootstrapPassword("short-pw") ?? "", /at least/i);
    for (const banned of BANNED_PASSWORDS) {
      assert.match(validateProductionBootstrapPassword(banned) ?? "", /banned/i);
    }
  });

  it("accepts a strong unique password", () => {
    assert.equal(validateProductionBootstrapPassword("Tr0ub4dor&3-correct-horse"), null);
    assert.equal(MIN_PRODUCTION_PASSWORD_LENGTH, 16);
  });
});

describe("resolveBootstrapAdminPolicy", () => {
  let snap: EnvSnapshot;

  beforeEach(() => {
    snap = snapshotEnv();
    _resetBootstrapAdminWarning();
  });

  afterEach(() => restoreEnv(snap));

  for (const environment of ["production", "development", "test"] as const) {
    it(`never repairs bootstrap credentials during ${environment} login`, () => {
      (process.env as Record<string, string | undefined>).NODE_ENV = environment;
      process.env.BOOTSTRAP_ADMIN_ENABLED = "true";
      process.env.BOOTSTRAP_ADMIN_PASSWORD = "Tr0ub4dor&3-correct-horse";
      const policy = resolveBootstrapAdminPolicy();
      assert.equal(policy.allowRepair, false);
      assert.equal(policy.password, "");
      assert.match(policy.reason ?? "", /explicit seed|administrative process/i);
    });
  }

  it("never falls back to the legacy Admin123! password", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    delete process.env.BOOTSTRAP_ADMIN_ENABLED;
    delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
    delete process.env.ADMIN_PASSWORD;
    const policy = resolveBootstrapAdminPolicy();
    assert.equal(policy.allowRepair, false);
    assert.notEqual(policy.password, "Admin123!");
  });
});

describe("explicit bootstrap seed authorization", () => {
  let snap: EnvSnapshot;

  beforeEach(() => {
    snap = snapshotEnv();
    _resetBootstrapAdminWarning();
  });

  afterEach(() => restoreEnv(snap));

  it("requires explicit opt-in and a strong unique password", () => {
    delete process.env.BOOTSTRAP_ADMIN_ENABLED;
    process.env.BOOTSTRAP_ADMIN_PASSWORD = "Tr0ub4dor&3-correct-horse";
    assert.equal(isRuntimeBootstrapAdminAllowed(), false);

    process.env.BOOTSTRAP_ADMIN_ENABLED = "true";
    process.env.BOOTSTRAP_ADMIN_PASSWORD = "Admin123!";
    assert.equal(isRuntimeBootstrapAdminAllowed(), false);

    process.env.BOOTSTRAP_ADMIN_PASSWORD = "short-pw";
    assert.equal(isRuntimeBootstrapAdminAllowed(), false);

    process.env.BOOTSTRAP_ADMIN_PASSWORD = "Tr0ub4dor&3-correct-horse";
    assert.equal(isRuntimeBootstrapAdminAllowed(), true);
  });

  it("ignores ADMIN_PASSWORD as a bootstrap credential", () => {
    process.env.BOOTSTRAP_ADMIN_ENABLED = "true";
    delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
    process.env.ADMIN_PASSWORD = "Tr0ub4dor&3-correct-horse";
    assert.equal(isRuntimeBootstrapAdminAllowed(), false);
  });
});
