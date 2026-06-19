import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import {
  isProviderCooledDown,
  getProviderRuntimeSnapshot,
  isDeepSeekConfigured,
  deepSeekOfficialEnvPresent,
  getDeepSeekModel,
  isMistralConfigured,
  getMistralProposalModel,
  getMistralAnalysisModel,
  isGroqConfigured,
  getGroqModel,
  isTogetherConfigured,
  getTogetherProposalModel,
  getTogetherAnalysisModel,
  getTogetherFastModel,
  isOpenRouterConfigured,
  getOpenRouterModel,
  type AiProviderName,
} from "../../../../lib/ai-provider-health";
import { restoreHealthFromDb } from "../../../../lib/ai-provider-health-db";

// Canonical fallback order surfaced to operators. Must match lib/ai.ts PROVIDER_CHAINS.
// Claude is placed LAST so Anthropic rate limits do not block other providers.
const AI_FALLBACK_CHAIN = "Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Claude → deterministic draft fallback";
const AI_FALLBACK_CHAIN_EXTRACTION = AI_FALLBACK_CHAIN;

export const dynamic = "force-dynamic";
export const maxDuration = 10;

function present(value: string | undefined) {
  return Boolean(value && value.trim().length > 0);
}

function splitModels(value: string | undefined, fallback: string[]) {
  const models = (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return models.length > 0 ? models : fallback;
}

function maskModelChain(models: string[]) {
  return models.map((model) => model.replace(/\s+/g, " ").trim()).filter(Boolean);
}

async function restoreProviderHealthBeforeResponse(): Promise<string | null> {
  try {
    const result = await Promise.race([
      restoreHealthFromDb(),
      new Promise<{ warning: string }>((resolve) => setTimeout(() => resolve({ warning: "Provider health DB restore timed out; using in-memory provider health for this response." }), 2_000)),
    ]);
    return result.warning ?? null;
  } catch {
    return "Provider health DB restore failed; using in-memory provider health for this response.";
  }
}

export async function GET() {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Merge persisted cross-instance health before computing cooldowns. The DB
  // snapshot is authoritative when it is newer or carries a more restrictive
  // active cooldown; failures are non-fatal and only add a safe warning.
  const providerHealthRestoreWarning = await restoreProviderHealthBeforeResponse();

  const claudeConfigured = present(process.env.ANTHROPIC_API_KEY);
  const geminiConfigured = present(process.env.GEMINI_API_KEY);
  const openaiConfigured = present(process.env.OPENAI_API_KEY);
  const deepSeekConfigured = isDeepSeekConfigured();
  const mistralConfigured = isMistralConfigured();
  const groqConfigured = isGroqConfigured();
  const togetherConfigured = isTogetherConfigured();
  const openRouterConfigured = isOpenRouterConfigured();

  // Configuration/preference reflect the WHOLE chain: any one configured
  // provider is valid (Groq-only or OpenRouter-only deployments are valid).
  // The response success flag is downgraded later only when every configured
  // provider is actively cooling down.
  const anyConfigured =
    claudeConfigured || geminiConfigured || openaiConfigured || mistralConfigured || deepSeekConfigured || groqConfigured || togetherConfigured || openRouterConfigured;
  // preferredProvider reflects the actual default chain order (Claude is last)
  const preferredProvider =
    mistralConfigured ? "mistral"
    : groqConfigured ? "groq"
    : openRouterConfigured ? "openrouter"
    : geminiConfigured ? "gemini"
    : openaiConfigured ? "openai"
    : togetherConfigured ? "together"
    : deepSeekConfigured ? "deepseek"
    : claudeConfigured ? "claude"
    : "none";

  const claudeModels = splitModels(process.env.ANTHROPIC_PROPOSAL_MODELS, ["claude-sonnet-4-5", "claude-opus-4-1", "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"]);
  const geminiModels = splitModels(process.env.GEMINI_FALLBACK_MODELS, ["gemini-2.5-flash", "gemini-2.0-flash"]);
  const warnings: string[] = [];
  const blockers: string[] = [];
  if (providerHealthRestoreWarning) warnings.push(providerHealthRestoreWarning);

  // Only a TRUE blocker when NO provider at all is configured.
  if (!anyConfigured) {
    blockers.push("No AI provider key is configured. Set OPENAI_API_KEY, GEMINI_API_KEY, MISTRAL_API_KEY, DEEPSEEK_API_KEY, GROQ_API_KEY, TOGETHER_API_KEY, OPENROUTER_API_KEY, or ANTHROPIC_API_KEY. AI analysis/generation will use the deterministic fallback, which cannot be exported as final.");
  }
  if (claudeConfigured && claudeModels.length === 0) warnings.push("Claude is configured but no Claude model chain was resolved.");
  if (geminiConfigured && !present(process.env.GEMINI_MODEL)) warnings.push("GEMINI_MODEL is not set; the app will use its built-in Gemini default.");
  if (deepSeekConfigured && !deepSeekOfficialEnvPresent()) warnings.push("DeepSeek is enabled via a fallback alias env var. Rename it to DEEPSEEK_API_KEY (the official variable) in Vercel.");

  // Cooldown notice — purely advisory; the chain skips cooled-down providers.
  // Iterate providers in the canonical runtime chain order so warnings and
  // diagnostics surface in the same order as lib/ai.ts CANONICAL_PROVIDER_CHAIN.
  const allProviderNames: AiProviderName[] = ["mistral", "groq", "openrouter", "gemini", "openai", "together", "deepseek", "anthropic"];
  const cooling = allProviderNames.filter(isProviderCooledDown);
  if (cooling.length > 0) {
    warnings.push(`Provider(s) in cooldown: ${cooling.join(", ")}. Requests skip cooled-down providers until the window expires.`);
  }

  // Configured ≠ runtime-verified. Distinguish keys-present-but-never-used
  // from keys-present-AND-recently-succeeded. Production screenshots showed
  // a "READY" pill while AI Analyze had actually fallen through to regex.
  const configuredMap: Record<AiProviderName, boolean> = {
    mistral: mistralConfigured, groq: groqConfigured, openrouter: openRouterConfigured,
    gemini: geminiConfigured, openai: openaiConfigured, together: togetherConfigured,
    deepseek: deepSeekConfigured, anthropic: claudeConfigured,
  };
  const configuredNames = allProviderNames.filter((n) => configuredMap[n]);
  const providerRuntime = Object.fromEntries(allProviderNames.map((n) => [n, getProviderRuntimeSnapshot(n)])) as Record<AiProviderName, ReturnType<typeof getProviderRuntimeSnapshot>>;
  const anyHasRecentSuccess = configuredNames.some((n) => Boolean(providerRuntime[n].lastSuccessAt));
  // `configuredProvidersAvailable` reflects the chain scheduler's view
  // (configured + not currently cooling). It is NOT a health statement — a
  // provider can be "available" here while still being in the `configured`
  // (not yet runtime_verified) state. UI and health checks must use the
  // per-provider `status` field surfaced via `runtime.status`.
  const configuredProvidersAvailable = configuredNames.filter((n) => providerRuntime[n].available);
  const allConfiguredCooling = anyConfigured && configuredNames.every((n) => providerRuntime[n].coolingDown);
  if (allConfiguredCooling) warnings.push("All configured AI providers are currently in cooldown. AI Analyze will fall back to regex (UNAPPROVED) until a provider's cooldown expires. Next action: wait for the earliest cooldown window to expire or reset provider health after fixing the upstream limit.");
  if (anyConfigured && !anyHasRecentSuccess) warnings.push("AI providers are configured but no successful response has been recorded on this serverless instance yet — runtime availability is not verified.");
  // Surface a structured "no AI provider ready" signal so callers can branch
  // without re-deriving the condition. ok=false here does NOT change the HTTP
  // status — /api/ai/health is a metadata endpoint and must remain 200 so the
  // dashboard can render the panel even when AI is unusable. The actual
  // hard-error path lives in lib/ai.ts (NoAiProviderReadyError) for AI calls.
  const noAiProviderReady = !anyConfigured || allConfiguredCooling || !anyHasRecentSuccess;

  const openaiModel = process.env.OPENAI_PROPOSAL_MODEL || "gpt-4o";

  return NextResponse.json({
    success: anyConfigured && !allConfiguredCooling,
    ok: !noAiProviderReady,
    configuredProviderCount: configuredNames.length,
    availableProviderCount: configuredProvidersAvailable.length,
    allProvidersCooling: allConfiguredCooling,
    runtimeVerified: anyHasRecentSuccess,
    // `providers` is ordered by the canonical runtime chain
    // (Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Claude),
    // followed by the deterministic draft fallback as a final non-AI entry.
    // Each provider entry surfaces `runtime.status` (the unified operator-facing
    // enum) so the dashboard can render pills without re-deriving state.
    providers: {
      mistral: {
        configured: mistralConfigured,
        envPresent: mistralConfigured,
        model: getMistralProposalModel(),
        fallbackRank: 1,
        label: "Mistral",
        note: "First-tier provider (canonical chain) — used for analysis, extraction, proposal, validation",
        analysisModel: getMistralAnalysisModel(),
        runtime: providerRuntime.mistral,
        status: providerRuntime.mistral.status,
        isAi: true,
      },
      groq: {
        configured: groqConfigured,
        envPresent: groqConfigured,
        model: getGroqModel(),
        fallbackRank: 2,
        label: "Groq",
        note: "Second-tier provider (canonical chain)",
        runtime: providerRuntime.groq,
        status: providerRuntime.groq.status,
        isAi: true,
      },
      openrouter: {
        configured: openRouterConfigured,
        envPresent: openRouterConfigured,
        model: getOpenRouterModel(),
        fallbackRank: 3,
        label: "OpenRouter",
        note: "Third-tier aggregator provider (canonical chain)",
        runtime: providerRuntime.openrouter,
        status: providerRuntime.openrouter.status,
        isAi: true,
      },
      gemini: {
        configured: geminiConfigured,
        envPresent: geminiConfigured,
        model: process.env.GEMINI_MODEL || "gemini-2.5-pro",
        fallbackRank: 4,
        label: "Gemini",
        note: "Fourth-tier provider (canonical chain for analysis, extraction, proposal, validation, and fast use cases)",
        primaryModel: process.env.GEMINI_MODEL || "gemini-2.5-pro",
        fallbackModels: maskModelChain(geminiModels),
        extractionModel: process.env.GEMINI_EXTRACTION_MODEL || process.env.GEMINI_EXTRACT_MODEL || null,
        runtime: providerRuntime.gemini,
        status: providerRuntime.gemini.status,
        isAi: true,
      },
      openai: {
        configured: openaiConfigured,
        envPresent: openaiConfigured,
        model: openaiModel,
        fallbackRank: 5,
        label: "OpenAI",
        note: "Fifth-tier provider (canonical chain)",
        runtime: providerRuntime.openai,
        status: providerRuntime.openai.status,
        isAi: true,
      },
      together: {
        configured: togetherConfigured,
        envPresent: togetherConfigured,
        model: getTogetherProposalModel(),
        fallbackRank: 6,
        label: "Together",
        note: "Sixth-tier provider (canonical chain)",
        analysisModel: getTogetherAnalysisModel(),
        fastModel: getTogetherFastModel(),
        runtime: providerRuntime.together,
        status: providerRuntime.together.status,
        isAi: true,
      },
      deepseek: {
        configured: deepSeekConfigured,
        envPresent: deepSeekOfficialEnvPresent(),
        model: getDeepSeekModel(),
        fallbackRank: 7,
        label: "DeepSeek",
        note: "Seventh-tier provider (canonical chain)",
        runtime: providerRuntime.deepseek,
        status: providerRuntime.deepseek.status,
        isAi: true,
      },
      claude: {
        configured: claudeConfigured,
        envPresent: claudeConfigured,
        model: claudeModels[0] ?? null,
        fallbackRank: 8,
        label: "Claude",
        note: "Eighth-tier (last) AI provider — placed last to avoid Anthropic rate-limit blocking",
        tier: process.env.ANTHROPIC_TIER || null,
        proposalModels: maskModelChain(claudeModels),
        maxOutputTokens: Number(process.env.ANTHROPIC_MAX_OUTPUT_TOKENS || 0) || null,
        runtime: providerRuntime.anthropic,
        status: providerRuntime.anthropic.status,
        isAi: true,
      },
      deterministic: {
        // Final non-AI fallback — NOT an AI provider. Surfaced so operators
        // can see in the same panel that the deterministic draft fallback is
        // what runs after every configured AI provider has failed. Its output
        // is never exportable as a final proposal.
        configured: true,
        envPresent: true,
        model: null,
        fallbackRank: 9,
        label: "Deterministic draft fallback",
        note: "Final non-AI fallback. Runs only after every configured AI provider has failed, returned no usable result, or is in cooldown. Output is never exportable as a final proposal.",
        runtime: {
          lastSuccessAt: null,
          lastFailureAt: null,
          lastErrorCategory: null,
          lastSafeErrorMessage: null,
          lastFailureReason: null,
          cooldownUntil: null,
          consecutiveFailures: 0,
          coolingDown: false,
          rateLimited: false,
          runtimeVerified: false,
          available: true,
          status: "unknown" as const,
        },
        status: "unknown" as const,
        isAi: false,
      },
    },
    fallbackChain: AI_FALLBACK_CHAIN,
    fallbackChainExtraction: AI_FALLBACK_CHAIN_EXTRACTION,
    preferredProvider,
    blockers,
    warnings,
    // Structured "no AI provider ready" signal for callers. Mirrors the
    // NoAiProviderReadyError contract in lib/ai.ts so client and server share
    // a single error vocabulary.
    noAiProviderReady,
    noAiProviderReadyCode: noAiProviderReady ? "NO_AI_PROVIDER_READY" : null,
    nextAction: blockers.length > 0
      ? "CONFIGURE_AI_KEYS"
      : allConfiguredCooling
        ? "ALL_PROVIDERS_COOLING"
        : !anyHasRecentSuccess
          ? "RUNTIME_NOT_VERIFIED"
          : warnings.length > 0
            ? "REVIEW_AI_CONFIGURATION"
            : "READY",
  });
}
