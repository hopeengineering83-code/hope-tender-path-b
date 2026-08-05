// Unit tests for the fail-closed production-DB guard (audit requirement #5).
//
// These tests verify that lib/test-db-guard.mjs correctly:
//   - Rejects any DATABASE_URL containing "neon.tech" (the production Neon hostname).
//   - Rejects DATABASE_URLs whose database name matches production-designated patterns.
//   - Allows loopback / private / CI service-container hostnames.
//   - Allows the CI service-container URL postgresql://hope_ci@127.0.0.1:5432/hope_tender_ci.
//   - No-ops when DATABASE_URL is unset.
//   - When RUN_DB_INTEGRATION=true, additionally rejects any non-private host.
//
// These tests run in the unit-test phase (no database required). The guard
// module is imported directly — no Prisma, no env mutation.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  detectProductionDatabaseViolation,
  isExplicitlyAllowedTestHost,
  enforceTestDatabaseGuard,
} from "../lib/test-db-guard.mjs";

describe("test-db-guard — detectProductionDatabaseViolation", () => {
  it("returns null for an unset DATABASE_URL", () => {
    assert.equal(detectProductionDatabaseViolation(undefined), null);
    assert.equal(detectProductionDatabaseViolation(""), null);
  });

  it("returns null for the CI service-container URL (loopback)", () => {
    assert.equal(
      detectProductionDatabaseViolation("postgresql://hope_ci@127.0.0.1:5432/hope_tender_ci?schema=public"),
      null,
    );
  });

  it("returns null for localhost with a non-production database name", () => {
    assert.equal(
      detectProductionDatabaseViolation("postgresql://test:test@localhost:5432/test"),
      null,
    );
  });

  it("returns null for the GitHub Actions service-container hostname 'postgres'", () => {
    assert.equal(
      detectProductionDatabaseViolation("postgresql://hope_ci:hope_ci@postgres:5432/hope_tender_ci"),
      null,
    );
  });

  it("rejects any DATABASE_URL with hostname matching neon.tech", () => {
    const cases = [
      "postgresql://user:pass@ep-cool-name-12345.us-east-2.aws.neon.tech/hope_tender_path_b",
      "postgresql://user:pass@ep-cool-name-12345-pooler.us-east-2.aws.neon.tech/hope_tender_path_b",
      "postgresql://user:pass@hope-tender-path-b.neon.tech/main",
      "postgresql://user:pass@neon.tech/db",
    ];
    for (const url of cases) {
      const v = detectProductionDatabaseViolation(url);
      assert.ok(v, `Expected violation for ${url}`);
      assert.match(v.reason, /production Neon pattern/);
    }
  });

  it("rejects any DATABASE_URL with a production-designated database name", () => {
    const cases = [
      "postgresql://user:pass@127.0.0.1:5432/prod",
      "postgresql://user:pass@127.0.0.1:5432/production",
      "postgresql://user:pass@127.0.0.1:5432/prod_tender",
      "postgresql://user:pass@127.0.0.1:5432/tender_prod",
      "postgresql://user:pass@127.0.0.1:5432/hope_production",
      "postgresql://user:pass@127.0.0.1:5432/main_tender",
      "postgresql://user:pass@127.0.0.1:5432/vercel_prod",
    ];
    for (const url of cases) {
      const v = detectProductionDatabaseViolation(url);
      assert.ok(v, `Expected violation for ${url}`);
      assert.match(v.reason, /production-designated pattern/);
    }
  });

  it("does NOT reject 'hope_tender_ci' as a database name (CI fixture)", () => {
    assert.equal(
      detectProductionDatabaseViolation("postgresql://hope_ci@127.0.0.1:5432/hope_tender_ci?schema=public"),
      null,
    );
  });

  it("does NOT reject 'test' as a database name (unit-test placeholder)", () => {
    assert.equal(
      detectProductionDatabaseViolation("postgresql://test:test@localhost:5432/test"),
      null,
    );
  });

  it("returns null for a malformed DATABASE_URL (env-check.ts handles malformed)", () => {
    assert.equal(detectProductionDatabaseViolation("not-a-url"), null);
    assert.equal(detectProductionDatabaseViolation("postgresql://"), null);
  });
});

describe("test-db-guard — isExplicitlyAllowedTestHost", () => {
  const prevAllow = process.env.TEST_DB_ALLOW_HOST;

  before(() => {
    delete process.env.TEST_DB_ALLOW_HOST;
  });

  after(() => {
    if (prevAllow !== undefined) process.env.TEST_DB_ALLOW_HOST = prevAllow;
    else delete process.env.TEST_DB_ALLOW_HOST;
  });

  it("allows loopback and CI service hostnames by default", () => {
    assert.equal(isExplicitlyAllowedTestHost("127.0.0.1"), true);
    assert.equal(isExplicitlyAllowedTestHost("localhost"), true);
    assert.equal(isExplicitlyAllowedTestHost("postgres"), true);
    assert.equal(isExplicitlyAllowedTestHost("db"), true);
    assert.equal(isExplicitlyAllowedTestHost("::1"), true);
  });

  it("rejects any other hostname by default", () => {
    assert.equal(isExplicitlyAllowedTestHost("staging.example.com"), false);
    assert.equal(isExplicitlyAllowedTestHost("10.0.0.5"), false);
    assert.equal(isExplicitlyAllowedTestHost("192.168.1.1"), false);
  });

  it("allows an opted-in hostname via TEST_DB_ALLOW_HOST (comma-separated)", () => {
    process.env.TEST_DB_ALLOW_HOST = "staging.example.com, 10.0.0.5";
    assert.equal(isExplicitlyAllowedTestHost("staging.example.com"), true);
    assert.equal(isExplicitlyAllowedTestHost("10.0.0.5"), true);
    assert.equal(isExplicitlyAllowedTestHost("other.example.com"), false);
  });

  it("is case-insensitive for opted-in hostnames", () => {
    process.env.TEST_DB_ALLOW_HOST = "Staging.Example.COM";
    assert.equal(isExplicitlyAllowedTestHost("staging.example.com"), true);
  });
});

describe("test-db-guard — enforceTestDatabaseGuard (fail-closed behavior)", () => {
  const prevRunDb = process.env.RUN_DB_INTEGRATION;
  const prevAllow = process.env.TEST_DB_ALLOW_HOST;

  before(() => {
    delete process.env.RUN_DB_INTEGRATION;
    delete process.env.TEST_DB_ALLOW_HOST;
  });

  after(() => {
    if (prevRunDb !== undefined) process.env.RUN_DB_INTEGRATION = prevRunDb;
    else delete process.env.RUN_DB_INTEGRATION;
    if (prevAllow !== undefined) process.env.TEST_DB_ALLOW_HOST = prevAllow;
    else delete process.env.TEST_DB_ALLOW_HOST;
  });

  it("no-ops when DATABASE_URL is unset", () => {
    assert.doesNotThrow(() => enforceTestDatabaseGuard(undefined));
    assert.doesNotThrow(() => enforceTestDatabaseGuard(""));
  });

  it("allows the CI service-container URL with RUN_DB_INTEGRATION=true", () => {
    process.env.RUN_DB_INTEGRATION = "true";
    assert.doesNotThrow(() =>
      enforceTestDatabaseGuard("postgresql://hope_ci@127.0.0.1:5432/hope_tender_ci?schema=public"),
    );
    delete process.env.RUN_DB_INTEGRATION;
  });

  it("throws when DATABASE_URL points at a Neon hostname (even without RUN_DB_INTEGRATION)", () => {
    // Unit-test mode — guard still blocks Neon hostnames unconditionally.
    assert.throws(
      () => enforceTestDatabaseGuard("postgresql://user:pass@ep-cool-name-12345.us-east-2.aws.neon.tech/hope_tender_path_b"),
      /FAIL-CLOSED: refusing to run tests against a production-designated database/,
    );
  });

  it("throws when DATABASE_URL has a production-designated database name", () => {
    assert.throws(
      () => enforceTestDatabaseGuard("postgresql://user:pass@127.0.0.1:5432/prod_tender"),
      /production-designated database/,
    );
  });

  it("throws when RUN_DB_INTEGRATION=true and hostname is not allow-listed (even if not Neon)", () => {
    process.env.RUN_DB_INTEGRATION = "true";
    try {
      assert.throws(
        () => enforceTestDatabaseGuard("postgresql://user:pass@staging.example.com:5432/hope_tender_staging"),
        /RUN_DB_INTEGRATION=true requires DATABASE_URL to point at a[\s\S]*private\/loopback\/CI-service host/,
      );
    } finally {
      delete process.env.RUN_DB_INTEGRATION;
    }
  });

  it("respects TEST_DB_ALLOW_HOST opt-in when RUN_DB_INTEGRATION=true", () => {
    process.env.RUN_DB_INTEGRATION = "true";
    process.env.TEST_DB_ALLOW_HOST = "staging.example.com";
    try {
      // staging.example.com is opted in, and database name doesn't match
      // production patterns — should pass.
      assert.doesNotThrow(() =>
        enforceTestDatabaseGuard("postgresql://user:pass@staging.example.com:5432/hope_tender_staging"),
      );
    } finally {
      delete process.env.RUN_DB_INTEGRATION;
      delete process.env.TEST_DB_ALLOW_HOST;
    }
  });

  it("NEVER allows Neon hostname even with TEST_DB_ALLOW_HOST opt-in", () => {
    process.env.RUN_DB_INTEGRATION = "true";
    process.env.TEST_DB_ALLOW_HOST = "ep-cool-name-12345.us-east-2.aws.neon.tech";
    try {
      // The Neon-hostname check fires FIRST, before the allow-list check.
      // So even an explicit opt-in cannot bypass the Neon block.
      assert.throws(
        () => enforceTestDatabaseGuard("postgresql://user:pass@ep-cool-name-12345.us-east-2.aws.neon.tech/hope_tender_path_b"),
        /production Neon pattern/,
      );
    } finally {
      delete process.env.RUN_DB_INTEGRATION;
      delete process.env.TEST_DB_ALLOW_HOST;
    }
  });

  it("redacts the password in the error message", () => {
    try {
      enforceTestDatabaseGuard("postgresql://user:super-secret-pass@ep-cool-name-12345.us-east-2.aws.neon.tech/db");
      assert.fail("Expected throw");
    } catch (err) {
      const msg = (err as Error).message;
      assert.ok(!msg.includes("super-secret-pass"), `Password leaked in error: ${msg}`);
      assert.ok(msg.includes(":***@"), `Password not redacted: ${msg}`);
    }
  });
});
