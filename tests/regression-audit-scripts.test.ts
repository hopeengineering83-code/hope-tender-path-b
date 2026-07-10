import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

function run(command: string[]): string {
  return execFileSync(command[0], command.slice(1), { encoding: "utf8" });
}

test("metadata-language audit runs without a giant committed baseline", () => {
  const output = JSON.parse(run(["node", "scripts/audit-no-user-facing-metadata.mjs"]));
  assert.equal(output.ok, true);
  assert.equal(typeof output.checkedFiles, "number");
  assert.equal(existsSync("scripts/audit-allowlists/no-user-facing-metadata-baseline.json"), false);
  const script = readFileSync("scripts/audit-no-user-facing-metadata.mjs", "utf8");
  assert.match(script, /userFacingHints|publicContext/);
  assert.match(script, /Complete Metadata/);
});

test("safe API error audit runs without a raw-error baseline", () => {
  const output = JSON.parse(run(["node", "scripts/audit-safe-api-errors.mjs"]));
  assert.equal(output.ok, true);
  assert.equal(typeof output.checkedRoutes, "number");
  assert.equal(existsSync("scripts/audit-allowlists/safe-api-errors-baseline.json"), false);
  const script = readFileSync("scripts/audit-safe-api-errors.mjs", "utf8");
  // The audit script must track response blocks to distinguish server-side
  // logger calls (safe) from public response bodies (unsafe).
  assert.match(script, /inResponseBlock|responseBlock|responseDepth/);
  // The audit script must detect raw error patterns (error.message, String(e), etc.)
  assert.match(script, /rawError|error\.message|String\s*\(/);
  // The audit script must detect Prisma error text
  assert.match(script, /prisma|Prisma/i);
});

test("workflow-state audit remains warning-only and reports actionable files", () => {
  const output = JSON.parse(run(["node", "scripts/audit-workflow-state-consistency.mjs"]));
  assert.equal(output.ok, true);
  assert.equal(output.mode, "warning-only");
  assert.equal(Array.isArray(output.warnings), true);
});
