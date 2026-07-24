import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import { logger } from "../../../../lib/observability";
import { isDeepReasoningEnabled, isToolUseGenerationEnabled } from "../../../../lib/engine/feature-flags";
import { isAIEnabled, isClaudeEnabled, isOpenAIEnabled } from "../../../../lib/ai";
import { getComprehensionCache } from "../../../../lib/engine/comprehension-cache";
import { findStuckJobs, AI_JOB_STUCK_AFTER_MS } from "../../../../lib/ai-jobs";

/**
 * Diagnostic endpoint — reports deep-reasoning configuration and
 * provider status. Mirrors the shape of `/api/system/readiness` and
 * is intended for operators to verify their environment before
 * turning the flag on for production tenders.
 *
 * Auth: any logged-in user. The response contains only environment
 * state (flag values, provider availability) — no tender data, no
 * secrets, no AI keys. Safe to expose to all roles.
 *
 * Schema:
 *   {
 *     deepReasoning: {
 *       enabled: boolean,            // TENDER_DEEP_REASONING truthy?
 *       toolUseAvailable: boolean,   // @anthropic-ai/sdk importable + Claude key set?
 *       costGuard: {
 *         maxCallsPerTender: number | null,  // TENDER_DEEP_REASONING_MAX_CALLS
 *         enforced: boolean,
 *       },
 *     },
 *     providers: {
 *       claude: { configured: boolean, models: string[] },
 *       gemini: { configured: boolean, model: string | null },
 *       openai: { configured: boolean, model: string | null },
 *     },
 *     capabilities: {
 *       semanticComprehension: boolean,  // ON when flag + AI both set
 *       semanticAlignment: boolean,
 *       criticRewriter: boolean,
 *       toolUseInCritique: boolean,
 *       constraintValidator: boolean,    // always true — deterministic
 *     },
 *   }
 *
 * When `enabled` is true but `providers.*.configured` are all false,
 * the deep-reasoning path will no-op silently and the legacy
 * pipeline will run instead — this is the most common
 * misconfiguration surfaced here.
 */
export async function GET() {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const enabled = isDeepReasoningEnabled();
  const toolUseGenerationFlag = isToolUseGenerationEnabled();
  const aiEnabled = isAIEnabled();
  const claudeConfigured = isClaudeEnabled();
  const geminiConfigured = Boolean(process.env.GEMINI_API_KEY);
  const openaiConfigured = isOpenAIEnabled();
  const generationMode = (process.env.PROPOSAL_GENERATION_MODE || "parallel").toLowerCase();

  let toolUseAvailable = false;
  if (claudeConfigured) {
    try {
      // Check the SDK is importable without actually loading it permanently.
      require.resolve("@anthropic-ai/sdk");
      toolUseAvailable = true;
    } catch {
      toolUseAvailable = false;
    }
  }

  const claudeModelsRaw = process.env.ANTHROPIC_PROPOSAL_MODELS;
  const claudeModels = claudeModelsRaw
    ? claudeModelsRaw.split(",").map((m) => m.trim()).filter(Boolean)
    : ["claude-sonnet-4-5", "claude-opus-4-1", "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"];

  const maxCallsRaw = process.env.TENDER_DEEP_REASONING_MAX_CALLS;
  const maxCallsParsed = maxCallsRaw ? Number(maxCallsRaw) : null;
  const maxCallsPerTender = maxCallsParsed && Number.isFinite(maxCallsParsed) && maxCallsParsed > 0 ? maxCallsParsed : null;

  return NextResponse.json({
    deepReasoning: {
      enabled,
      toolUseAvailable,
      costGuard: {
        maxCallsPerTender,
        enforced: maxCallsPerTender !== null,
      },
    },
    providers: {
      claude: {
        configured: claudeConfigured,
        models: claudeConfigured ? claudeModels : [],
      },
      gemini: {
        configured: geminiConfigured,
        model: geminiConfigured ? (process.env.GEMINI_MODEL ?? "gemini-2.5-pro") : null,
      },
      openai: {
        configured: openaiConfigured,
        model: openaiConfigured ? (process.env.OPENAI_PROPOSAL_MODEL ?? "gpt-4o") : null,
      },
    },
    capabilities: {
      semanticComprehension: enabled && aiEnabled,
      semanticAlignment: enabled && aiEnabled,
      criticRewriter: enabled && aiEnabled,
      toolUseInCritique: enabled && claudeConfigured && toolUseAvailable,
      // Tool-use during generation requires three preconditions:
      // both feature flags ON, the Anthropic SDK importable + key set,
      // and the single-call generation mode (the parallel section
      // path is not yet wired for tools).
      toolUseInGeneration: enabled && toolUseGenerationFlag && claudeConfigured && toolUseAvailable && generationMode === "single",
      // Constraint validator is pure-code deterministic — works even
      // when AI is unavailable, but only produces violations when the
      // comprehension extractor has populated rules (which requires
      // both the flag and AI to be set).
      constraintValidator: true,
    },
    flags: {
      tenderDeepReasoning: enabled,
      tenderToolUseGeneration: toolUseGenerationFlag,
      proposalGenerationMode: generationMode,
    },
    // Round 7 — in-memory comprehension cache stats. Hit rate
    // surfaces how much AI cost the cache is saving on repeated
    // extractions. Resets on process restart (each Vercel function
    // invocation gets its own counter — long-lived warm starts
    // will show higher hit rates than cold starts).
    comprehensionCache: getComprehensionCache().getStats(),
    // Round 12 — stuck-job recovery. Surfaces background jobs that
    // have been RUNNING longer than the stuck-threshold. Each entry
    // in `sample` is a candidate for the
    // POST /api/admin/release-stuck-jobs admin endpoint. The lazy-
    // recovery hook on /api/ai-jobs/[id] already auto-fails these
    // on read, but the diagnostic surface lets operators see them
    // BEFORE the user polls the affected job.
    stuckJobs: await (async () => {
      try {
        const result = await findStuckJobs({ limit: 5 });
        return {
          count: result.count,
          stuckAfterMs: AI_JOB_STUCK_AFTER_MS,
          sample: result.jobs.map((j) => ({
            id: j.id,
            jobType: j.jobType,
            stuckForMs: j.startedAt ? Date.now() - j.startedAt.getTime() : null,
          })),
        };
      } catch (e) {
        // Stuck-job query failed — return degraded data but log the underlying
        // DB error so operators can detect ai-jobs DB outages. Previously
        // bare `catch {}` with a string error field only — no log signal.
        logger.error("[deep-reasoning-status] stuck-job query failed", { detail: e });
        return { count: 0, stuckAfterMs: AI_JOB_STUCK_AFTER_MS, sample: [], error: "stuck-job query failed" };
      }
    })(),
  });
}
