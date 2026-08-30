/**
 * The database fingerprint must identify a database without revealing one.
 *
 * A deployment carries the DATABASE_URL it was built with, so changing the
 * project setting leaves existing deployments on the previous database until
 * they are rebuilt — and /api/health answered "healthy" for both, identically.
 * Two deployments of the same commit sitting on different databases were
 * indistinguishable from outside, which is how stale runtime evidence gets
 * accepted as current.
 *
 * The fix must never become a leak. This endpoint is public and
 * unauthenticated, so the value it publishes has to be safe to paste anywhere.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { databaseFingerprint } from "../lib/database-fingerprint";

const SAMPLE = "postgresql://neon_owner:npg_SuperSecret123@ep-cool-rain-12345678.us-east-2.aws.neon.tech/hopedb?sslmode=require";

describe("database fingerprint", () => {
  it("contains no part of the credential", () => {
    const value = String(databaseFingerprint(SAMPLE));
    for (const secret of ["npg_SuperSecret123", "neon_owner", "ep-cool-rain-12345678", "neon.tech", "hopedb", "sslmode", "postgres"]) {
      assert.ok(
        !value.toLowerCase().includes(secret.toLowerCase()),
        `fingerprint must not contain ${secret}`,
      );
    }
    assert.match(value, /^[0-9a-f]{12}$/, "the published value is a short hex digest and nothing else");
  });

  it("is stable for the same database", () => {
    assert.equal(databaseFingerprint(SAMPLE), databaseFingerprint(SAMPLE));
  });

  it("ignores the credential, so rotating a password does not look like a new database", () => {
    // The user and password are removed before hashing. A rotated password is
    // the same database, and reporting it as a different one would send someone
    // chasing an environment change that never happened.
    const rotated = SAMPLE.replace("npg_SuperSecret123", "npg_DifferentSecret456").replace("neon_owner", "other_role");
    assert.equal(databaseFingerprint(rotated), databaseFingerprint(SAMPLE));
  });

  it("ignores query parameters", () => {
    const extra = SAMPLE.replace("?sslmode=require", "?sslmode=require&connection_limit=5&pgbouncer=true");
    assert.equal(databaseFingerprint(extra), databaseFingerprint(SAMPLE));
  });

  it("distinguishes a different host", () => {
    const other = SAMPLE.replace("ep-cool-rain-12345678", "ep-warm-sun-87654321");
    assert.notEqual(databaseFingerprint(other), databaseFingerprint(SAMPLE));
  });

  it("distinguishes a different database on the same host", () => {
    const other = SAMPLE.replace("/hopedb?", "/hopedb_staging?");
    assert.notEqual(databaseFingerprint(other), databaseFingerprint(SAMPLE));
  });

  it("reports absence as unknown rather than fingerprinting nothing", () => {
    assert.equal(databaseFingerprint(""), null);
    assert.equal(databaseFingerprint("   "), null);
  });

  it("falls back to the configured URL when given no argument", () => {
    // The argument defaults to process.env.DATABASE_URL, so passing undefined
    // asks for the configured database rather than for "no database" — which
    // is why the absence case above states its emptiness explicitly.
    const configured = process.env.DATABASE_URL;
    try {
      delete process.env.DATABASE_URL;
      assert.equal(databaseFingerprint(), null, "no configured URL reads as unknown");
      process.env.DATABASE_URL = SAMPLE;
      assert.equal(databaseFingerprint(), databaseFingerprint(SAMPLE));
    } finally {
      if (configured === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = configured;
    }
  });

  it("never hashes a value it could not parse", () => {
    // Hashing an unparseable string would put whatever it contains — a
    // credential included — through the digest of a published field.
    assert.equal(databaseFingerprint("this is not a url but might hold npg_SuperSecret123"), "unparseable");
  });

  it("is published by the public health payload", () => {
    const source = require("node:fs").readFileSync("lib/liveness.ts", "utf8");
    const publicBlock = source.slice(source.indexOf("export async function livenessResponse"));
    assert.match(publicBlock, /databaseFingerprint: databaseFingerprint\(\)/);
    // And the raw URL is never published beside it.
    assert.doesNotMatch(publicBlock, /process\.env\.DATABASE_URL/);
  });
});
