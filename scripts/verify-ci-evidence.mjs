#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const REQUIRED_COMMANDS = [
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
];

const ledgerPath = resolve("test-results/command-ledger.ndjson");
const rawLedger = await readFile(ledgerPath, "utf8");
const entries = rawLedger
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`CI evidence ledger line ${index + 1} is not valid JSON.`);
    }
  });

const expectedSourceSha = process.env.EVIDENCE_SOURCE_SHA;
if (!expectedSourceSha) {
  throw new Error("EVIDENCE_SOURCE_SHA is required to verify exact-head evidence.");
}

for (const [name, logPath] of REQUIRED_COMMANDS) {
  const matching = entries.filter((entry) => entry?.name === name);
  if (matching.length !== 1) {
    throw new Error(`Expected exactly one CI evidence ledger entry for ${name}; found ${matching.length}.`);
  }
  const [entry] = matching;
  if (entry.exitCode !== 0 || entry.spawnError) {
    throw new Error(`CI evidence command ${name} did not complete successfully.`);
  }
  if (entry.sourceSha !== expectedSourceSha) {
    throw new Error(`CI evidence command ${name} is not bound to exact source SHA ${expectedSourceSha}.`);
  }
  if (entry.log !== logPath) {
    throw new Error(`CI evidence command ${name} points to ${entry.log}, expected ${logPath}.`);
  }
  const logStats = await stat(resolve(logPath));
  if (!logStats.isFile() || logStats.size === 0) {
    throw new Error(`Mandatory CI evidence log ${logPath} is missing or empty.`);
  }
}

console.log(JSON.stringify({
  ok: true,
  sourceSha: expectedSourceSha,
  commandCount: REQUIRED_COMMANDS.length,
  ledger: "test-results/command-ledger.ndjson",
}));
