#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const roots = ["app", "components", "lib", "tests"];
const forbidden = [
  /\bComplete Metadata\b/i,
  /\bConfirm Metadata\b/i,
  /\bRepair Metadata\b/i,
  /\bextracted metadata\b/i,
  /\bmetadata gaps\b/i,
  /\bmetadata blockers\b/i,
  /\bmetadata score\b/i,
  /\bmetadata readiness\b/i,
  /\bMetadata\b/,
];
const internalPathAllowlist = [
  /^lib\/product-terms\.ts$/,
  /^scripts\/audit-no-user-facing-metadata\.mjs$/,
  /^scripts\/audit-allowlists\//,
  /metadata-validators/,
  /tender-metadata/,
  /metadata-field-state/,
  /metadata-override/,
  /^tests\//,
];
const legacyCommentAllowance = /legacy internal compatibility|internal legacy|DB field|schema field|model field|deprecated alias|baseline|audit/i;
const publicContext = /(<[^>]+>|>[^<]*metadata[^<]*<|\b(title|label|message|error|description|heading|button|nextAction|primary|reason|blocker|warning|notes|step)\s*:|NextResponse\.json|Response\.json|return\s*\{|throw new Error)/i;
const stringWithMetadata = /["'`][^"'`]*(metadata|Metadata)[^"'`]*["'`]/;
const internalIdentifierOnly = /\b(metadata[A-Z_]|[A-Za-z_]metadata|MetadataOverride|MetadataField|metadataOverrides|metadataContaminated|metadataCompletenessRatio|metadataPlaceholderCount|metadataInvalidCount)\b/;

const files = execFileSync("git", ["ls-files", ...roots], { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean)
  .filter((file) => existsSync(file))
  .filter((file) => /\.(tsx?|jsx?|mjs|cjs)$/.test(file));

const findings = [];
for (const file of files) {
  if (internalPathAllowlist.some((re) => re.test(file))) continue;
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!/metadata|Metadata/.test(line)) return;
    const trimmed = line.trim();
    const isComment = /^\/\/|^\/\*|^\*/.test(trimmed);
    if (isComment && legacyCommentAllowance.test(trimmed)) return;
    if (internalIdentifierOnly.test(trimmed) && !stringWithMetadata.test(trimmed)) return;
    if (!publicContext.test(trimmed) && !stringWithMetadata.test(trimmed)) return;
    for (const term of forbidden) {
      if (term.test(trimmed)) findings.push(`${file}:${index + 1}: ${trimmed}`);
    }
  });
}

if (findings.length > 0) {
  console.error("User-facing metadata language audit failed:\n" + Array.from(new Set(findings)).join("\n"));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checkedFiles: files.length }, null, 2));
