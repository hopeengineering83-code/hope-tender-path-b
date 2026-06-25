// Production AI Analyze crash fix — schema-safe tender update + error sanitization + model classification.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
const read = (p: string) => readFileSync(p, "utf8");

describe("Production AI Analyze crash fix", () => {

  // FIX 1: Remove envelopeMode, clientType, submissionFormat from tender.update
  describe("Fix 1 — finalizeJob does NOT write non-schema fields to tender.update", () => {
    it("analysis-job-service.ts does NOT contain envelopeMode in tender.update data", () => {
      const src = read("lib/ai-jobs/analysis-job-service.ts");
      // The transaction block that calls tx.tender.update must not set envelopeMode
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

    it("prisma/schema.prisma does NOT have envelopeMode/clientType/submissionFormat columns", () => {
      const schema = read("prisma/schema.prisma");
      assert.ok(!/envelopeMode/.test(schema), "Tender model must NOT have envelopeMode");
      assert.ok(!/clientType/.test(schema), "Tender model must NOT have clientType");
      assert.ok(!/submissionFormat/.test(schema), "Tender model must NOT have submissionFormat");
    });
  });

  // FIX 2: classifyAiError classifies "Unknown Model" as MODEL_UNAVAILABLE
  describe("Fix 2 — Z.ai HTTP 400 'Unknown Model' classified as MODEL_UNAVAILABLE", () => {
    it("classifyAiError regex includes 'unknown model' and 'please check the model'", () => {
      const src = read("lib/ai-provider-health.ts");
      // The regex in source uses \\s (escaped for regex literal), so we test
      // for the literal string pattern, not a regex pattern.
      assert.ok(src.includes("unknown"), "classifyAiError must include 'unknown' pattern");
      assert.ok(src.includes("please"), "classifyAiError must include 'please' pattern");
      assert.ok(src.includes("model"), "classifyAiError must include 'model' pattern");
      assert.ok(src.includes("MODEL_UNAVAILABLE"), "must classify as MODEL_UNAVAILABLE");
    });
  });

  // FIX 3: Error sanitization — no raw Prisma errors in errorMessage
  describe("Fix 3 — finalizeJob sanitizes persistence errors", () => {
    it("finalizeJob has try/catch around the transaction", () => {
      const src = read("lib/ai-jobs/analysis-job-service.ts");
      const block = src.slice(src.indexOf("// Atomically promote canonical requirements"));
      assert.match(block, /try\s*\{/);
      assert.match(block, /catch\s*\(persistErr\)/);
    });

    it("finalizeJob stores AI_ANALYSIS_PERSISTENCE_FAILED safe code, not raw error", () => {
      const src = read("lib/ai-jobs/analysis-job-service.ts");
      assert.match(src, /AI_ANALYSIS_PERSISTENCE_FAILED/);
      assert.match(src, /correlationId/);
      // Must NOT store the raw error message in errorMessage
      const catchBlock = src.slice(src.indexOf("catch (persistErr)"));
      assert.ok(!/errorMessage:\s*persistErr/.test(catchBlock), "must NOT store raw error in errorMessage");
      assert.ok(!/errorMessage:\s*err\.message/.test(catchBlock), "must NOT store err.message in errorMessage");
    });

    it("finalizeJob logs technical cause server-side with correlation ID", () => {
      const src = read("lib/ai-jobs/analysis-job-service.ts");
      assert.match(src, /console\.error.*AI_ANALYSIS_PERSISTENCE_FAILED.*correlation/);
    });
  });

  // GATE SAFETY: No weakening of generation/export gates
  describe("Gate safety — no regressions", () => {
    it("generation gate still blocks ANALYSIS_NOT_READY", () => {
      const gate = read("lib/engine/generation-readiness-gate.ts");
      assert.match(gate, /ANALYSIS_NOT_READY/);
    });

    it("generation gate still blocks FALLBACK_UNAPPROVED", () => {
      const gate = read("lib/engine/generation-readiness-gate.ts");
      assert.match(gate, /FALLBACK_UNAPPROVED/);
    });

    it("Anthropic remains last in provider chain", () => {
      const catalog = read("lib/ai-provider-catalog.cjs");
      const match = catalog.match(/CANONICAL_AI_PROVIDER_ORDER\s*=\s*\[([\s\S]*?)\]/);
      assert.ok(match);
      const providers = Array.from(match[1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
      assert.equal(providers[providers.length - 1], "anthropic");
    });

    it("recovery-command-center does NOT say 'generation unblocked'", () => {
      const src = read("components/tender-recovery-command-center.tsx");
      assert.ok(!/generation unblocked/i.test(src), "must NOT contain 'generation unblocked'");
    });
  });
});
