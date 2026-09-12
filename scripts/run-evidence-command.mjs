#!/usr/bin/env node

import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream } from "node:fs";

function usage() {
  console.error(
    "Usage: node scripts/run-evidence-command.mjs --name <name> --log <path> [--ledger <path>] -- <command> [args...]",
  );
}

function option(args, flag) {
  const index = args.indexOf(flag);
  if (index < 0 || index + 1 >= args.length) return null;
  return args[index + 1];
}

const args = process.argv.slice(2);
const separator = args.indexOf("--");
const name = option(args, "--name");
const logArgument = option(args, "--log");
const ledgerArgument = option(args, "--ledger") ?? "test-results/command-ledger.ndjson";
const command = separator >= 0 ? args[separator + 1] : null;
const commandArgs = separator >= 0 ? args.slice(separator + 2) : [];

if (!name || !logArgument || !command) {
  usage();
  process.exit(2);
}

const logPath = resolve(logArgument);
const ledgerPath = resolve(ledgerArgument);
await Promise.all([
  mkdir(dirname(logPath), { recursive: true }),
  mkdir(dirname(ledgerPath), { recursive: true }),
]);

const startedAtMs = Date.now();
const startedAt = new Date(startedAtMs).toISOString();
const renderedCommand = [command, ...commandArgs].map((part) => JSON.stringify(part)).join(" ");
const log = createWriteStream(logPath, { flags: "w" });
log.write(`[evidence-command] name=${name}\n`);
log.write(`[evidence-command] startedAt=${startedAt}\n`);
log.write(`[evidence-command] command=${renderedCommand}\n\n`);

const child = spawn(command, commandArgs, {
  env: process.env,
  shell: process.platform === "win32",
  stdio: ["inherit", "pipe", "pipe"],
});

child.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  log.write(chunk);
});
child.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
  log.write(chunk);
});

let spawnError = null;
child.on("error", (error) => {
  spawnError = error;
});

const [rawExitCode, signal] = await new Promise((resolveClose) => {
  child.once("close", (...closeArgs) => resolveClose(closeArgs));
});
const exitCode = typeof rawExitCode === "number" && rawExitCode >= 0 ? rawExitCode : 1;
const endedAtMs = Date.now();
const endedAt = new Date(endedAtMs).toISOString();
log.write(
  `\n[evidence-command] endedAt=${endedAt} durationMs=${endedAtMs - startedAtMs} exitCode=${exitCode} signal=${signal ?? ""}\n`,
);
if (spawnError) {
  log.write(`[evidence-command] spawnError=${spawnError.name}\n`);
}
log.end();
await once(log, "finish");

const ledgerEntry = {
  name,
  command: [command, ...commandArgs],
  log: logArgument,
  sourceSha: process.env.EVIDENCE_SOURCE_SHA ?? process.env.GITHUB_SHA ?? null,
  runId: process.env.GITHUB_RUN_ID ?? null,
  startedAt,
  endedAt,
  durationMs: endedAtMs - startedAtMs,
  exitCode,
  signal: signal ?? null,
  spawnError: spawnError?.name ?? null,
};
await appendFile(ledgerPath, `${JSON.stringify(ledgerEntry)}\n`, "utf8");

process.exit(exitCode);
