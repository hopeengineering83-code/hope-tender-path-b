/**
 * Regression test: AiAnalyzeChunk must never be queried using a `tender`
 * relation filter. The model has scalar `tenderId` and `userId` fields only.
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
    const files = [...findTsFiles("lib"), ...findTsFiles("app"), ...findTsFiles("scripts")];
    const violations: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      const pattern = /aiAnalyzeChunk\.(findMany|findFirst|count|findUnique|updateMany|deleteMany)\s*\(/g;
      let match;
      while ((match = pattern.exec(src)) !== null) {
        const after = src.slice(match.index, match.index + 500);
        if (/tender\s*:\s*\{/.test(after) && !/tenderId\s*:/.test(after.slice(0, after.indexOf("tender:")))) {
          violations.push(`${file}: invalid 'tender: { ... }' relation filter near aiAnalyzeChunk query`);
        }
      }
    }
    assert.equal(violations.length, 0, `Found ${violations.length} invalid AiAnalyzeChunk relation filter(s):\n${violations.join("\n")}`);
  });

  it("generation-readiness-gate uses scalar userId for AiAnalyzeChunk", () => {
    const src = readFileSync("lib/engine/generation-readiness-gate.ts", "utf8");
    assert.ok(src.includes("where: { tenderId, userId, contentHash: currentContentHash }"),
      "gate must filter AiAnalyzeChunk by scalar tenderId + userId + contentHash");
    const chunkQueryMatch = src.match(/aiAnalyzeChunk\.findMany\([\s\S]*?\}\s*\)/);
    if (chunkQueryMatch) {
      assert.ok(!/tender\s*:\s*\{/.test(chunkQueryMatch[0]),
        "AiAnalyzeChunk query must NOT use 'tender: { userId }' relation filter");
    }
  });

  it("AiAnalyzeChunk model has no Tender relation in Prisma schema", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const match = schema.match(/model\s+AiAnalyzeChunk\s*\{[^}]+\}/);
    assert.ok(match, "AiAnalyzeChunk model must exist in schema");
    const modelBlock = match[0];
    assert.ok(modelBlock.includes("tenderId"), "must have tenderId scalar");
    assert.ok(modelBlock.includes("userId"), "must have userId scalar");
    assert.ok(!/\btender\s+(Tender|tender)/.test(modelBlock), "must NOT have Tender relation");
  });
});
