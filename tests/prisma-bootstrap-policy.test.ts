// Tests for the runtime DB schema bootstrap policy (Gap 6).
//
// The lib/prisma.ts bootstrap() function used to unconditionally run
// CREATE TABLE / ALTER TABLE / CREATE INDEX on every cold start and
// seed admin@hope.local with a built-in password. In production this
// is unsafe — schema is owned by `prisma migrate deploy`, and admin
// seeding leaks a known credential.
//
// We pin the policy by source-inspection rather than executing the
// bootstrap (which requires a real Postgres instance):
//   - ENABLE_RUNTIME_SCHEMA_BOOTSTRAP gates the entire bootstrap in production
//   - admin seed is gated by resolveRuntimeBootstrapAdminPolicy()
//   - verifyConnectivity + verifySchemaPresent run when bootstrap is skipped

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

describe("Gap 6 — lib/prisma.ts runtime schema bootstrap policy", () => {
  it("declares an ENABLE_RUNTIME_SCHEMA_BOOTSTRAP flag", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(new URL("../lib/prisma.ts", import.meta.url), "utf8");
    assert.match(src, /ENABLE_RUNTIME_SCHEMA_BOOTSTRAP/);
  });

  it("guards the bootstrap function with isRuntimeSchemaBootstrapEnabled()", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(new URL("../lib/prisma.ts", import.meta.url), "utf8");
    assert.match(src, /function isRuntimeSchemaBootstrapEnabled/);
    assert.match(src, /isRuntimeSchemaBootstrapEnabled\(\)/);
  });

  it("verifies connectivity + schema presence when bootstrap is skipped", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(new URL("../lib/prisma.ts", import.meta.url), "utf8");
    assert.match(src, /verifyConnectivity/);
    assert.match(src, /verifySchemaPresent/);
    assert.match(src, /information_schema\.tables/);
  });

  it("never seeds admin@hope.local without policy permission", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(new URL("../lib/prisma.ts", import.meta.url), "utf8");
    assert.match(src, /resolveRuntimeBootstrapAdminPolicy/);
    // No literal Admin123! used as a real password — comments referencing
    // the historical default are fine, but the bcrypt.hash() call must not
    // receive that literal.
    assert.equal(
      /bcrypt\.hash\([^)]*Admin123!/m.test(src),
      false,
      "lib/prisma.ts must not pass Admin123! to bcrypt.hash()",
    );
    // The runtime seed must read the password from the policy resolver.
    assert.match(src, /bcrypt\.hash\(policy\.password/);
  });

  it("development still runs the bootstrap (so npm run dev works first-time)", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(new URL("../lib/prisma.ts", import.meta.url), "utf8");
    // Asked of the function, not of its source text: the policy was narrowed
    // so non-production bootstraps only a LOCAL database (see
    // tests/runtime-bootstrap-never-touches-a-remote-database.test.ts), and a
    // regex over the old one-liner could not tell that from a regression.
    const { isRuntimeSchemaBootstrapEnabled } = await import("../lib/prisma");
    const env = process.env as Record<string, string | undefined>;
    const snap = { NODE_ENV: env.NODE_ENV, DATABASE_URL: env.DATABASE_URL, FLAG: env.ENABLE_RUNTIME_SCHEMA_BOOTSTRAP };
    try {
      env.NODE_ENV = "development";
      delete env.ENABLE_RUNTIME_SCHEMA_BOOTSTRAP;
      env.DATABASE_URL = "postgresql://dev:dev@127.0.0.1:5432/dev";
      assert.equal(isRuntimeSchemaBootstrapEnabled(), true);
    } finally {
      for (const [k, v] of [["NODE_ENV", snap.NODE_ENV], ["DATABASE_URL", snap.DATABASE_URL], ["ENABLE_RUNTIME_SCHEMA_BOOTSTRAP", snap.FLAG]] as const) {
        if (v === undefined) delete env[k]; else env[k] = v;
      }
    }
  });
});

describe("Gap 6 — production never seeds default admin via runtime bootstrap", () => {
  it("isRuntimeBootstrapAdminAllowed() is false in production with no opt-in", async () => {
    const { isRuntimeBootstrapAdminAllowed, _resetBootstrapAdminWarning } = await import(
      "../lib/bootstrap-admin-policy"
    );
    const snapNodeEnv = process.env.NODE_ENV;
    const snapEnabled = process.env.BOOTSTRAP_ADMIN_ENABLED;
    const snapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
    const mutableEnv = process.env as Record<string, string | undefined>;
    try {
      mutableEnv.NODE_ENV = "production";
      delete mutableEnv.BOOTSTRAP_ADMIN_ENABLED;
      delete mutableEnv.BOOTSTRAP_ADMIN_PASSWORD;
      _resetBootstrapAdminWarning();
      assert.equal(isRuntimeBootstrapAdminAllowed(), false);
    } finally {
      if (snapNodeEnv === undefined) delete mutableEnv.NODE_ENV;
      else mutableEnv.NODE_ENV = snapNodeEnv;
      if (snapEnabled === undefined) delete mutableEnv.BOOTSTRAP_ADMIN_ENABLED;
      else mutableEnv.BOOTSTRAP_ADMIN_ENABLED = snapEnabled;
      if (snapPassword === undefined) delete mutableEnv.BOOTSTRAP_ADMIN_PASSWORD;
      else mutableEnv.BOOTSTRAP_ADMIN_PASSWORD = snapPassword;
    }
  });

  it("explicit opt-in allows bootstrap in production with strong password", async () => {
    const { isRuntimeBootstrapAdminAllowed, _resetBootstrapAdminWarning } = await import(
      "../lib/bootstrap-admin-policy"
    );
    const snapNodeEnv = process.env.NODE_ENV;
    const snapEnabled = process.env.BOOTSTRAP_ADMIN_ENABLED;
    const snapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
    const mutableEnv = process.env as Record<string, string | undefined>;
    try {
      mutableEnv.NODE_ENV = "production";
      mutableEnv.BOOTSTRAP_ADMIN_ENABLED = "true";
      mutableEnv.BOOTSTRAP_ADMIN_PASSWORD = "Tr0ub4dor&3-correct-horse";
      _resetBootstrapAdminWarning();
      assert.equal(isRuntimeBootstrapAdminAllowed(), true);
    } finally {
      if (snapNodeEnv === undefined) delete mutableEnv.NODE_ENV;
      else mutableEnv.NODE_ENV = snapNodeEnv;
      if (snapEnabled === undefined) delete mutableEnv.BOOTSTRAP_ADMIN_ENABLED;
      else mutableEnv.BOOTSTRAP_ADMIN_ENABLED = snapEnabled;
      if (snapPassword === undefined) delete mutableEnv.BOOTSTRAP_ADMIN_PASSWORD;
      else mutableEnv.BOOTSTRAP_ADMIN_PASSWORD = snapPassword;
    }
  });
});
