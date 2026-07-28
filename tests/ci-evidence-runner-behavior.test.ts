import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const runner = resolve("scripts/run-evidence-command.mjs");
const verifier = resolve("scripts/verify-ci-evidence.mjs");
const sourceSha = "a".repeat(40);

const required = [
  ["reject-install-source-mutation", "test-results/reject-install-source-mutation.log"],
  ["prisma-validate", "test-results/prisma-validate.log"],
  ["prisma-generate", "test-results/prisma-generate.log"],
  ["migrate-deploy", "test-results/migrate-deploy.log"],
  ["critical-schema", "test-results/critical-schema.log"],
  ["retroactive-init", "test-results/retroactive-init.log"],
  ["migrate-idempotency", "test-results/migrate-idempotency.log"],
  ["prisma-zero-drift", "test-results/prisma-zero-drift.log"],
  ["release-integrity", "test-results/release-integrity-audit.log"],
  ["typecheck", "test-results/typecheck.log"],
  ["lint", "test-results/lint.log"],
  ["unit-database-tests", "test-results/npm-test.log"],
  ["build", "build-results/npm-build.log"],
  ["reject-build-source-mutation", "test-results/reject-build-source-mutation.log"],
  ["playwright", "browser-results/playwright.log"],
  ["reject-test-source-mutation", "test-results/reject-test-source-mutation.log"],
] as const;

describe("CI evidence command runner", () => {
  it("records successful and failed commands with their real exit codes", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "hope-ci-evidence-runner-"));
    try {
      const ledger = resolve(directory, "ledger.ndjson");
      const successLog = resolve(directory, "success.log");
      const success = spawnSync(process.execPath, [
        runner,
        "--name", "success",
        "--log", successLog,
        "--ledger", ledger,
        "--",
        process.execPath,
        "-e",
        'console.log("recorded output")',
      ], {
        env: { ...process.env, EVIDENCE_SOURCE_SHA: sourceSha },
        encoding: "utf8",
      });
      assert.equal(success.status, 0, success.stderr);
      assert.match(readFileSync(successLog, "utf8"), /recorded output/);

      const failure = spawnSync(process.execPath, [
        runner,
        "--name", "failure",
        "--log", resolve(directory, "failure.log"),
        "--ledger", ledger,
        "--",
        process.execPath,
        "-e",
        "process.exit(7)",
      ], {
        env: { ...process.env, EVIDENCE_SOURCE_SHA: sourceSha },
        encoding: "utf8",
      });
      assert.equal(failure.status, 7);

      const spawnFailure = spawnSync(process.execPath, [
        runner,
        "--name", "spawn-failure",
        "--log", resolve(directory, "spawn-failure.log"),
        "--ledger", ledger,
        "--",
        resolve(directory, "command-does-not-exist"),
      ], {
        env: { ...process.env, EVIDENCE_SOURCE_SHA: sourceSha },
        encoding: "utf8",
      });
      assert.equal(spawnFailure.status, 1);

      const entries = readFileSync(ledger, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      assert.deepEqual(entries.map((entry) => [entry.name, entry.exitCode]), [
        ["success", 0],
        ["failure", 7],
        ["spawn-failure", 1],
      ]);
      assert.ok(entries.every((entry) => entry.sourceSha === sourceSha));
      assert.equal(entries[2].spawnError, "Error");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("CI evidence completeness verifier", () => {
  it("accepts one exact-head successful ledger entry per mandatory non-empty log and rejects omissions", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "hope-ci-evidence-verifier-"));
    try {
      mkdirSync(resolve(directory, "test-results"), { recursive: true });
      const ledgerEntries = [];
      for (const [name, log] of required) {
        mkdirSync(resolve(directory, log, ".."), { recursive: true });
        writeFileSync(resolve(directory, log), `${name} evidence\n`, "utf8");
        ledgerEntries.push({
          name,
          command: ["fixture"],
          log,
          sourceSha,
          exitCode: 0,
          spawnError: null,
        });
      }
      writeFileSync(
        resolve(directory, "test-results/command-ledger.ndjson"),
        `${ledgerEntries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
        "utf8",
      );

      const accepted = spawnSync(process.execPath, [verifier], {
        cwd: directory,
        env: { ...process.env, EVIDENCE_SOURCE_SHA: sourceSha },
        encoding: "utf8",
      });
      assert.equal(accepted.status, 0, accepted.stderr);
      assert.match(accepted.stdout, /"commandCount":16/);

      rmSync(resolve(directory, "test-results/lint.log"));
      const rejected = spawnSync(process.execPath, [verifier], {
        cwd: directory,
        env: { ...process.env, EVIDENCE_SOURCE_SHA: sourceSha },
        encoding: "utf8",
      });
      assert.notEqual(rejected.status, 0);
      assert.match(rejected.stderr, /lint\.log/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
