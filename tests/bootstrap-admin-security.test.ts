import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

import {
  resolveLoginRepairBootstrapPolicy,
  resolveRuntimeBootstrapAdminPolicy,
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

describe("resolveLoginRepairBootstrapPolicy", () => {
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
      const policy = resolveLoginRepairBootstrapPolicy();
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
    const policy = resolveLoginRepairBootstrapPolicy();
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

describe("the seed can actually provision the first admin", () => {
  // prisma/seed.ts called resolveLoginRepairBootstrapPolicy() — under its old,
  // ambiguous name — which refuses in every environment. The seed therefore
  // could not create an admin under ANY configuration: it always skipped, and
  // reported the refusal as a production opt-in problem even when running
  // locally with BOOTSTRAP_ADMIN_ENABLED=true and a strong password set.
  //
  // Provisioning is the seed's entire purpose, so this is the difference
  // between a documented path that works and one that silently does nothing.
  const seed = readFileSync("prisma/seed.ts", "utf8");

  it("uses the explicit opt-in policy, not the permanently-disabled login path", () => {
    assert.match(seed, /resolveRuntimeBootstrapAdminPolicy\(\)/);
    assert.doesNotMatch(
      seed,
      /resolveLoginRepairBootstrapPolicy|resolveBootstrapAdminPolicy\b/,
      "the seed must not consult the login-repair policy, which always denies",
    );
  });

  it("still requires opt-in and a strong password — the guard is not relaxed", () => {
    // The fix must not become a way to seed an admin unintentionally.
    const before = { ...process.env };
    try {
      delete process.env.BOOTSTRAP_ADMIN_ENABLED;
      delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
      assert.equal(resolveRuntimeBootstrapAdminPolicy().allowRepair, false, "no opt-in, no seed");

      process.env.BOOTSTRAP_ADMIN_ENABLED = "true";
      process.env.BOOTSTRAP_ADMIN_PASSWORD = "Admin123!";
      assert.equal(resolveRuntimeBootstrapAdminPolicy().allowRepair, false, "a banned default is still refused");

      process.env.BOOTSTRAP_ADMIN_PASSWORD = "short";
      assert.equal(resolveRuntimeBootstrapAdminPolicy().allowRepair, false, "a weak password is still refused");

      process.env.BOOTSTRAP_ADMIN_PASSWORD = "Tr0ub4dor&3-correct-horse";
      assert.equal(resolveRuntimeBootstrapAdminPolicy().allowRepair, true, "opt-in plus a strong password provisions");
    } finally {
      for (const key of ["BOOTSTRAP_ADMIN_ENABLED", "BOOTSTRAP_ADMIN_PASSWORD"]) {
        if (before[key] === undefined) delete process.env[key];
        else process.env[key] = before[key];
      }
    }
  });

  it("never touches an admin that already exists", () => {
    // What makes it safe to turn BOOTSTRAP_ADMIN_ENABLED off again after the
    // first provisioning — and what stops a re-run resetting a live password.
    assert.match(seed, /findUnique\(\{ where: \{ email \} \}\)/);
    assert.match(seed, /if \(existing\)/);
    assert.doesNotMatch(seed, /\bupsert\b|passwordHash:\s*\w+\s*\}\s*,?\s*\}\s*\)\s*;\s*\/\/\s*update/i);
  });

  it("reports the policy's own reason instead of guessing at one", () => {
    assert.match(seed, /policy\.reason/);
  });
});
