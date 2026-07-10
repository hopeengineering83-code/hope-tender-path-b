#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const roots = ["app", "components", "lib", "tests"];
const forbidden = [
  "Complete Metadata", "Confirm Metadata", "Repair Metadata", "extracted metadata",
  "metadata gaps", "metadata blockers", "metadata score", "metadata readiness", "Metadata",
];
const allowPath = [
  /^lib\/product-terms\.ts$/, /^scripts\/audit-no-user-facing-metadata\.mjs$/,
  /metadata-validators/, /tender-metadata/, /metadata-field-state/, /metadata-override/,
  /^tests\/.*metadata.*\.test\.ts$/,
];
const commentAllowance = /legacy internal compatibility|internal legacy|DB field|schema field|model field/i;
const userFacingHints = /return\s+NextResponse\.json|Response\.json|json\(|<[^>]+>|title\s*:|label\s*:|message\s*:|error\s*:|button|heading|blocker|warning|description\s*:/i;
const files = execFileSync("git", ["ls-files", ...roots], { encoding: "utf8" }).trim().split("\n").filter(Boolean)
  .filter((f) => /\.(tsx?|jsx?|mjs|cjs)$/.test(f));
const findings = [];
for (const file of files) {
  if (allowPath.some((re) => re.test(file))) continue;
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
      findings.push(`${file}:${index + 1}: ${line.trim()}`);
    }
  });
}
if (findings.length) {
  console.error("User-facing metadata language audit failed:\n" + findings.join("\n"));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checkedFiles: files.length }, null, 2));
