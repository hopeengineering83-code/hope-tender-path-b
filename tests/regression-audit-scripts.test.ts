import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

function run(command: string[]): string {
  return execFileSync(command[0], command.slice(1), { encoding: "utf8" });
}

test("metadata-language audit passes only against its explicit legacy baseline", () => {
  const output = JSON.parse(run(["node", "scripts/audit-no-user-facing-metadata.mjs"]));
  assert.equal(output.ok, true);
  assert.equal(typeof output.checkedFindings, "number");
  assert.equal(typeof output.baselinedFindings, "number");
  const baseline = readFileSync("scripts/audit-allowlists/no-user-facing-metadata-baseline.json", "utf8");
  assert.match(baseline, /Do not add entries casually/);
  assert.match(baseline, /PR #1012\/#1013/);
});

test("safe API error audit catches raw response risks through an explicit baseline", () => {
  const output = JSON.parse(run(["node", "scripts/audit-safe-api-errors.mjs"]));
  assert.equal(output.ok, true);
  assert.equal(typeof output.checkedRoutes, "number");
  assert.equal(typeof output.baselinedFindings, "number");
  const script = readFileSync("scripts/audit-safe-api-errors.mjs", "utf8");
  assert.match(script, /responseDepth/);
  assert.match(script, /err\|error/);
});

test("workflow-state audit remains warning-only and reports actionable files", () => {
  const output = JSON.parse(run(["node", "scripts/audit-workflow-state-consistency.mjs"]));
  assert.equal(output.ok, true);
  assert.equal(output.mode, "warning-only");
  assert.equal(Array.isArray(output.warnings), true);
});
