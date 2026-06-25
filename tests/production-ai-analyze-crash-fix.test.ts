// Production AI Analyze crash fix — schema-safe tender update + error sanitization + model classification.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
const read = (p: string) => readFileSync(p, "utf8");

describe("Production AI Analyze crash fix", () => {

  describe("Fix 1 — finalizeJob does NOT write non-schema fields to tender.update", () => {
    it("analysis-job-service.ts does NOT contain envelopeMode in tender.update data", () => {
      const src = read("lib/ai-jobs/analysis-job-service.ts");
      const txBlock = src.slice(src.indexOf("await prisma.$transaction"), src.indexOf("return { status: failed.length"));
      assert.ok(!/envelopeMode/.test(txBlock), "finalizeJob transaction must NOT write envelopeMode");
    });
    it("analysis-job-service.ts does NOT contain clientType in tender.update data", () => {
      const src = read("lib/ai-jobs/analysis-job-service.ts");
      const txBlock = src.slice(src.indexOf("await prisma.$transaction"), src.indexOf("return { status: failed.length"));
      assert.ok(!/clientType/.test(txBlock), "finalizeJob transaction must NOT write clientType");
    });
    it("analysis-job-service.ts does NOT contain submissionFormat in tender.update data", () => {
      const src = read("lib/ai-jobs/analysis-job-service.ts");
      const txBlock = src.slice(src.indexOf("await prisma.$transaction"), src.indexOf("return { status: failed.length"));
      assert.ok(!/submissionFormat/.test(txBlock), "finalizeJob transaction must NOT write submissionFormat");
    });
    it("prisma/schema.prisma does NOT have these columns", () => {
      const schema = read("prisma/schema.prisma");
      assert.ok(!/envelopeMode/.test(schema), "Tender model must NOT have envelopeMode");
      assert.ok(!/clientType/.test(schema), "Tender model must NOT have clientType");
      assert.ok(!/submissionFormat/.test(schema), "Tender model must NOT have submissionFormat");
    });
  });

  describe("Fix 2 — Z.ai HTTP 400 'Unknown Model' classified as MODEL_UNAVAILABLE", () => {
    it("classifyAiError regex includes 'unknown model' and 'please check the model'", () => {
      const src = read("lib/ai-provider-health.ts");
      assert.ok(src.includes("unknown"), "must include 'unknown' pattern");
      assert.ok(src.includes("please"), "must include 'please' pattern");
      assert.ok(src.includes("MODEL_UNAVAILABLE"), "must classify as MODEL_UNAVAILABLE");
    });
  });

  describe("Fix 3 — finalizeJob sanitizes persistence errors", () => {
    it("finalizeJob has try/catch around the transaction", () => {
      const src = read("lib/ai-jobs/analysis-job-service.ts");
      assert.match(src, /try\s*\{/);
      assert.match(src, /catch\s*\(persistErr\)/);
    });
    it("stores AI_ANALYSIS_PERSISTENCE_FAILED safe code, not raw error", () => {
      const src = read("lib/ai-jobs/analysis-job-service.ts");
      assert.match(src, /AI_ANALYSIS_PERSISTENCE_FAILED/);
      assert.match(src, /correlationId/);
    });
  });

  describe("Gate safety — no regressions", () => {
    it("generation gate still blocks ANALYSIS_NOT_READY", () => {
      assert.match(read("lib/engine/generation-readiness-gate.ts"), /ANALYSIS_NOT_READY/);
    });
    it("Anthropic remains last in provider chain", () => {
      const catalog = read("lib/ai-provider-catalog.cjs");
      const match = catalog.match(/CANONICAL_AI_PROVIDER_ORDER\s*=\s*\[([\s\S]*?)\]/);
      assert.ok(match, "must find CANONICAL_AI_PROVIDER_ORDER");
      const providers = Array.from(match![1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
      assert.equal(providers[providers.length - 1], "anthropic");
    });
    it("recovery-command-center does NOT say 'generation unblocked'", () => {
      assert.ok(!/generation unblocked/i.test(read("components/tender-recovery-command-center.tsx")));
    });
  });
});
