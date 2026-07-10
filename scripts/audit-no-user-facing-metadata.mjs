#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const baselinePath = join(root, "scripts/audit-allowlists/no-user-facing-metadata-baseline.json");
const roots = ["app", "components", "lib", "tests"];
const forbidden = [
  "Complete Metadata", "Confirm Metadata", "Repair Metadata", "extracted metadata",
  "metadata gaps", "metadata blockers", "metadata score", "metadata readiness", "Metadata",
];
const internalPathAllowlist = [
  /^lib\/product-terms\.ts$/, /^scripts\/audit-no-user-facing-metadata\.mjs$/,
  /metadata-validators/, /tender-metadata/, /metadata-field-state/, /metadata-override/,
  /^tests\/.*metadata.*\.test\.ts$/,
];
const commentAllowance = /legacy internal compatibility|internal legacy|DB field|schema field|model field|deprecated alias/i;
const userFacingHints = /return\s+NextResponse\.json|Response\.json|NextResponse\.json|json\(|<[^>]+>|title\s*:|label\s*:|message\s*:|error\s*:|button|heading|blocker|warning|description\s*:|nextAction|notes\s*:/i;

function fingerprint(file, line) {
  return createHash("sha256").update(`${file}\0${line.trim()}`).digest("hex").slice(0, 16);
}
function loadBaseline() {
  if (!existsSync(baselinePath)) return new Set();
  const parsed = JSON.parse(readFileSync(baselinePath, "utf8"));
  return new Set((parsed.allowedFindings ?? []).map((item) => item.fingerprint));
}
function listFiles() {
  return execFileSync("git", ["ls-files", ...roots], { encoding: "utf8" }).trim().split("\n").filter(Boolean)
    .filter((f) => /\.(tsx?|jsx?|mjs|cjs)$/.test(f));
}
function collectFindings() {
  const findings = [];
  for (const file of listFiles()) {
    if (internalPathAllowlist.some((re) => re.test(file))) continue;
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      const lower = line.toLowerCase();
      for (const term of forbidden) {
        if (!lower.includes(term.toLowerCase())) continue;
        const isComment = /^\s*(\/\/|\/\*|\*|#)/.test(line);
        if (isComment && commentAllowance.test(line)) continue;
        const quoted = /["'`][^"'`]*metadata[^"'`]*["'`]/i.test(line);
        if (term === "Metadata" && !quoted && !userFacingHints.test(line)) continue;
        if (term === "Metadata" && /metadata[A-Z_]|[A-Za-z_]metadata|metadata[A-Za-z_]|MetadataOverride|MetadataField/i.test(line) && !quoted) continue;
        findings.push({ file, lineNumber: index + 1, term, text: line.trim(), fingerprint: fingerprint(file, line) });
      }
    });
  }
  return findings;
}
const findings = collectFindings();
if (process.argv.includes("--update-baseline")) {
  writeFileSync(baselinePath, JSON.stringify({
    note: "Baseline for legacy internal compatibility/user-facing cleanup sequencing. Do not add entries casually; remove entries as PR #1012/#1013 and follow-up cleanup eliminate them.",
    allowedFindings: findings.map(({ file, lineNumber, term, text, fingerprint }) => ({ fingerprint, file, lineNumber, term, text })),
  }, null, 2) + "\n");
  console.log(JSON.stringify({ ok: true, updated: baselinePath, allowedFindings: findings.length }, null, 2));
  process.exit(0);
}
const baseline = loadBaseline();
const newFindings = findings.filter((finding) => !baseline.has(finding.fingerprint));
if (newFindings.length) {
  console.error("User-facing metadata language audit failed with new/unbaselined findings:\n" + newFindings.map((f) => `${f.file}:${f.lineNumber}: ${f.text}`).join("\n"));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checkedFindings: findings.length, baselinedFindings: findings.length - newFindings.length }, null, 2));
