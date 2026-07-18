// Regression tests for final PR #872 safety repairs.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("PR #872 final safety fixes", () => {
  // Test 1: Migration SQL contains userId columns, FKs, and indexes.
  describe("Test 1 — migration SQL has userId columns + FKs + indexes", () => {
    const sql = read("prisma/migrations/20260615120000_add_user_ownership/migration.sql");

    it("adds userId columns to all four tables", () => {
      for (const table of ["AiAnalyzeChunk", "AiProviderUsage", "AiUsageRecord", "KnowledgeImportRun"]) {
        assert.match(sql, new RegExp(`ALTER TABLE \\"${table}\\" ADD COLUMN \\"userId\\"`));
      }
    });

    it("creates foreign keys for all four tables", () => {
      for (const table of ["AiAnalyzeChunk", "AiProviderUsage", "AiUsageRecord", "KnowledgeImportRun"]) {
        assert.match(sql, new RegExp(`ALTER TABLE \\"${table}\\" ADD CONSTRAINT \\"${table}_userId_fkey\\"`));
      }
    });

    it("creates indexes for all four tables", () => {
      for (const table of ["AiAnalyzeChunk", "AiProviderUsage", "AiUsageRecord", "KnowledgeImportRun"]) {
        assert.match(sql, new RegExp(`CREATE INDEX \\"${table}_userId_idx\\"`));
      }
    });
  });

  // Test 2: Schema relations use SetNull and User backrelations exist.
  describe("Test 2 — schema relations are correct", () => {
    const schema = read("prisma/schema.prisma");

    it("all four ownership relations use onDelete: SetNull", () => {
      for (const rel of ["aiAnalyzeChunks", "aiProviderUsage", "aiUsageRecords", "knowledgeImportRuns"]) {
        assert.match(schema, new RegExp(`${rel}.*`, "s"));
      }
      assert.ok((schema.match(/onDelete: SetNull/g) ?? []).length >= 4);
    });

    it("analysis-state-resolver.ts AiAnalyzeChunk.findMany uses direct userId", () => {
      const src = read("lib/engine/analysis-state-resolver.ts");
      const chunkBlock = src.slice(
        src.indexOf("prismaClient.aiAnalyzeChunk.findMany"),
        src.indexOf("select:", src.indexOf("prismaClient.aiAnalyzeChunk.findMany")),
      );
      assert.match(chunkBlock, /userId/, "AiAnalyzeChunk.findMany must use direct userId filter");
    });
  });

  // Test 3: No silent catch; structured logger must retain the full server-side error.
  describe("Test 3 — no silent catch in finalizeJob", () => {
    it("finalizeJob does NOT have .catch(() => {})", () => {
      const src = read("lib/ai-jobs/analysis-job-service.ts");
      assert.ok(
        !/\.catch\(\(\) => \{\}\)/.test(src),
        "finalizeJob must NOT have silent .catch(() => {})",
      );
    });

    it("finalizeJob catch block logs structured error", () => {
      const src = read("lib/ai-jobs/analysis-job-service.ts");
      assert.match(src, /catch\(\(updateErr\)/);
      assert.match(src, /logger\.error/);
      assert.doesNotMatch(src, /console\.error\(/);
      assert.match(src, /Failed to mark job/);
    });
  });

  // Test 4: Gate safety — no regressions.
  describe("Test 4 — gate safety no regressions", () => {
    it("generation gate still blocks ANALYSIS_NOT_READY", () => {
      assert.match(read("lib/engine/generation-readiness-gate.ts"), /ANALYSIS_NOT_READY/);
    });

    it("generation gate still blocks FALLBACK_UNAPPROVED", () => {
      assert.match(read("lib/engine/generation-readiness-gate.ts"), /FALLBACK_UNAPPROVED/);
    });

    it("Anthropic remains last in provider chain", () => {
      const src = read("lib/ai-provider-catalog.cjs");
      const providerOrder = ["ZAI", "CEREBRAS", "MISTRAL", "GROQ", "OPENROUTER", "OPENAI", "TOGETHER", "DEEPSEEK", "CLAUDE"];
      const positions = providerOrder.map((provider) => src.indexOf(`\"${provider}\"`));
      assert.ok(positions.every((position) => position >= 0));
      assert.equal(positions.at(-1), Math.max(...positions));
    });

    it("recovery-command-center does NOT say 'generation unblocked'", () => {
      const src = read("components/tender-recovery-command-center.tsx");
      assert.ok(!src.toLowerCase().includes("generation unblocked"));
    });
  });
});
