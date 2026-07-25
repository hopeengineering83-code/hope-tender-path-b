// PR #872 final safety — type-safe Tender update + AiAnalyzeChunk query + no silent catch.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
const read = (p: string) => readFileSync(p, "utf8");

describe("PR #872 final safety fixes", () => {

  // Test 1: finalizeJob Tender update payload contains none of the 4 non-schema fields.
  describe("Test 1 — finalizeJob Tender update has no non-schema fields", () => {
    it("does NOT write analysisSource to tender.update", () => {
      const src = read("lib/ai-jobs/analysis-job-service.ts");
      // Check the actual data object between "const tenderUpdate" and the closing "};"
      const dataBlock = src.slice(src.indexOf("const tenderUpdate"), src.indexOf("};", src.indexOf("const tenderUpdate")) + 2);
      assert.ok(!/analysisSource/.test(dataBlock), "tenderUpdate data must NOT contain analysisSource");
    });

    it("does NOT write envelopeMode to tender.update", () => {
      const src = read("lib/ai-jobs/analysis-job-service.ts");
      const dataBlock = src.slice(src.indexOf("const tenderUpdate"), src.indexOf("};", src.indexOf("const tenderUpdate")) + 2);
      assert.ok(!/envelopeMode/.test(dataBlock), "tenderUpdate data must NOT contain envelopeMode");
    });

    it("does NOT write clientType to tender.update", () => {
      const src = read("lib/ai-jobs/analysis-job-service.ts");
      const dataBlock = src.slice(src.indexOf("const tenderUpdate"), src.indexOf("};", src.indexOf("const tenderUpdate")) + 2);
      assert.ok(!/clientType/.test(dataBlock), "tenderUpdate data must NOT contain clientType");
    });

    it("does NOT write submissionFormat to tender.update", () => {
      const src = read("lib/ai-jobs/analysis-job-service.ts");
      const dataBlock = src.slice(src.indexOf("const tenderUpdate"), src.indexOf("};", src.indexOf("const tenderUpdate")) + 2);
      assert.ok(!/submissionFormat/.test(dataBlock), "tenderUpdate data must NOT contain submissionFormat");
    });

    it("uses Prisma.TenderUpdateInput type (type-safe, no casts)", () => {
      const src = read("lib/ai-jobs/analysis-job-service.ts");
      assert.match(src, /Prisma\.TenderUpdateInput/);
      assert.match(src, /import type \{ Prisma \} from "@prisma\/client"/);
    });

    it("prisma/schema.prisma does NOT have analysisSource column", () => {
      const schema = read("prisma/schema.prisma");
      assert.ok(!/analysisSource/.test(schema), "Tender model must NOT have analysisSource column");
    });
  });

  // Test 2: AiAnalyzeChunk query uses direct userId, not tender:{userId}.
  describe("Test 2 — AiAnalyzeChunk query uses direct userId", () => {
    it("analysis-state-resolver.ts AiAnalyzeChunk.findMany does NOT use tender: { userId }", () => {
      const src = read("lib/engine/analysis-state-resolver.ts");
      // Find the aiAnalyzeChunk.findMany block
      const chunkBlock = src.slice(
        src.indexOf("prismaClient.aiAnalyzeChunk.findMany"),
        src.indexOf("select:", src.indexOf("prismaClient.aiAnalyzeChunk.findMany")),
      );
      assert.ok(
        !/tender:\s*\{\s*userId\s*\}/.test(chunkBlock),
        "AiAnalyzeChunk.findMany must NOT use tender: { userId }",
      );
    });

    it("analysis-state-resolver.ts AiAnalyzeChunk.findMany uses direct userId", () => {
      const src = read("lib/engine/analysis-state-resolver.ts");
      const chunkBlock = src.slice(
        src.indexOf("prismaClient.aiAnalyzeChunk.findMany"),
        src.indexOf("select:", src.indexOf("prismaClient.aiAnalyzeChunk.findMany")),
      );
      // Must use direct userId (the AiAnalyzeChunk model has a userId column)
      assert.match(chunkBlock, /userId/, "AiAnalyzeChunk.findMany must use direct userId filter");
    });
  });

  // Test 3: No silent .catch(() => {}) in finalizeJob.
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
      assert.ok(!src.includes("console.error("), "finalizeJob must use the structured logger, not console.error");
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
      const catalog = read("lib/ai-provider-catalog.cjs");
      const match = catalog.match(/CANONICAL_AI_PROVIDER_ORDER\s*=\s*\[([\s\S]*?)\]/);
      assert.ok(match, "must find CANONICAL_AI_PROVIDER_ORDER");
      const providers = Array.from(match![1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
      assert.equal(providers[providers.length - 1], "anthropic");
    });

    it("generation-action-panel does NOT say 'generation unblocked'", () => {
      // components/tender-recovery-command-center.tsx (this check's original
      // subject) was deleted as unrendered dead code (nothing imports or
      // renders it). components/generation-action-panel.tsx is the live,
      // rendered panel that owns the Generate Docs gate today.
      assert.ok(!/generation unblocked/i.test(read("components/generation-action-panel.tsx")));
    });
  });
});
