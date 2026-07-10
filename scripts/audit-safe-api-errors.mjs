#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const files = execFileSync("git", ["ls-files", "app/api"], { encoding: "utf8" }).trim().split("\n").filter((f) => f.endsWith("route.ts"));
const unsafe = [
  /\b(error|message)\s*:\s*(err|error)\.message\b/,
  /\b(error|message)\s*:\s*String\((err|error)\)/,
  /NextResponse\.json\([\s\S]{0,180}(err|error)\.message/,
  /jsonError\([^\n]*(err|error)\.message/,
  /PrismaClientKnownRequestError[\s\S]{0,200}NextResponse\.json/,
];
const responseContext = /NextResponse\.json|Response\.json|jsonError|return\s+json|return\s+NextResponse|error\s*:|message\s*:/;
const findings = [];
for (const file of files) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    if (/logger\.|console\./.test(line)) return;
    const directResponse = /(NextResponse\.json|Response\.json|jsonError|return\s+json)/.test(line);
    const rawPayloadProperty = /[,{]\s*(error|message)\s*:\s*((err|error)\.message|String\((err|error)\))/.test(line);
    if ((directResponse || rawPayloadProperty) && unsafe.some((re) => re.test(line))) findings.push(`${file}:${i + 1}: ${line.trim()}`);
  });
}
if (findings.length) {
  console.error("Unsafe API error audit failed:\n" + findings.join("\n"));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checkedRoutes: files.length }, null, 2));
