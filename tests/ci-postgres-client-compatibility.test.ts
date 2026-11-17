// CI regression: the backup/restore rehearsal restores a `pg_dump` made with the runner's PostgreSQL
// client into the postgres:16 service. Ubuntu 26.04 (ubuntu-latest from Nov 2026) ships pg_dump 17+,
// which always writes `SET transaction_timeout`; PostgreSQL 16 rejects it and all three rehearsal
// tests were cancelled. The integration job therefore pins a runner with the PostgreSQL 16 client and
// checks the tools before the tests run. This file keeps that pairing from silently drifting again.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const job = workflow.slice(workflow.indexOf("  verify:"));

describe("CI PostgreSQL client and service stay on the same major version", () => {
  it("runs the database job on a pinned runner, not ubuntu-latest", () => {
    const runner = /\n    runs-on:\s*(\S+)/.exec(job)?.[1];
    assert.equal(runner, "ubuntu-24.04", "the integration job must stay on a runner with the PostgreSQL 16 client");
    assert.match(job, /image:\s*postgres:16\b/, "the service stays postgres:16 (Neon-isolation contract)");
  });

  it("checks pg_dump, psql, createdb and dropdb are version 16 before the tests", () => {
    const guard = job.indexOf("- name: Require PostgreSQL 16 client tools");
    const tests = job.indexOf("- name: Unit and database integration tests");
    assert.ok(guard > 0 && tests > guard, "the client-version guard runs before the database tests");
    const step = job.slice(guard, tests);
    for (const tool of ["pg_dump", "psql", "createdb", "dropdb"]) assert.match(step, new RegExp(`\\b${tool}\\b`));
    assert.match(step, /\*" 16\."\*/);
    assert.match(step, /exit 1/, "a mismatch fails the job instead of cancelling the rehearsal later");
  });

  it("does not skip or soften the backup/restore rehearsal", () => {
    const rehearsal = readFileSync("tests/backup-restore-rehearsal-executed.test.ts", "utf8");
    assert.match(rehearsal, /ON_ERROR_STOP=1/, "restores still stop on the first SQL error");
    assert.doesNotMatch(rehearsal, /transaction_timeout/, "no filtering of pg_dump output to hide a version mismatch");
  });
});
