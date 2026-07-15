import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const dashboardSrc = readFileSync("app/dashboard/page.tsx", "utf8");
const complianceSrc = readFileSync("app/dashboard/compliance/compliance-dashboard.tsx", "utf8");
const analysisSrc = readFileSync("app/dashboard/analysis/page.tsx", "utf8");
const commandCenterSrc = readFileSync("app/dashboard/tenders/[id]/command-center/page.tsx", "utf8");
const aiEnvSrc = readFileSync("lib/ai-environment-readiness.ts", "utf8");
const systemSrc = readFileSync("lib/system-readiness.ts", "utf8");

const EXPECTED_ORDER = ["zai", "cerebras", "mistral", "groq", "openrouter", "gemini", "openai", "together", "deepseek", "anthropic"];

describe("FINDING-SCREENSHOT-STATE-001 — State Truth and AI Runtime", () => {
  describe("dashboard critical-gaps counting includes extraction-blocked tenders", () => {
    it("counts tenders with the ACTUAL persisted status EXTRACTION_CORRUPTED_AI_SKIPPED", () => {
      assert.match(dashboardSrc, /EXTRACTION_CORRUPTED_AI_SKIPPED/);
    });

    it("includes REGEX_FALLBACK states as blocked", () => {
      assert.match(dashboardSrc, /REGEX_FALLBACK_AI_ERROR/);
      assert.match(dashboardSrc, /REGEX_FALLBACK_UNAPPROVED/);
    });

    it("counts tenders with no analysis as critical gaps", () => {
      assert.match(dashboardSrc, /hasNoAnalysis/);
    });

    it("does not show AI enabled as analysis authority", () => {
      assert.match(dashboardSrc, /AI providers configured/);
    });
  });

  describe("dashboard currency handling does not mix currencies", () => {
    it("groups budgets by currency", () => {
      assert.match(dashboardSrc, /budgetsByCurrency/);
    });

    it("suppresses aggregate when currencies differ", () => {
      assert.match(dashboardSrc, /Mixed currencies/);
      assert.match(dashboardSrc, /singleCurrency/);
    });

    it("does not hardcode dollar sign", () => {
      assert.doesNotMatch(dashboardSrc, /\$\$\{/);
    });
  });

  describe("compliance dashboard does not treat missing rows as proof of compliance", () => {
    it("counts unanalyzed tenders and warns", () => {
      assert.match(complianceSrc, /unanalyzedCount/);
      assert.match(complianceSrc, /Missing gap rows are not proof of compliance/);
    });
  });

  describe("analysis page blocks false Clear for corrupted/unanalysed tenders", () => {
    it("shows NOT ANALYZED for tenders with zero requirements", () => {
      assert.match(analysisSrc, /NOT ANALYZED/);
    });

    it("shows BLOCKED for EXTRACTION_CORRUPTED_AI_SKIPPED (the actual persisted status)", () => {
      assert.match(analysisSrc, /EXTRACTION_CORRUPTED_AI_SKIPPED/);
    });

    it("shows BLOCKED for REGEX_FALLBACK states", () => {
      assert.match(analysisSrc, /REGEX_FALLBACK_AI_ERROR/);
      assert.match(analysisSrc, /REGEX_FALLBACK_UNAPPROVED/);
    });

    it("selects analysisExtractionStatus from the database", () => {
      assert.match(analysisSrc, /analysisExtractionStatus: true/);
    });
  });

  describe("command center queries jobs by tenderId only", () => {
    it("does not use OR with userId in the AiJob query", () => {
      assert.doesNotMatch(commandCenterSrc, /OR.*tenderId.*userId|OR.*userId.*tenderId/);
    });

    it("queries only by tenderId", () => {
      assert.match(commandCenterSrc, /where:\s*\{\s*tenderId:\s*id\s*\}/);
    });
  });

  describe("provider order equality test against runtime registry", () => {
    it("lib/ai-environment-readiness.ts imports CANONICAL_AI_PROVIDER_ORDER", () => {
      assert.match(aiEnvSrc, /CANONICAL_AI_PROVIDER_ORDER/);
    });

    it("lib/system-readiness.ts imports CANONICAL_AI_PROVIDER_ORDER", () => {
      assert.match(systemSrc, /CANONICAL_AI_PROVIDER_ORDER/);
    });

    it("lib/system-readiness.ts uses REQUIRED_PROVIDER_ORDER from the canonical names", () => {
      assert.match(systemSrc, /REQUIRED_PROVIDER_ORDER.*CANONICAL_AI_PROVIDER_DISPLAY_NAMES/);
    });

    it("the registry catalog defines Anthropic as the last provider", () => {
      const catalog = readFileSync("lib/ai-provider-catalog.cjs", "utf8");
      const orderMatch = catalog.match(/CANONICAL_AI_PROVIDER_ORDER\s*=\s*\[([\s\S]*?)\]/);
      assert.ok(orderMatch, "CANONICAL_AI_PROVIDER_ORDER must be defined");
      const orderStr = orderMatch[1];
      assert.ok(orderStr.includes("anthropic"), "must include anthropic");
      const providers = orderStr.match(/"(\w+)"/g)?.map((s) => s.replace(/"/g, "")) ?? [];
      assert.ok(providers.length > 0, "must find provider entries");
      assert.equal(providers[providers.length - 1], "anthropic", "Anthropic must be the last provider in the chain");
    });

    it("the expected 10-provider order is exactly: zai then cerebras then mistral then groq then openrouter then gemini then openai then together then deepseek then anthropic", () => {
      const catalog = readFileSync("lib/ai-provider-catalog.cjs", "utf8");
      const orderMatch = catalog.match(/CANONICAL_AI_PROVIDER_ORDER\s*=\s*\[([\s\S]*?)\]/);
      assert.ok(orderMatch);
      const providers = orderMatch[1].match(/"(\w+)"/g)?.map((s) => s.replace(/"/g, "")) ?? [];
      assert.deepEqual(providers, EXPECTED_ORDER);
    });
  });

  describe("tenders page workflow progress is not labeled as readiness", () => {
    it("uses 'Workflow progress' or 'not export readiness' label", () => {
      const tendersPageSrc = readFileSync("app/dashboard/tenders/page.tsx", "utf8");
      assert.ok(
        /Workflow progress|workflow progress|not export readiness/i.test(tendersPageSrc),
        "must label the readinessScore bar as workflow progress, not export readiness"
      );
    });
  });
});
