import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  classifyTenderExtractionState,
  isExtractionCritical,
  BLOCKED_EXTRACTION_STATES,
} from "../lib/engine/tender-extraction-state";
import {
  CANONICAL_AI_PROVIDER_ORDER,
  isProviderConfigured,
  getProviderTimeoutMs,
} from "../lib/ai-provider-registry";

const dashboardSrc = readFileSync("app/dashboard/page.tsx", "utf8");
const complianceSrc = readFileSync("app/dashboard/compliance/compliance-dashboard.tsx", "utf8");
const analysisSrc = readFileSync("app/dashboard/analysis/page.tsx", "utf8");
const commandCenterSrc = readFileSync("app/dashboard/tenders/[id]/command-center/page.tsx", "utf8");
const aiEnvSrc = readFileSync("lib/ai-environment-readiness.ts", "utf8");
const systemSrc = readFileSync("lib/system-readiness.ts", "utf8");

const EXPECTED_ORDER = ["zai", "cerebras", "mistral", "groq", "openrouter", "gemini", "openai", "together", "deepseek", "anthropic"];

describe("FINDING-SCREENSHOT-STATE-001 — State Truth and AI Runtime", () => {
  describe("dashboard critical-gaps counting includes extraction-blocked tenders", () => {
    it("uses the canonical extraction-state helper (no local status arrays)", () => {
      assert.match(dashboardSrc, /isExtractionCritical/);
      assert.doesNotMatch(dashboardSrc, /EXTRACTION_BLOCKED_STATES\s*=\s*new Set/);
    });

    it("includes REGEX_FALLBACK states as blocked via canonical helper", () => {
      assert.ok(BLOCKED_EXTRACTION_STATES.has("REGEX_FALLBACK_AI_ERROR"));
      assert.ok(BLOCKED_EXTRACTION_STATES.has("REGEX_FALLBACK_UNAPPROVED"));
    });

    it("counts tenders with no analysis as critical gaps via canonical helper", () => {
      assert.match(dashboardSrc, /isExtractionCritical/);
      assert.match(dashboardSrc, /analysisExtractionStatus/);
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

    it("uses the canonical extraction-state helper for BLOCKED detection", () => {
      assert.match(analysisSrc, /classifyTenderExtractionState/);
      assert.ok(BLOCKED_EXTRACTION_STATES.has("EXTRACTION_CORRUPTED_AI_SKIPPED"));
    });

    it("shows BLOCKED for REGEX_FALLBACK states via the canonical helper", () => {
      assert.match(analysisSrc, /classifyTenderExtractionState/);
      assert.ok(BLOCKED_EXTRACTION_STATES.has("REGEX_FALLBACK_AI_ERROR"));
      assert.ok(BLOCKED_EXTRACTION_STATES.has("REGEX_FALLBACK_UNAPPROVED"));
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

  describe("canonical extraction-state helper", () => {
    it("classifies NOT_ANALYZED for zero requirements", () => {
      assert.equal(classifyTenderExtractionState(null, 0), "NOT_ANALYZED");
      assert.equal(classifyTenderExtractionState("AI_SUCCEEDED", 0), "NOT_ANALYZED");
    });

    it("classifies NOT_ANALYZED for null/NOT_STARTED status with requirements", () => {
      assert.equal(classifyTenderExtractionState(null, 5), "NOT_ANALYZED");
      assert.equal(classifyTenderExtractionState("NOT_STARTED", 5), "NOT_ANALYZED");
    });

    it("classifies BLOCKED for all actual persisted blocked statuses", () => {
      for (const status of BLOCKED_EXTRACTION_STATES) {
        assert.equal(
          classifyTenderExtractionState(status, 5),
          "BLOCKED",
          `status ${status} must be BLOCKED`,
        );
      }
    });

    it("classifies CLEAR for AI_SUCCEEDED with requirements", () => {
      assert.equal(classifyTenderExtractionState("AI_SUCCEEDED", 5), "CLEAR");
    });

    it("isExtractionCritical returns true for blocked/not-analyzed, false for clear", () => {
      assert.equal(isExtractionCritical(null, 0), true);
      assert.equal(isExtractionCritical("EXTRACTION_CORRUPTED_AI_SKIPPED", 5), true);
      assert.equal(isExtractionCritical("REGEX_FALLBACK_UNAPPROVED", 5), true);
      assert.equal(isExtractionCritical("AI_SUCCEEDED", 5), false);
    });

    it("includes HUMAN_APPROVED_FALLBACK and SUPERSEDED in blocked states", () => {
      assert.ok(BLOCKED_EXTRACTION_STATES.has("HUMAN_APPROVED_FALLBACK"));
      assert.ok(BLOCKED_EXTRACTION_STATES.has("SUPERSEDED"));
      assert.ok(BLOCKED_EXTRACTION_STATES.has("FAILED"));
    });
  });

  describe("behavioral runtime provider-order tests", () => {
    it("CANONICAL_AI_PROVIDER_ORDER at runtime matches expected 10-provider chain", () => {
      assert.deepEqual(
        Array.from(CANONICAL_AI_PROVIDER_ORDER),
        EXPECTED_ORDER,
      );
    });

    it("Anthropic is last at runtime", () => {
      const order = Array.from(CANONICAL_AI_PROVIDER_ORDER);
      assert.equal(order[order.length - 1], "anthropic");
    });

    it("every provider has a finite timeout configured", () => {
      for (const provider of CANONICAL_AI_PROVIDER_ORDER) {
        const timeout = getProviderTimeoutMs(provider);
        assert.ok(
          typeof timeout === "number" && timeout > 0 && Number.isFinite(timeout),
          `provider ${provider} must have a finite positive timeout, got ${timeout}`,
        );
      }
    });

    it("isProviderConfigured returns false for providers without keys (except gemini which uses GEMINI_API_KEY from test env)", () => {
      // Gemini may be configured in the test env via GEMINI_API_KEY.
      // Verify that at least the non-gemini providers are not configured.
      for (const provider of CANONICAL_AI_PROVIDER_ORDER) {
        if (provider === "gemini") continue;
        assert.equal(
          isProviderConfigured(provider),
          false,
          `provider ${provider} should not be configured in test env`,
        );
      }
    });
  });
});
