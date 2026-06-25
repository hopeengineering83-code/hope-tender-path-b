import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
const read = (p: string) => readFileSync(p, "utf8");

describe("Production AI Analyze crash fix", () => {
  it("finalizeJob does NOT write envelopeMode to tender.update", () => {
    const src = read("lib/ai-jobs/analysis-job-service.ts");
    const txBlock = src.slice(src.indexOf("await prisma.$transaction"), src.indexOf("return { status: failed.length"));
    assert.ok(!/envelopeMode/.test(txBlock));
  });
  it("finalizeJob does NOT write clientType to tender.update", () => {
    const src = read("lib/ai-jobs/analysis-job-service.ts");
    const txBlock = src.slice(src.indexOf("await prisma.$transaction"), src.indexOf("return { status: failed.length"));
    assert.ok(!/clientType/.test(txBlock));
  });
  it("finalizeJob does NOT write submissionFormat to tender.update", () => {
    const src = read("lib/ai-jobs/analysis-job-service.ts");
    const txBlock = src.slice(src.indexOf("await prisma.$transaction"), src.indexOf("return { status: failed.length"));
    assert.ok(!/submissionFormat/.test(txBlock));
  });
  it("schema does NOT have these columns", () => {
    const schema = read("prisma/schema.prisma");
    assert.ok(!/envelopeMode/.test(schema));
    assert.ok(!/clientType/.test(schema));
    assert.ok(!/submissionFormat/.test(schema));
  });
  it("classifyAiError includes unknown model pattern", () => {
    const src = read("lib/ai-provider-health.ts");
    assert.ok(src.includes("unknown"), "must include unknown pattern");
    assert.ok(src.includes("MODEL_UNAVAILABLE"), "must classify as MODEL_UNAVAILABLE");
  });
  it("finalizeJob has try/catch with AI_ANALYSIS_PERSISTENCE_FAILED", () => {
    const src = read("lib/ai-jobs/analysis-job-service.ts");
    assert.match(src, /catch\s*\(persistErr\)/);
    assert.match(src, /AI_ANALYSIS_PERSISTENCE_FAILED/);
  });
  it("generation gate still blocks ANALYSIS_NOT_READY", () => {
    assert.match(read("lib/engine/generation-readiness-gate.ts"), /ANALYSIS_NOT_READY/);
  });
  it("Anthropic remains last in chain", () => {
    const catalog = read("lib/ai-provider-catalog.cjs");
    const match = catalog.match(/CANONICAL_AI_PROVIDER_ORDER\s*=\s*\[([\s\S]*?)\]/);
    assert.ok(match);
    const providers = Array.from(match![1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
    assert.equal(providers[providers.length - 1], "anthropic");
  });
});
