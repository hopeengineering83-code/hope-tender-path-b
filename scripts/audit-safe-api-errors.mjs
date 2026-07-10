#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const baselinePath = join(root, "scripts/audit-allowlists/safe-api-errors-baseline.json");
const files = execFileSync("git", ["ls-files", "app/api"], { encoding: "utf8" }).trim().split("\n").filter((f) => f.endsWith("route.ts"));
const rawValue = /((err|error)\s+instanceof\s+Error\s*\?\s*(err|error)\.message\s*:\s*String\((err|error)\)|(err|error)\.message|String\((err|error)\))/;
const responseStart = /(return\s+)?(NextResponse|Response)\.json\s*\(|jsonError\s*\(/;
function fingerprint(file, line) {
  return createHash("sha256").update(`${file}\0${line.trim()}`).digest("hex").slice(0, 16);
}
function loadBaseline() {
  if (!existsSync(baselinePath)) return new Set();
  const parsed = JSON.parse(readFileSync(baselinePath, "utf8"));
  return new Set((parsed.allowedFindings ?? []).map((item) => item.fingerprint));
}
function collectFindings() {
  const findings = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    let responseDepth = 0;
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (/logger\.|console\./.test(trimmed)) return;
      if (responseStart.test(trimmed)) responseDepth = 8;
      const inResponse = responseDepth > 0;
      const rawProperty = /\b(error|message|detail|safeError)\s*:\s*/.test(trimmed) && rawValue.test(trimmed);
      const directRawResponse = responseStart.test(trimmed) && rawValue.test(trimmed);
      if (inResponse && (rawProperty || directRawResponse)) {
        findings.push({ file, lineNumber: index + 1, text: trimmed, fingerprint: fingerprint(file, line) });
      }
      if (responseDepth > 0) responseDepth -= 1;
    });
  }
  return findings;
}
const findings = collectFindings();
if (process.argv.includes("--update-baseline")) {
  writeFileSync(baselinePath, JSON.stringify({
    note: "Baseline for pre-existing raw API error response risks in active PR overlap areas. Do not add entries casually; remove entries as routes are sanitized.",
    allowedFindings: findings.map(({ file, lineNumber, text, fingerprint }) => ({ fingerprint, file, lineNumber, text })),
  }, null, 2) + "\n");
  console.log(JSON.stringify({ ok: true, updated: baselinePath, allowedFindings: findings.length }, null, 2));
  process.exit(0);
}
const baseline = loadBaseline();
const newFindings = findings.filter((finding) => !baseline.has(finding.fingerprint));
if (newFindings.length) {
  console.error("Unsafe API error audit failed with new/unbaselined findings:\n" + newFindings.map((f) => `${f.file}:${f.lineNumber}: ${f.text}`).join("\n"));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checkedRoutes: files.length, baselinedFindings: findings.length - newFindings.length }, null, 2));
