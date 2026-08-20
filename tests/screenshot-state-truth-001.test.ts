import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  classifyTenderExtractionState,
  isExtractionCritical,
  BLOCKED_EXTRACTION_STATES,
  CLEAR_EXTRACTION_STATES,
} from "../lib/engine/tender-extraction-state";
import {
  isStatusInClearAllowlist,
  isStatusInBlockedDenylist,
  isCanonicalCurrentnessCritical,
  type TenderCurrentnessVerdict,
} from "../lib/engine/tender-currentness";
import {
  CANONICAL_AI_PROVIDER_ORDER,
  isProviderConfigured,
  getProviderTimeoutMs,
} from "../lib/ai-provider-registry";
import { getAIEnvironmentReadiness } from "../lib/ai-environment-readiness";
import { getSystemReadiness } from "../lib/system-readiness";

const dashboardSrc = readFileSync("app/dashboard/page.tsx", "utf8");
const complianceSrc = readFileSync("app/dashboard/compliance/compliance-dashboard.tsx", "utf8");
const analysisSrc = readFileSync("app/dashboard/analysis/page.tsx", "utf8");
const commandCenterSrc = readFileSync("app/dashboard/tenders/[id]/command-center/page.tsx", "utf8");
const currentnessSrc = readFileSync("lib/engine/tender-currentness.ts", "utf8");
const aiEnvSrc = readFileSync("lib/ai-environment-readiness.ts", "utf8");
const systemSrc = readFileSync("lib/system-readiness.ts", "utf8");

const EXPECTED_ORDER = ["gemini", "groq", "mistral", "zai", "openrouter", "cerebras", "openai", "together", "deepseek", "anthropic"];

describe("FINDING-SCREENSHOT-STATE-001 — State Truth and AI Runtime", () => {
  describe("dashboard critical-blockers count uses canonical currentness", () => {
    it("uses classifyTenderCurrentnessBatch (canonical currentness, not bare status)", () => {
      assert.match(dashboardSrc, /classifyTenderCurrentnessBatch/);
      assert.match(dashboardSrc, /isCanonicalCurrentnessCritical/);
    });

    it("imports the canonical-currentness helper", () => {
      assert.match(dashboardSrc, /from "\.\.\/\.\.\/lib\/engine\/tender-currentness"/);
    });

    it("does not use the bare isExtractionCritical helper for the global count", () => {
      // The bare helper checks persisted status only; canonical currentness
      // also requires a non-superseded promoted AI job.
      assert.doesNotMatch(dashboardSrc, /isExtractionCritical/);
    });

    it("does not show AI enabled as analysis authority", () => {
      assert.match(dashboardSrc, /AI providers configured/);
    });

    it("labels the count as Critical blockers with lower-bound subtitle", () => {
      assert.match(dashboardSrc, /Critical blockers/);
      assert.match(dashboardSrc, /minimum — per-tender verification still required/);
    });
  });

  describe("dashboard currency handling is forward-compatible with PR #1141 nullable currency", () => {
    it("uses prisma.groupBy for budget count across all tenders", () => {
      assert.match(dashboardSrc, /prisma\.tender\.groupBy/);
    });

    it("defensively skips null currencies at runtime (forward-compatible with #1141)", () => {
      assert.match(dashboardSrc, /if \(!curr\) continue/);
    });

    it("labels budget count as 'non-null currency' in the rendered card (honest, not verified)", () => {
      // The label appears in the rendered card text, not just in comments.
      // Match the rendered text content.
      assert.match(dashboardSrc, />non-null currency/);
    });

    it("does NOT compute or display a Pipeline Value aggregate sum", () => {
      // The aggregate was removed entirely. No budgetsByCurrency Map,
      // no singleCurrency, no pipelineValue variable.
      assert.doesNotMatch(dashboardSrc, /budgetsByCurrency/);
      assert.doesNotMatch(dashboardSrc, /singleCurrency/);
      assert.doesNotMatch(dashboardSrc, /pipelineValue/);
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

    it("uses the canonical-currentness helper for BLOCKED detection", () => {
      assert.match(analysisSrc, /classifyTenderCurrentnessBatch/);
      assert.match(analysisSrc, /currentnessVerdicts/);
    });

    it("does not use the bare classifyTenderExtractionState helper", () => {
      assert.doesNotMatch(analysisSrc, /classifyTenderExtractionState/);
    });

    it("selects analysisExtractionStatus from the database", () => {
      assert.match(analysisSrc, /analysisExtractionStatus: true/);
    });

    it("does not cap tenders query at take:20 for global analysis totals", () => {
      assert.doesNotMatch(analysisSrc, /take:\s*20/);
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

  describe("canonical extraction-state helper (fail-closed unknown state)", () => {
    it("exports CLEAR_EXTRACTION_STATES allowlist", () => {
      assert.ok(CLEAR_EXTRACTION_STATES, "CLEAR_EXTRACTION_STATES must be exported");
      assert.ok(CLEAR_EXTRACTION_STATES.has("AI_SUCCEEDED"), "AI_SUCCEEDED must be CLEAR");
    });

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

    it("FAILS CLOSED — unknown status strings are BLOCKED, never CLEAR", () => {
      const unknownStatuses = [
        "STALE_HASH",
        "PARTIAL_PROVIDER_FALLBACK",
        "MIXED_FALLBACK",
        "CURRENTNESS_BLOCKED",
        "EXTRACTION_CORRUPTED_AI_SKIPED", // misspelling
        "AI_SUCCED", // misspelling
        "SOMETHING_NEW_IN_THE_FUTURE",
        "AI_ANALYZED_PARTIAL",
      ];
      for (const s of unknownStatuses) {
        assert.equal(
          classifyTenderExtractionState(s, 5),
          "BLOCKED",
          `unknown status "${s}" must be BLOCKED, never CLEAR`,
        );
      }
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

  describe("canonical currentness helper (mirrors deriveAnalysisStateDetail)", () => {
    it("tender-currentness.ts exists and exports classifyTenderCurrentnessBatch", () => {
      assert.match(currentnessSrc, /export async function classifyTenderCurrentnessBatch/);
    });

    it("exports isCanonicalCurrentnessCritical", () => {
      assert.match(currentnessSrc, /export function isCanonicalCurrentnessCritical/);
    });

    it("queries AiJob for AI_ANALYZE jobs ordered by createdAt desc", () => {
      assert.match(currentnessSrc, /AI_ANALYZE/);
      assert.match(currentnessSrc, /orderBy:\s*\{\s*createdAt:\s*"desc"\s*\}/);
    });

    it("takes the LATEST job per tender (first hit in desc order)", () => {
      assert.match(currentnessSrc, /if \(latestPerTender\.has\(job\.tenderId\)\) continue/);
    });

    it("rejects superseded latest jobs (BLOCKED, state SUPERSEDED)", () => {
      assert.match(currentnessSrc, /latestJob\.supersededBy/);
    });

    it("requires latest job status === SUCCEEDED (rejects PARTIAL/FAILED/QUEUED/RUNNING)", () => {
      assert.match(currentnessSrc, /latestJob\.status !== "SUCCEEDED"/);
    });

    it("requires latest job promotedAt to be set (unpromoted SUCCEEDED → BLOCKED)", () => {
      assert.match(currentnessSrc, /latestJob\.promotedAt/);
    });

    it("requires analysisInputHash to be non-empty (not just non-null)", () => {
      // Trim + empty check — catches empty-string and whitespace hashes.
      assert.match(currentnessSrc, /\(latestJob\.analysisInputHash \?\? ""\)\.trim\(\)/);
      assert.match(currentnessSrc, /if \(!hash\)/);
    });

    it("populates canonicalJobId with the real job ID when PROVISIONAL_NOT_BLOCKED", () => {
      // The verdict field must NOT always be null — it must be set to
      // latestJob.id when currentness === PROVISIONAL_NOT_BLOCKED.
      assert.match(currentnessSrc, /canonicalJobId:\s*latestJob\.id/);
    });

    it("sets canonicalJobId to null for NOT_ANALYZED and BLOCKED verdicts", () => {
      // Count occurrences — there should be multiple `canonicalJobId: null`
      // assignments (one per BLOCKED/NOT_ANALYZED branch).
      const matches = currentnessSrc.match(/canonicalJobId:\s*null/g) ?? [];
      assert.ok(matches.length >= 6, `expected at least 6 null assignments, got ${matches.length}`);
    });

    it("isCanonicalCurrentnessCritical returns true for BLOCKED and NOT_ANALYZED", () => {
      const blocked: TenderCurrentnessVerdict = { tenderId: "t1", currentness: "BLOCKED", canonicalJobId: null };
      const notAnalyzed: TenderCurrentnessVerdict = { tenderId: "t2", currentness: "NOT_ANALYZED", canonicalJobId: null };
      const provisional: TenderCurrentnessVerdict = { tenderId: "t3", currentness: "PROVISIONAL_NOT_BLOCKED", canonicalJobId: "job-1" };
      assert.equal(isCanonicalCurrentnessCritical(blocked), true);
      assert.equal(isCanonicalCurrentnessCritical(notAnalyzed), true);
      // PROVISIONAL_NOT_BLOCKED is NOT a Clear verdict — but it is also not
      // a critical blocker at the workspace projection level. The function
      // returns false so the lower-bound blocker count excludes these tenders.
      assert.equal(isCanonicalCurrentnessCritical(provisional), false);
    });

    it("isStatusInClearAllowlist identifies AI_SUCCEEDED as clear", () => {
      assert.equal(isStatusInClearAllowlist("AI_SUCCEEDED"), true);
      assert.equal(isStatusInClearAllowlist("STALE_HASH"), false);
      assert.equal(isStatusInClearAllowlist(null), false);
    });

    it("isStatusInBlockedDenylist identifies EXTRACTION_CORRUPTED_AI_SKIPPED as blocked", () => {
      assert.equal(isStatusInBlockedDenylist("EXTRACTION_CORRUPTED_AI_SKIPPED"), true);
      assert.equal(isStatusInBlockedDenylist("AI_SUCCEEDED"), false);
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

    it("every provider has a finite positive timeout configured", () => {
      for (const provider of CANONICAL_AI_PROVIDER_ORDER) {
        const timeout = getProviderTimeoutMs(provider);
        assert.ok(
          typeof timeout === "number" && timeout > 0 && Number.isFinite(timeout),
          `provider ${provider} must have a finite positive timeout, got ${timeout}`,
        );
      }
    });
  });

  describe("behavioral AI environment readiness (fail-closed)", () => {
    it("getAIEnvironmentReadiness returns a structured readiness object", () => {
      const r = getAIEnvironmentReadiness();
      assert.ok(typeof r.ready === "boolean");
      assert.ok(Array.isArray(r.providerChain));
      assert.ok(Array.isArray(r.blockers));
      assert.ok(Array.isArray(r.warnings));
      assert.ok(Array.isArray(r.variables));
    });

    it("blockers include DATABASE_URL when missing", () => {
      const savedDb = process.env.DATABASE_URL;
      delete process.env.DATABASE_URL;
      try {
        const r = getAIEnvironmentReadiness();
        assert.equal(r.ready, false, "ready must be false when DATABASE_URL missing");
        assert.ok(
          r.blockers.some((b) => b.includes("DATABASE_URL")),
          "blockers must mention DATABASE_URL",
        );
      } finally {
        if (savedDb !== undefined) process.env.DATABASE_URL = savedDb;
      }
    });

    it("blockers include SESSION_SECRET when missing", () => {
      const savedS = process.env.SESSION_SECRET;
      delete process.env.SESSION_SECRET;
      try {
        const r = getAIEnvironmentReadiness();
        assert.equal(r.ready, false);
        assert.ok(
          r.blockers.some((b) => b.includes("SESSION_SECRET")),
          "blockers must mention SESSION_SECRET",
        );
      } finally {
        if (savedS !== undefined) process.env.SESSION_SECRET = savedS;
      }
    });

    it("ready is false when no AI provider is configured", () => {
      const saved: Record<string, string | undefined> = {};
      const apiKeys = [
        "GEMINI_API_KEY",
        "GROQ_API_KEY",
        "MISTRAL_API_KEY",
        "ZAI_API_KEY",
        "OPENROUTER_API_KEY",
        "CEREBRAS_API_KEY",
        "OPENAI_API_KEY",
        "TOGETHER_API_KEY",
        "DEEPSEEK_API_KEY",
        "ANTHROPIC_API_KEY",
      ];
      for (const k of apiKeys) {
        saved[k] = process.env[k];
        delete process.env[k];
      }
      try {
        const r = getAIEnvironmentReadiness();
        assert.equal(r.ready, false, "ready must be false when no AI provider is configured");
        assert.ok(
          r.blockers.some((b) => /No AI provider/i.test(b)),
          `blockers must mention "No AI provider", got: ${JSON.stringify(r.blockers)}`,
        );
        assert.equal(r.providerChain.length, 0, "providerChain must be empty when nothing configured");
      } finally {
        for (const k of apiKeys) {
          if (saved[k] !== undefined) process.env[k] = saved[k];
        }
      }
    });

    it("providerChain count matches configured provider count", () => {
      const savedZ = process.env.ZAI_API_KEY;
      process.env.ZAI_API_KEY = "test-key-for-readiness-behavioral-test";
      try {
        const r = getAIEnvironmentReadiness();
        const presentOrder = Array.from(CANONICAL_AI_PROVIDER_ORDER).filter((p) => isProviderConfigured(p));
        assert.equal(
          r.providerChain.length,
          presentOrder.length,
          `providerChain length must match configured providers (expected ${presentOrder.length}, got ${r.providerChain.length})`,
        );
      } finally {
        if (savedZ === undefined) delete process.env.ZAI_API_KEY;
        else process.env.ZAI_API_KEY = savedZ;
      }
    });
  });

  describe("behavioral system readiness (fail-closed)", () => {
    it("getSystemReadiness returns a structured readiness object with checks array", async () => {
      const r = await getSystemReadiness();
      assert.ok(typeof r.productionReady === "boolean");
      assert.ok(Array.isArray(r.checks));
      assert.ok(r.checks.length > 0, "must return at least one readiness check");
    });

    it("reports CRITICAL ai_providers check when no provider configured", async () => {
      const saved: Record<string, string | undefined> = {};
      const apiKeys = [
        "GEMINI_API_KEY",
        "GROQ_API_KEY",
        "MISTRAL_API_KEY",
        "ZAI_API_KEY",
        "OPENROUTER_API_KEY",
        "CEREBRAS_API_KEY",
        "OPENAI_API_KEY",
        "TOGETHER_API_KEY",
        "DEEPSEEK_API_KEY",
        "ANTHROPIC_API_KEY",
      ];
      for (const k of apiKeys) {
        saved[k] = process.env[k];
        delete process.env[k];
      }
      try {
        const r = await getSystemReadiness();
        const aiCheck = r.checks.find((c) => c.key === "ai_providers");
        assert.ok(aiCheck, "must have an ai_providers check");
        assert.equal(
          aiCheck?.severity,
          "CRITICAL",
          `ai_providers must be CRITICAL when no provider configured, got ${aiCheck?.severity}`,
        );
        assert.equal(
          aiCheck?.requiredForProduction,
          true,
          "ai_providers must be required for production",
        );
        assert.equal(
          r.productionReady,
          false,
          "productionReady must be false when ai_providers is CRITICAL",
        );
      } finally {
        for (const k of apiKeys) {
          if (saved[k] !== undefined) process.env[k] = saved[k];
        }
      }
    });

    it("REQUIRED_PROVIDER_ORDER matches CANONICAL order exactly", () => {
      assert.ok(/REQUIRED_PROVIDER_ORDER\s*=\s*CANONICAL_AI_PROVIDER_DISPLAY_NAMES/.test(systemSrc));
    });
  });

  describe("workspace totals use real aggregate queries (not take:25)", () => {
    it("uses prisma.tender.count for Active Tenders", () => {
      assert.match(dashboardSrc, /prisma\.tender\.count/);
    });

    it("uses prisma.complianceGap.count for critical compliance gaps", () => {
      assert.match(dashboardSrc, /prisma\.complianceGap\.count/);
    });

    it("does NOT cap the global tenders query at take:25 for global metrics", () => {
      assert.doesNotMatch(dashboardSrc, /take:\s*25/);
    });

    it("labels the Live Pipeline table as limited to recent tenders", () => {
      assert.match(dashboardSrc, /Last \{recentTenders\.length\} tender\{recentTenders\.length === 1 \? "" : "s"\}/);
    });
  });

  describe("Live Pipeline column is canonical currentness, not false readiness", () => {
    it("has an Extraction State column instead of Readiness", () => {
      assert.match(dashboardSrc, /Extraction State/);
    });

    it("uses recentCurrentnessVerdicts for the Live Pipeline row", () => {
      assert.match(dashboardSrc, /recentCurrentnessVerdicts/);
    });

    it("renders Blocked badge for blocked extraction", () => {
      // Icon is a real inline SVG (components/icons.tsx), not a raw Unicode
      // glyph — glyph rendering depends on the viewer's OS/browser emoji
      // font and shows blank "tofu" boxes in many environments.
      assert.match(dashboardSrc, /<CrossIcon \/> Blocked/);
    });

    it("renders Not analyzed badge for not-analyzed extraction", () => {
      assert.match(dashboardSrc, /Not analyzed/);
    });

    it("renders Provisional badge (NOT Clear) when currentness === PROVISIONAL_NOT_BLOCKED", () => {
      // The dashboard must NEVER render "Clear" wording — the workspace
      // projection is a lower bound, not a canonical authority.
      assert.match(dashboardSrc, /extractionState === "PROVISIONAL_NOT_BLOCKED"/);
      assert.match(dashboardSrc, /<AlertCircleIcon \/> Provisional/);
      assert.doesNotMatch(dashboardSrc, /✓ Clear/);
      assert.doesNotMatch(dashboardSrc, />\s*Clear\s*</);
    });

    it("does NOT render a workflow % bar in the Live Pipeline (bar removed)", () => {
      // The workflow % bar was removed entirely — readinessScore is not a
      // valid workflow-stage metric and must not be displayed as progress.
      assert.doesNotMatch(dashboardSrc, /workflowBarColor/);
      assert.doesNotMatch(dashboardSrc, /workflowPct/);
    });
  });

  describe("Avg Workflow Progress card REMOVED (no honest workspace average)", () => {
    it("does not render an Avg Workflow Progress card in the rendered output", () => {
      // The card was removed entirely. The only mention of the name is in
      // a code comment documenting the removal — there is no rendered card.
      // Check that there is no rendered card header with that text.
      assert.doesNotMatch(dashboardSrc, /font-medium">Avg Workflow Progress/);
      assert.doesNotMatch(dashboardSrc, /clearScoredRows/);
    });

    it("does not reference readinessScore for a workspace average", () => {
      assert.doesNotMatch(dashboardSrc, /scoredRows/);
      assert.doesNotMatch(dashboardSrc, /avgReadiness/);
    });
  });

  describe("Ready for Export card removed (no false export authority)", () => {
    it("does NOT show a Ready for Export card with validationStatus counts", () => {
      assert.doesNotMatch(dashboardSrc, /Ready for Export/);
      assert.doesNotMatch(dashboardSrc, /exportReadyDocs/);
    });

    it("documents the removal reason in a code comment", () => {
      assert.match(dashboardSrc, /documents validated.*card was removed/);
    });
  });

  describe("Pipeline Value aggregate removed (no source-grounded currency authority)", () => {
    it("does NOT compute or display a Pipeline Value aggregate in rendered output", () => {
      // The only mention of "Pipeline Value" is in a code comment documenting
      // the removal. There is no rendered card with that header text.
      assert.doesNotMatch(dashboardSrc, /font-medium">Pipeline Value/);
      // The pipelineValue variable was removed entirely.
      assert.doesNotMatch(dashboardSrc, /\bpipelineValue\b/);
    });

    it("displays a count-only 'Tenders with budget' card with honest label", () => {
      assert.match(dashboardSrc, /Tenders with budget/);
      assert.match(dashboardSrc, /no aggregate until source-grounded authority/);
    });

    it("does not fetch _sum.budget in the groupBy query", () => {
      assert.doesNotMatch(dashboardSrc, /_sum:\s*\{\s*budget:\s*true\s*\}/);
    });
  });

  describe("Workspace projection warning (lower-bound semantics)", () => {
    it("renders a prominent workspace projection notice", () => {
      assert.match(dashboardSrc, /Workspace projection notice/);
      assert.match(dashboardSrc, /lower bounds/);
      assert.match(dashboardSrc, /per-tender verification/i);
    });

    it("labels Critical blockers with lower-bound subtitle", () => {
      assert.match(dashboardSrc, /minimum — per-tender verification still required/);
    });

    it("labels Live Pipeline as a non-canonical workspace projection", () => {
      assert.match(dashboardSrc, /workspace projection — the canonical state lives in each tender/);
    });

    it("does not use green color for the Critical blockers count", () => {
      // Even when criticalBlockers === 0, the color is slate (neutral), not
      // green. A zero lower-bound does NOT mean zero blockers.
      assert.doesNotMatch(dashboardSrc, /criticalBlockers > 0 \? "text-red-600" : "text-green-600"/);
    });
  });

  describe("Tenders page and compliance dashboard use provisional wording (no Clear authority)", () => {
    it("tenders page does NOT render a readinessScore progress bar (removed)", () => {
      // The progress bar was removed entirely — readinessScore is not a
      // valid workflow-stage metric.
      const tendersPageSrc = readFileSync("app/dashboard/tenders/page.tsx", "utf8");
      assert.doesNotMatch(tendersPageSrc, /bg-slate-400.*style=\{\{ width/);
      assert.doesNotMatch(tendersPageSrc, /width:\s*`\$\{tender\.readinessScore\}%`/);
    });

    it("tenders page 'AI' analysis-source badge uses neutral slate (not green)", () => {
      const tendersPageSrc = readFileSync("app/dashboard/tenders/page.tsx", "utf8");
      // The AI badge is the analysis SOURCE, not a readiness/Clear verdict.
      // Must not use emerald/green styling. Check that no AI badge uses
      // emerald colors — there are multiple render paths (table + card).
      const aiBadgeMatches = tendersPageSrc.match(/title="[^"]*AI[^"]*"\s*>\s*AI\s*</g) ?? [];
      for (const m of aiBadgeMatches) {
        assert.doesNotMatch(
          m,
          /emerald/i,
          `AI badge must not use emerald/green styling. Found: ${m}`,
        );
      }
      assert.match(tendersPageSrc, /bg-slate-100 px-1 py-0.5 text-\[10px\] font-semibold text-slate-600/);
    });

    it("tenders page documents the bar removal in a code comment", () => {
      const tendersPageSrc = readFileSync("app/dashboard/tenders/page.tsx", "utf8");
      assert.match(tendersPageSrc, /Workflow progress bar REMOVED/);
    });

    it("compliance dashboard has no Clear/classifyTender/readinessScore wording", () => {
      // The compliance dashboard was already clean — verify it stays clean.
      assert.doesNotMatch(complianceSrc, /✓ Clear/);
      assert.doesNotMatch(complianceSrc, /classifyTenderExtractionState/);
      assert.doesNotMatch(complianceSrc, /classifyTenderCurrentnessBatch/);
    });
  });

  describe("AI environment readiness production path (effective timeout invariant assertion)", () => {
    it("imports effective timeout values from lib/timeout-config.ts", () => {
      // Readiness validates the EFFECTIVE values, not raw env presence.
      assert.match(aiEnvSrc, /from "\.\/timeout-config"/);
      assert.match(aiEnvSrc, /AI_ANALYSIS_TIMEOUT_MS/);
      assert.match(aiEnvSrc, /AI_PROPOSAL_TIMEOUT_MS/);
      assert.match(aiEnvSrc, /PROPOSAL_SECTION_TIMEOUT_MS/);
    });

    it("defines supported timeout ranges for each required timeout", () => {
      assert.match(aiEnvSrc, /SUPPORTED_TIMEOUT_RANGES/);
      assert.match(aiEnvSrc, /AI_ANALYSIS_TIMEOUT_MS":\s*\{\s*min:\s*5_000/);
      assert.match(aiEnvSrc, /AI_PROPOSAL_TIMEOUT_MS":\s*\{\s*min:\s*10_000/);
      assert.match(aiEnvSrc, /PROPOSAL_SECTION_TIMEOUT_MS":\s*\{\s*min:\s*5_000/);
    });

    it("validates effective values against the supported range", () => {
      assert.match(aiEnvSrc, /effective < range\.min/);
      assert.match(aiEnvSrc, /effective > range\.max/);
    });

    it("does NOT check raw env presence for timeouts (uses effective values)", () => {
      assert.doesNotMatch(aiEnvSrc, /present\("AI_ANALYSIS_TIMEOUT_MS"\)/);
      assert.doesNotMatch(aiEnvSrc, /present\("AI_PROPOSAL_TIMEOUT_MS"\)/);
      assert.doesNotMatch(aiEnvSrc, /present\("PROPOSAL_SECTION_TIMEOUT_MS"\)/);
    });

    it("documents itself as an invariant assertion, NOT raw env validation", () => {
      assert.match(aiEnvSrc, /INVARIANT ASSERTION/);
      assert.match(aiEnvSrc, /NOT a raw environment validation/);
      assert.match(aiEnvSrc, /centralized module already clamps\/falls back/);
    });

    it("ready === true when env vars are absent (effective defaults are valid)", () => {
      const saved: Record<string, string | undefined> = {
        AI_ANALYSIS_TIMEOUT_MS: process.env.AI_ANALYSIS_TIMEOUT_MS,
        AI_PROPOSAL_TIMEOUT_MS: process.env.AI_PROPOSAL_TIMEOUT_MS,
        PROPOSAL_SECTION_TIMEOUT_MS: process.env.PROPOSAL_SECTION_TIMEOUT_MS,
      };
      delete process.env.AI_ANALYSIS_TIMEOUT_MS;
      delete process.env.AI_PROPOSAL_TIMEOUT_MS;
      delete process.env.PROPOSAL_SECTION_TIMEOUT_MS;
      try {
        const r = getAIEnvironmentReadiness();
        const timeoutBlockers = r.blockers.filter((b) =>
          /AI_ANALYSIS_TIMEOUT_MS|AI_PROPOSAL_TIMEOUT_MS|PROPOSAL_SECTION_TIMEOUT_MS/.test(b),
        );
        assert.equal(
          timeoutBlockers.length,
          0,
          `there must be NO timeout blockers when env vars are absent (effective defaults are valid). Got: ${JSON.stringify(timeoutBlockers)}`,
        );
      } finally {
        for (const [k, v] of Object.entries(saved)) {
          if (v !== undefined) process.env[k] = v;
        }
      }
    });
  });

  describe("System readiness production path for upload-and-continue automation", () => {
    it("requires automated worker authentication for production readiness", () => {
      assert.match(systemSrc, /key: "worker_auth"[\s\S]*?requiredForProduction: true/);
    });

    it("title reflects operational (not security) rationale", () => {
      assert.match(systemSrc, /Background worker automated-call authentication/);
    });

    it("documents the requireRole fallback (not public unauthenticated)", () => {
      assert.match(systemSrc, /requireRole\("ADMIN", "PROPOSAL_MANAGER"\)|requireRole\(ADMIN, PROPOSAL_MANAGER\)/);
      assert.match(systemSrc, /It falls back/i);
    });

    it("does NOT claim the endpoint is unauthenticated when secrets are absent", () => {
      assert.doesNotMatch(systemSrc, /endpoints are unauthenticated/);
    });

    it("returns CRITICAL in production when no secret because continuations would stall", async () => {
      const savedNodeEnv = process.env.NODE_ENV;
      const savedVercelEnv = process.env.VERCEL_ENV;
      const savedWorker = process.env.AI_JOBS_WORKER_SECRET;
      const savedCron = process.env.CRON_SECRET;
      Reflect.set(process.env, "NODE_ENV", "production");
      delete process.env.VERCEL_ENV;
      delete process.env.AI_JOBS_WORKER_SECRET;
      delete process.env.CRON_SECRET;
      try {
        const r = await getSystemReadiness();
        const workerCheck = r.checks.find((c) => c.key === "worker_auth");
        assert.equal(workerCheck?.severity, "CRITICAL");
        assert.equal(workerCheck?.requiredForProduction, true);
        assert.equal(r.productionReady, false);
      } finally {
        Reflect.set(process.env, "NODE_ENV", savedNodeEnv ?? "test");
        if (savedVercelEnv !== undefined) process.env.VERCEL_ENV = savedVercelEnv;
        if (savedWorker !== undefined) process.env.AI_JOBS_WORKER_SECRET = savedWorker;
        if (savedCron !== undefined) process.env.CRON_SECRET = savedCron;
      }
    });
  });

  describe("readinessScore is NOT displayed as workflow progress (recheck 9 item #1)", () => {
    it("dashboard Live Pipeline has NO Workflow % column", () => {
      assert.doesNotMatch(dashboardSrc, /Workflow %/);
      assert.doesNotMatch(dashboardSrc, /workflowPct/);
      assert.doesNotMatch(dashboardSrc, /workflowBarColor/);
    });

    it("dashboard does NOT select readinessScore for the Live Pipeline table", () => {
      // The recentTenders query must NOT select readinessScore — it's not
      // a valid workflow-stage metric.
      assert.doesNotMatch(dashboardSrc, /readinessScore: true/);
    });

    it("tenders page has NO Workflow Progress column header", () => {
      const tendersPageSrc = readFileSync("app/dashboard/tenders/page.tsx", "utf8");
      assert.doesNotMatch(tendersPageSrc, /Workflow Progress/);
    });

    it("tenders page does NOT display readinessScore as a percentage", () => {
      const tendersPageSrc = readFileSync("app/dashboard/tenders/page.tsx", "utf8");
      // The percentage display was removed — no {readinessScore}% rendering.
      assert.doesNotMatch(tendersPageSrc, /\{tender\.readinessScore\}%/);
    });

    it("tenders page does NOT render a readinessScore progress bar", () => {
      const tendersPageSrc = readFileSync("app/dashboard/tenders/page.tsx", "utf8");
      // The progress bar div was removed entirely.
      assert.doesNotMatch(tendersPageSrc, /width:\s*`\$\{tender\.readinessScore\}%`/);
    });

    it("tenders page sort options do NOT include readinessScore (recheck 10 item #1)", () => {
      const tendersPageSrc = readFileSync("app/dashboard/tenders/page.tsx", "utf8");
      // readinessScore sorting was removed entirely — it's not a valid
      // ordering authority.
      assert.doesNotMatch(tendersPageSrc, /readinessScore_desc/);
      assert.doesNotMatch(tendersPageSrc, /readinessScore_asc/);
      assert.doesNotMatch(tendersPageSrc, /Readiness score \(high\)/);
      assert.doesNotMatch(tendersPageSrc, /Readiness score \(low\)/);
      assert.doesNotMatch(tendersPageSrc, /Workflow Progress \(high\)/);
      assert.doesNotMatch(tendersPageSrc, /Workflow Progress \(low\)/);
    });
  });

  describe("PROVISIONAL_NOT_BLOCKED is never treated as canonical readiness (recheck 9 item #4)", () => {
    it("dashboard never renders 'Clear' wording for PROVISIONAL_NOT_BLOCKED", () => {
      assert.doesNotMatch(dashboardSrc, /✓ Clear/);
      assert.match(dashboardSrc, /<AlertCircleIcon \/> Provisional/);
    });

    it("analysis page never renders 'Clear' wording for PROVISIONAL_NOT_BLOCKED", () => {
      assert.doesNotMatch(analysisSrc, /✓ Clear/);
      assert.match(analysisSrc, /Provisional/);
    });

    it("tenders page never renders 'Clear' wording", () => {
      const tendersPageSrc = readFileSync("app/dashboard/tenders/page.tsx", "utf8");
      assert.doesNotMatch(tendersPageSrc, /✓ Clear/);
    });

    it("compliance dashboard never renders 'Clear' wording", () => {
      assert.doesNotMatch(complianceSrc, /✓ Clear/);
    });

    it("no consumer file contains 'CANONICAL_CLEAR' (old verdict name)", () => {
      // The old verdict name was CANONICAL_CLEAR — it must not appear in any
      // consumer file. Only lib/engine/tender-currentness.ts may reference it
      // in comments documenting the rename.
      assert.doesNotMatch(dashboardSrc, /CANONICAL_CLEAR/);
      assert.doesNotMatch(analysisSrc, /CANONICAL_CLEAR/);
      assert.doesNotMatch(complianceSrc, /CANONICAL_CLEAR/);
      const tendersPageSrc = readFileSync("app/dashboard/tenders/page.tsx", "utf8");
      assert.doesNotMatch(tendersPageSrc, /CANONICAL_CLEAR/);
    });
  });

  describe("Recheck 10 — duplicate controls, command center, lockfile", () => {
    it("tenders page does NOT have a duplicate server GET search form", () => {
      const tendersPageSrc = readFileSync("app/dashboard/tenders/page.tsx", "utf8");
      // The server GET form was removed — TenderSearchBar is the single
      // search authority.
      assert.doesNotMatch(tendersPageSrc, /<form className="flex-1" method="GET">/);
    });

    it("tenders page does NOT have duplicate status chips", () => {
      const tendersPageSrc = readFileSync("app/dashboard/tenders/page.tsx", "utf8");
      // STATUS_FILTERS chips were removed — TenderSearchBar's dropdown is
      // the single status-filter authority.
      assert.doesNotMatch(tendersPageSrc, /STATUS_FILTERS/);
    });

    it("tenders page has exactly one TenderSearchBar", () => {
      const tendersPageSrc = readFileSync("app/dashboard/tenders/page.tsx", "utf8");
      const matches = tendersPageSrc.match(/<TenderSearchBar/g) ?? [];
      assert.equal(matches.length, 1, `expected exactly 1 TenderSearchBar, got ${matches.length}`);
    });

    it("tenders page does NOT select readinessScore in any query", () => {
      const tendersPageSrc = readFileSync("app/dashboard/tenders/page.tsx", "utf8");
      assert.doesNotMatch(tendersPageSrc, /readinessScore: true/);
    });

    it("command center does NOT display 'Legacy workflow score' to users", () => {
      const ccSrc = readFileSync("app/dashboard/tenders/[id]/command-center/page.tsx", "utf8");
      // The rendered text must not include "Legacy workflow score" — only
      // a code comment mentioning the removal is allowed.
      assert.doesNotMatch(ccSrc, />Legacy workflow score/);
      assert.doesNotMatch(ccSrc, /Legacy workflow score:/);
    });

    it("command center does NOT say 'Export gate clear' from openHigh alone", () => {
      const ccSrc = readFileSync("app/dashboard/tenders/[id]/command-center/page.tsx", "utf8");
      // The caption must be "No HIGH objections", not "Export gate clear".
      assert.doesNotMatch(ccSrc, /Export gate clear/);
      assert.match(ccSrc, /No HIGH objections/);
    });

    it("command center Documents card reads readiness ONLY from the canonical Tender Release State (no local filtering or re-derived counts)", () => {
      const ccSrc = readFileSync("app/dashboard/tenders/[id]/command-center/page.tsx", "utf8");
      // The Documents card's blocker/readiness caption must come from the
      // canonical releaseState (lib/engine/tender-release-state.ts), not a
      // second, locally re-derived export-ready/final-candidate split.
      assert.match(ccSrc, /releaseState\.blockerTotal/);
      assert.match(ccSrc, /releaseState\.criticalBlockerTotal/);
      // Must NOT import or use local document filtering helpers.
      assert.doesNotMatch(ccSrc, /from ["']\.\.\/.+lib\/engine\/document-output-state["']/);
      assert.doesNotMatch(ccSrc, /filterFinalExportCandidateDocuments/);
      assert.doesNotMatch(ccSrc, /isExportReady/);
      // Must NOT use a local ACTIVE_DOC_STATUSES vocabulary.
      assert.doesNotMatch(ccSrc, /ACTIVE_DOC_STATUSES/);
      // Must fail closed when the canonical release state is unavailable.
      assert.match(ccSrc, /Canonical readiness unavailable/);
      assert.match(ccSrc, /releaseState\s*\?\s*[\s\S]*?:\s*"Canonical readiness unavailable"/);
    });

    it("command center AI jobs section is labelled 'Historical' (not current state)", () => {
      const ccSrc = readFileSync("app/dashboard/tenders/[id]/command-center/page.tsx", "utf8");
      assert.match(ccSrc, /Historical background AI jobs/);
      assert.match(ccSrc, /History only/);
    });

    it("command center AI jobs use neutral slate for SUCCEEDED (not green)", () => {
      const ccSrc = readFileSync("app/dashboard/tenders/[id]/command-center/page.tsx", "utf8");
      // No green-100/green-700 for job status badges — historical success
      // does not define current canonical state.
      assert.doesNotMatch(ccSrc, /bg-green-100 text-green-700/);
    });

    it("package-lock.json has NO diff vs authorized base (fsevents optional:true preserved)", () => {
      // Verify the fsevents 2.3.2 entry still has "optional": true — the
      // unauthorized lockfile change removed it. We check the specific
      // entry to avoid greedy regex matching across the whole file.
      const lockSrc = readFileSync("package-lock.json", "utf8");
      // Find the playwright fsevents 2.3.2 block and verify optional:true is present.
      const fseventsBlock = lockSrc.match(/"node_modules\/playwright\/node_modules\/fsevents":\s*\{[^}]*\}/);
      assert.ok(fseventsBlock, "playwright fsevents block must exist");
      assert.match(fseventsBlock[0], /"optional": true/, 'fsevents 2.3.2 must have "optional": true (unauthorized lockfile change reverted)');
    });
  });
});
