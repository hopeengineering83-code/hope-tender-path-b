/**
 * Regression test: AiAnalyzeChunk must never be queried using a `tender`
 * relation filter. The model has scalar `tenderId` and `userId` fields only.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function findTsFiles(dir: string, results: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (["node_modules", ".next", ".git"].includes(entry)) continue;
      findTsFiles(p, results);
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) results.push(p);
  }
  return results;
}

describe("AiAnalyzeChunk relation query regression", () => {
  it("no source file queries AiAnalyzeChunk with 'tender:' relation filter", () => {
    const violations: string[] = [];
    for (const file of [...findTsFiles("lib"), ...findTsFiles("app")]) {
      const src = readFileSync(file, "utf8");
      let m;
      const re = /aiAnalyzeChunk\.(findMany|findFirst|count|findUnique|updateMany|deleteMany)\s*\(/g;
      while ((m = re.exec(src)) !== null) {
        const after = src.slice(m.index, m.index + 500);
        if (/tender\s*:\s*\{/.test(after) && !/tenderId\s*:/.test(after.slice(0, after.indexOf("tender:")))) {
          violations.push(file);
        }
      }
    }
    assert.equal(violations.length, 0);
  });

  it("generation-readiness-gate uses scalar userId for AiAnalyzeChunk", () => {
    const src = readFileSync("lib/engine/generation-readiness-gate.ts", "utf8");
    assert.ok(src.includes('where: { tenderId, userId, jobId: latestJob?.id ?? "__missing_analysis_job__" }'));
    const q = src.match(/aiAnalyzeChunk\.findMany\([\s\S]*?\}\s*\)/);
    if (q) assert.ok(!/tender\s*:\s*\{/.test(q[0]));
  });

  it("AiAnalyzeChunk has no Tender relation in schema", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const m = schema.match(/model\s+AiAnalyzeChunk\s*\{[^}]+\}/);
    assert.ok(m);
    assert.ok(m[0].includes("tenderId"));
    assert.ok(m[0].includes("userId"));
    assert.ok(!/\btender\s+(Tender|tender)/.test(m[0]));
  });
});
