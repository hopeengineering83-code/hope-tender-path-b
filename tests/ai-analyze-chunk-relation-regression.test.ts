/**
 * Regression test: AiAnalyzeChunk must never be queried using a `tender`
 * relation filter. The model has scalar `tenderId` and `userId` fields only —
 * no Tender relation. Using `tender: { userId }` causes a Prisma runtime
 * error (P2009) that makes the generation-readiness gate fail closed with
 * GATE_INTERNAL_ERROR, blocking all generation, export, and final ZIP.
 *
 * This test scans all TypeScript source files for the invalid pattern.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function findTsFiles(dir: string, results: string[] = []): string[] {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
      findTsFiles(fullPath, results);
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      results.push(fullPath);
    }
  }
  return results;
}

describe("AiAnalyzeChunk relation query regression", () => {
  it("no source file queries AiAnalyzeChunk with a 'tender:' relation filter", () => {
    const files = [
      ...findTsFiles("lib"),
      ...findTsFiles("app"),
      ...findTsFiles("scripts"),
    ];

    const violations: string[] = [];

    for (const file of files) {
      const src = readFileSync(file, "utf8");
      // Look for aiAnalyzeChunk queries that include `tender:` as a relation filter.
      // The valid pattern uses scalar `tenderId` and `userId` directly.
      // Match: aiAnalyzeChunk.(findMany|findFirst|count|findUnique|update|delete)
      // followed within 500 chars by `tender:` (not `tenderId`)
      const patterns = [
        /aiAnalyzeChunk\.(findMany|findFirst|count|findUnique|updateMany|deleteMany)\s*\(/g,
      ];

      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(src)) !== null) {
          // Extract the next 500 chars after the match to check for `tender:`
          const after = src.slice(match.index, match.index + 500);
          // Check for `tender:` but NOT `tenderId:` (which is the correct scalar)
          if (/tender\s*:\s*\{/.test(after) && !/tenderId\s*:/.test(after.slice(0, after.indexOf("tender:")))) {
            violations.push(`${file}: invalid 'tender: { ... }' relation filter near aiAnalyzeChunk query`);
          }
        }
      }
    }

    assert.equal(
      violations.length,
      0,
      `Found ${violations.length} invalid AiAnalyzeChunk relation filter(s):\n${violations.join("\n")}\n\nAiAnalyzeChunk has scalar tenderId and userId fields only — use them directly, not a 'tender: { userId }' relation filter.`,
    );
  });

  it("generation-readiness-gate uses scalar userId for AiAnalyzeChunk (not tender relation)", () => {
    const src = readFileSync("lib/engine/generation-readiness-gate.ts", "utf8");
    // The AiAnalyzeChunk query must use scalar userId, not tender: { userId }
    assert.ok(
      src.includes("where: { tenderId, userId, contentHash: currentContentHash }"),
      "generation-readiness-gate must filter AiAnalyzeChunk by scalar tenderId + userId + contentHash",
    );
    // Note: AiJob queries in the same file DO use `tender: { userId }` which is
    // valid because AiJob has a tender relation. Only AiAnalyzeChunk must not.
    // Verify the aiAnalyzeChunk query does NOT use tender: { userId }
    const chunkQueryMatch = src.match(/aiAnalyzeChunk\.findMany\([\s\S]*?\}\s*\)/);
    if (chunkQueryMatch) {
      assert.ok(
        !/tender\s*:\s*\{/.test(chunkQueryMatch[0]),
        "AiAnalyzeChunk query must NOT use 'tender: { userId }' relation filter — use scalar userId",
      );
    }
  });

  it("AiAnalyzeChunk model has no Tender relation in Prisma schema", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    // Extract the AiAnalyzeChunk model block
    const match = schema.match(/model\s+AiAnalyzeChunk\s*\{[^}]+\}/);
    assert.ok(match, "AiAnalyzeChunk model must exist in schema");
    const modelBlock = match[0];
    // It should have tenderId and userId as scalar fields
    assert.ok(modelBlock.includes("tenderId"), "AiAnalyzeChunk must have tenderId scalar field");
    assert.ok(modelBlock.includes("userId"), "AiAnalyzeChunk must have userId scalar field");
    // It should NOT have a `tender Tender` relation field
    assert.ok(
      !/\btender\s+(Tender|tender)/.test(modelBlock),
      "AiAnalyzeChunk must NOT have a Tender relation field — only scalar tenderId",
    );
  });
});
