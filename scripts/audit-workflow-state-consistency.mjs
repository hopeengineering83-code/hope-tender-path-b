#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
const roots = ["app", "components", "lib"];
const files = execFileSync("git", ["ls-files", ...roots], { encoding: "utf8" }).trim().split("\n").filter((f) => /\.(ts|tsx)$/.test(f));
const canonicalHints = /final-submission-readiness|export-readiness|generation-readiness-gate|tender-operation-gate|runtime-readiness|canonical/i;
const phrases = [/All pre-generation gates pass/i, /generation ready/i, /export ready/i, /blocked/i];
const warnings = [];
for (const file of files) {
  // `git ls-files` includes paths deleted in the current worktree until they
  // are committed. Ignore those paths so the audit can validate intentional
  // dead-code removal before the commit is created.
  if (!existsSync(file)) continue;
  const source = readFileSync(file, "utf8");
  if (canonicalHints.test(source)) continue;
  const hits = phrases.filter((re) => re.test(source));
  if (hits.length >= 2 && /(ready|blocked|blockers|warnings|status|severity)\s*[=:]/i.test(source)) {
    warnings.push(`${file}: readiness wording appears independent (${hits.map(String).join(", ")})`);
  }
}
console.log(JSON.stringify({ ok: true, mode: "warning-only", warnings }, null, 2));
