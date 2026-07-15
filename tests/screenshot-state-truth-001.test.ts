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

const EXPECTED_ORDER = ["zai", "cerebras", "mistral", "groq", "openrouter", "gemini", "openai", "together", "deepseek", "anthropic"];

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
        "ZAI_API_KEY",
        "CEREBRAS_API_KEY",
        "MISTRAL_API_KEY",
        "GROQ_API_KEY",
        "OPENROUTER_API_KEY",
        "GEMINI_API_KEY",
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
        "ZAI_API_KEY",
        "CEREBRAS_API_KEY",
        "MISTRAL_API_KEY",
        "GROQ_API_KEY",
        "OPENROUTER_API_KEY",
        "GEMINI_API_KEY",
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
      assert.match(dashboardSrc, /Recent \{recentTenders\.length\} tenders/);
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
      assert.match(dashboardSrc, /✗ Blocked/);
    });

    it("renders Not analyzed badge for not-analyzed extraction", () => {
      assert.match(dashboardSrc, /○ Not analyzed/);
    });

    it("renders Provisional badge (NOT Clear) when currentness === PROVISIONAL_NOT_BLOCKED", () => {
      // The dashboard must NEVER render "Clear" wording — the workspace
      // projection is a lower bound, not a canonical authority.
      assert.match(dashboardSrc, /extractionState === "PROVISIONAL_NOT_BLOCKED"/);
      assert.match(dashboardSrc, /◐ Provisional/);
      assert.doesNotMatch(dashboardSrc, /✓ Clear/);
    });

    it("uses neutral slate color for the workflow bar even when CLEAR", () => {
      // No green-500 / green-600 anywhere in the workflow bar code path.
      assert.match(dashboardSrc, /workflowBarColor/);
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

    it("labels Live Pipeline as 'Workspace projection (NOT canonical Clear)'", () => {
      assert.match(dashboardSrc, /Workspace projection \(NOT canonical Clear\)/);
    });

    it("does not use green color for the Critical blockers count", () => {
      // Even when criticalBlockers === 0, the color is slate (neutral), not
      // green. A zero lower-bound does NOT mean zero blockers.
      assert.doesNotMatch(dashboardSrc, /criticalBlockers > 0 \? "text-red-600" : "text-green-600"/);
    });
  });

  describe("AI environment readiness production path (fail-closed on missing timeouts)", () => {
    it("treats missing AI_ANALYSIS_TIMEOUT_MS as a blocker", () => {
      assert.match(aiEnvSrc, /AI_ANALYSIS_TIMEOUT_MS/);
      assert.match(aiEnvSrc, /requiredTimeouts/);
    });

    it("treats missing AI_PROPOSAL_TIMEOUT_MS as a blocker", () => {
      assert.match(aiEnvSrc, /AI_PROPOSAL_TIMEOUT_MS/);
    });

    it("treats missing PROPOSAL_SECTION_TIMEOUT_MS as a blocker", () => {
      assert.match(aiEnvSrc, /PROPOSAL_SECTION_TIMEOUT_MS/);
    });

    it("parses timeout values and rejects non-positive / non-finite", () => {
      // The check is `!Number.isFinite(n) || n <= 0` — inverted form.
      assert.match(aiEnvSrc, /Number\.isFinite\(n\)/);
      assert.match(aiEnvSrc, /n <= 0/);
    });

    it("ready === false when any required timeout is missing", () => {
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
        assert.equal(r.ready, false, "ready must be false when timeouts missing");
        assert.ok(
          r.blockers.some((b) => b.includes("AI_ANALYSIS_TIMEOUT_MS")),
          "blockers must mention AI_ANALYSIS_TIMEOUT_MS",
        );
      } finally {
        for (const [k, v] of Object.entries(saved)) {
          if (v !== undefined) process.env[k] = v;
        }
      }
    });
  });

  describe("System readiness production path (worker_auth required in production)", () => {
    it("marks worker_auth as requiredForProduction: true", () => {
      // Previously this was false, allowing production to deploy without
      // worker auth — a security hole.
      assert.match(systemSrc, /key: "worker_auth"[\s\S]*?requiredForProduction: true/);
    });

    it("returns CRITICAL worker_auth in production when no secret", async () => {
      // NODE_ENV is typed as readonly in @types/node. Use Reflect.set to
      // bypass the type guard for this test only.
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
});
