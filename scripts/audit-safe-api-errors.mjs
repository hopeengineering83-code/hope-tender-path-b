#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "app/api"], { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter((file) => file.endsWith("route.ts"));
const responseStart = /(return\s+)?(NextResponse|Response)\.json\s*\(|jsonError\s*\(/;
const rawErrorExpression = /((err|error)\s+instanceof\s+Error\s*\?\s*(err|error)\.message\s*:\s*String\((err|error)\)|(err|error)\.message|String\((err|error)\))/;
const unsafeProperty = /^[,{]?\s*(error|message|detail|safeError)\s*:/;
const findings = [];

for (const file of files) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  let responseDepth = 0;
  let logDepth = 0;
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (/logger\.|console\./.test(trimmed)) logDepth = 8;
    const isServerLog = logDepth > 0;
    if (responseStart.test(trimmed)) responseDepth = 10;
    const inJsonResponse = responseDepth > 0;
    if (!isServerLog && inJsonResponse && rawErrorExpression.test(trimmed) && (unsafeProperty.test(trimmed) || responseStart.test(trimmed))) {
      findings.push(`${file}:${index + 1}: ${trimmed}`);
    }
    if (!isServerLog && inJsonResponse && /PrismaClient(KnownRequest)?Error|Invalid `prisma\./.test(trimmed) && unsafeProperty.test(trimmed)) {
      findings.push(`${file}:${index + 1}: ${trimmed}`);
    }
    if (responseDepth > 0) responseDepth -= 1;
    if (logDepth > 0) logDepth -= 1;
  });
}

if (findings.length > 0) {
  console.error("Unsafe API error audit failed:\n" + findings.join("\n"));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checkedRoutes: files.length }, null, 2));
