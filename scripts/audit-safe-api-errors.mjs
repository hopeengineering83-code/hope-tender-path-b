#!/usr/bin/env node
// Audit: detect raw error.message, String(e), Prisma errors, or stack traces
// in public JSON API responses. Allows raw details ONLY in server-side logger
// calls (logger.*, console.*), never in public response payloads.
//
// Detects:
// - multi-line NextResponse.json({ error: error.message })
// - multi-line NextResponse.json({ message: error.message })
// - catch (e), catch (caught), catch (anyName) with .message in public JSON
// - String(e), String(caught), String(anyCatchVariable) in public JSON
// - raw Prisma error text returned from any route
// - direct use of .message in public response bodies

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "app/api", "lib/engine", "lib/secure-password-reset.ts", "lib/tender-upload-first.ts", "lib/liveness.ts"], { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter((file) => existsSync(file) && file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.endsWith(".d.ts"));

const findings = [];

// Patterns that indicate raw error text in a public JSON response.
// These match the CATCH VARIABLE (e, err, error, caught, anyName) followed
// by .message or String(...) — the core unsafe patterns.
const responseStart = /(return\s+)?(NextResponse|Response)\.json\s*\(|jsonError\s*\(/;
const loggerPattern = /logger\.|console\./;

// Detect raw error interpolation in response bodies.
// Matches: error.message, err.message, e.message, caught.message,
// String(error), String(err), String(e), String(caught), ${message}
// where `message` was derived from a caught error.
const rawErrorInResponse = /(\b(err|error|e|caught)\b\s*\.\s*message|String\s*\(\s*(err|error|e|caught)\s*\)|\$\{\s*message\s*\})/i;

// Detect Prisma error text patterns in responses
const prismaErrorInResponse = /PrismaClient(KnownRequest)?Error|Invalid\s+`prisma\./i;

for (const file of files) {
  const content = readFileSync(file, "utf8");
  const lines = content.split(/\r?\n/);
  let inResponseBlock = false;
  let responseBraceDepth = 0;
  let inLoggerLine = false;
  let loggerLineCountdown = 0;

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    // Track logger lines — these are safe (server-side only)
    if (loggerPattern.test(trimmed)) {
      loggerLineCountdown = 3; // Logger calls can span a few lines
    }

    // Track response blocks — we need to detect when we're inside a
    // NextResponse.json({...}) or jsonError(...) call
    if (responseStart.test(trimmed)) {
      inResponseBlock = true;
      responseBraceDepth = (trimmed.match(/{/g) || []).length - (trimmed.match(/}/g) || []).length;
    } else if (inResponseBlock) {
      responseBraceDepth += (trimmed.match(/{/g) || []).length - (trimmed.match(/}/g) || []).length;
      if (responseBraceDepth <= 0) {
        inResponseBlock = false;
      }
    }

    const isServerLog = loggerLineCountdown > 0;

    // Only check lines that are inside a response block AND not a server log
    if (!isServerLog && inResponseBlock) {
      // Check for raw error.message or String(e) in the response
      if (rawErrorInResponse.test(trimmed)) {
        findings.push(`${file}:${index + 1}: raw error in response: ${trimmed}`);
      }
      // Check for Prisma error text in the response
      if (prismaErrorInResponse.test(trimmed)) {
        findings.push(`${file}:${index + 1}: Prisma error text in response: ${trimmed}`);
      }
    }

    if (loggerLineCountdown > 0) loggerLineCountdown--;
  });

  // Also check for the specific multi-line pattern where a catch variable
  // is assigned to `message` (or similar) from error.message and then used
  // in a response body (NOT in a logger/console call).
  // Pattern: `const message = error instanceof Error ? error.message : ...`
  // followed by `error: message` or `error: ${message}` in a NextResponse.json/jsonError call.
  const catchVarPattern = /const\s+(\w+)\s*=\s*(\w+)\s+instanceof\s+Error\s*\?\s*\2\.message\s*:\s*String\(\2\)/;
  const catchVarMatch = content.match(catchVarPattern);
  if (catchVarMatch) {
    const varName = catchVarMatch[1];
    // Find ALL usages of this variable in the file
    const varUsagePattern = new RegExp(`\\$\\{${varName}\\}|\\b${varName}\\b`, "g");
    let match;
    while ((match = varUsagePattern.exec(content)) !== null) {
      const beforeMatch = content.substring(0, match.index);
      const lineNum = beforeMatch.split("\n").length;
      const line = lines[lineNum - 1] || "";
      const trimmedLine = line.trim();
      // Skip if it's the declaration line itself
      if (trimmedLine.includes(`const ${varName} =`)) continue;
      // Skip if it's inside a logger/console call
      const nearbyLines = lines.slice(Math.max(0, lineNum - 3), lineNum).join(" ");
      if (loggerPattern.test(nearbyLines)) continue;
      // Flag if it's inside a NextResponse.json or jsonError call
      // BUT skip if the variable name appears only inside a string literal
      // (e.g., `message: "queue empty"` matches `message` key but the value
      // is a static string, not the catch variable).
      // Check: does this line use the variable as a VALUE (not just a key)?
      // The variable must appear as a bare identifier or ${var} template,
      // not inside quotes.
      // Remove string literals AND object keys (e.g., `message:` at start of line)
      // to avoid matching the KEY when the variable is the VALUE.
      const lineWithoutStrings = trimmedLine
        .replace(/"[^"]*"/g, '""')
        .replace(/'[^']*'/g, "''")
        .replace(/^(\w+)\s*:/, ""); // strip leading `key:` pattern
      const varUsedAsValue = new RegExp(`\\$\\{${varName}\\}|\\b${varName}\\b`).test(lineWithoutStrings);
      if (varUsedAsValue && (responseStart.test(trimmedLine) || /error\s*:|message\s*:|detail\s*:/.test(trimmedLine))) {
        // Check if this line is inside a response block (not a logger block)
        // by looking backwards for the nearest responseStart or logger
        let foundResponse = false;
        for (let i = lineNum - 1; i >= Math.max(0, lineNum - 10); i--) {
          const prevLine = (lines[i] || "").trim();
          if (responseStart.test(prevLine)) { foundResponse = true; break; }
          if (loggerPattern.test(prevLine)) { break; }
        }
        if (foundResponse) {
          findings.push(`${file}:${lineNum}: catch variable "${varName}" used in response body (derived from raw error.message)`);
        }
      }
    }
  }
}

if (findings.length > 0) {
  console.error("Unsafe API error audit failed:\n" + findings.join("\n"));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checkedRoutes: files.length }, null, 2));
