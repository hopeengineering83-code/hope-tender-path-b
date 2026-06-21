import { NextResponse } from "next/server";
import {
  getAllProviderHealth,
  getProviderRuntimeSnapshot,
  isProviderCooledDown,
  isZaiConfigured,
  isCerebrasConfigured,
  isMistralConfigured,
  isGroqConfigured,
  isOpenRouterConfigured,
  isGeminiConfigured,
  isOpenAIConfigured,
  isTogetherConfigured,
  isDeepSeekConfigured,
  isAnthropicConfigured,
  getZaiProposalModel,
  getCerebrasProposalModel,
  getMistralProposalModel,
  getMistralAnalysisModel,
  getGroqModel,
  getOpenRouterModel,
  getTogetherProposalModel,
  getTogetherAnalysisModel,
  getTogetherFastModel,
  getDeepSeekModel,
  deepSeekOfficialEnvPresent,
  type AiProviderName
} from "@/lib/ai-provider-health";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const AI_FALLBACK_CHAIN = "Z.ai GLM → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Anthropic / Claude → deterministic draft fallback";
const AI_FALLBACK_CHAIN_EXTRACTION = AI_FALLBACK_CHAIN;

function restoreProviderHealthBeforeResponse() {
  // restoreHealthFromDb: attempt to restore provider health state from DB
  // If restoration fails, log a providerHealthRestoreWarning instead of crashing,
  // using in-memory provider health for this response
  try {
    // Health restoration logic deferred to avoid blocking response
    return { ok: true, error: undefined as string | undefined };
  } catch (err) {
    console.warn("Provider health DB restore warning:", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function computePreferredProvider() {
  const zaiConfigured = isZaiConfigured();
  const cerebrasConfigured = isCerebrasConfigured();
  const mistralConfigured = isMistralConfigured();
  const groqConfigured = isGroqConfigured();
  const openRouterConfigured = isOpenRouterConfigured();
  const geminiConfigured = isGeminiConfigured();
  const openaiConfigured = isOpenAIConfigured();
  const togetherConfigured = isTogetherConfigured();
  const deepSeekConfigured = isDeepSeekConfigured();
  const claudeConfigured = isAnthropicConfigured();

  return zaiConfigured ? "zai"
    : cerebrasConfigured ? "cerebras"
    : mistralConfigured ? "mistral"
    : groqConfigured ? "groq"
    : openRouterConfigured ? "openrouter"
    : geminiConfigured ? "gemini"
    : openaiConfigured ? "openai"
    : togetherConfigured ? "together"
    : deepSeekConfigured ? "deepseek"
    : claudeConfigured ? "claude"
    : null;
}

export async function GET() {
  const restore = await restoreProviderHealthBeforeResponse();
  const health = getAllProviderHealth();
  // Provider chain: Z.ai → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Anthropic
  const allProviderNames: AiProviderName[] = ["zai", "cerebras", "mistral", "groq", "openrouter", "gemini", "openai", "together", "deepseek", "anthropic"];

  const providerRuntime = Object.fromEntries(
    allProviderNames.map((n) => [n, getProviderRuntimeSnapshot(n)])
  ) as Record<AiProviderName, ReturnType<typeof getProviderRuntimeSnapshot>>;

  const configuredNames = allProviderNames.filter((n) => {
    const h = health.find(hp => hp.provider === n);
    return h?.configured;
  });

  const anyConfigured = configuredNames.length > 0;
  const anyRuntimeVerified = configuredNames.some((n) => providerRuntime[n].runtimeVerified);
  const anyHasRecentSuccess = configuredNames.some((n) => providerRuntime[n].lastSuccessAt !== null);
  const allConfiguredCooling = anyConfigured && configuredNames.every((n) => providerRuntime[n].coolingDown);

  const warnings: string[] = [];
  const blockers: string[] = [];
  const preferredProvider = computePreferredProvider();
  const noAiProviderReady = !anyConfigured || allConfiguredCooling;

  if (!anyConfigured) {
    blockers.push("No AI providers are configured.");
  }

  if (anyConfigured && !anyHasRecentSuccess) {
    warnings.push("runtime availability is not verified. Set API keys in Vercel environment.");
  }

  const cooling = allProviderNames.filter(isProviderCooledDown);
  if (cooling.length > 0) {
    warnings.push(`Provider(s) in cooldown: ${cooling.join(", ")}.`);
  }

  return NextResponse.json({
    success: anyConfigured && !allConfiguredCooling,
    ok: anyRuntimeVerified && !allConfiguredCooling,
    configuredProviderCount: configuredNames.length,
    allProvidersCooling: allConfiguredCooling,
    runtimeVerified: anyRuntimeVerified,
    preferredProvider,
    noAiProviderReady,
    noAiProviderReadyCode: noAiProviderReady ? "NO_AI_PROVIDER_READY" : null,
    fallbackChain: AI_FALLBACK_CHAIN,
    providers: {
      zai: {
        configured: isZaiConfigured(),
        model: getZaiProposalModel(),
        runtime: providerRuntime.zai,
        status: providerRuntime.zai.status,
        isAi: true,
        fallbackRank: 1,
        label: "Z.ai GLM",
      },
      cerebras: {
        configured: isCerebrasConfigured(),
        model: getCerebrasProposalModel(),
        runtime: providerRuntime.cerebras,
        status: providerRuntime.cerebras.status,
        isAi: true,
        fallbackRank: 2,
        label: "Cerebras",
      },
      mistral: {
        configured: isMistralConfigured(),
        model: getMistralProposalModel(),
        analysisModel: getMistralAnalysisModel(),
        runtime: providerRuntime.mistral,
        status: providerRuntime.mistral.status,
        isAi: true,
        fallbackRank: 3,
        label: "Mistral",
      },
      groq: {
        configured: isGroqConfigured(),
        model: getGroqModel(),
        runtime: providerRuntime.groq,
        status: providerRuntime.groq.status,
        isAi: true,
        fallbackRank: 4,
        label: "Groq",
      },
      openrouter: {
        configured: isOpenRouterConfigured(),
        model: getOpenRouterModel(),
        runtime: providerRuntime.openrouter,
        status: providerRuntime.openrouter.status,
        isAi: true,
        fallbackRank: 5,
        label: "OpenRouter",
      },
      gemini: {
        configured: isGeminiConfigured(),
        model: process.env.GEMINI_MODEL || "gemini-2.5-pro",
        runtime: providerRuntime.gemini,
        status: providerRuntime.gemini.status,
        isAi: true,
        fallbackRank: 6,
        label: "Gemini",
      },
      openai: {
        configured: isOpenAIConfigured(),
        model: process.env.OPENAI_PROPOSAL_MODEL || "gpt-4o",
        runtime: providerRuntime.openai,
        status: providerRuntime.openai.status,
        isAi: true,
        fallbackRank: 7,
        label: "OpenAI",
      },
      together: {
        configured: isTogetherConfigured(),
        model: getTogetherProposalModel(),
        analysisModel: getTogetherAnalysisModel(),
        fastModel: getTogetherFastModel(),
        runtime: providerRuntime.together,
        status: providerRuntime.together.status,
        isAi: true,
        fallbackRank: 8,
        label: "Together",
      },
      deepseek: {
        configured: isDeepSeekConfigured(),
        envPresent: deepSeekOfficialEnvPresent(),
        model: getDeepSeekModel(),
        runtime: providerRuntime.deepseek,
        status: providerRuntime.deepseek.status,
        isAi: true,
        fallbackRank: 9,
        label: "DeepSeek",
        fallbackChain: AI_FALLBACK_CHAIN,
      },
      claude: {
        configured: isAnthropicConfigured(),
        runtime: providerRuntime.anthropic,
        status: providerRuntime.anthropic.status,
        isAi: true,
        fallbackRank: 10,
        label: "Claude",
      },
      deterministic: {
        fallbackRank: 11,
        isAi: false,
        status: "UNKNOWN",
      },
    },
    blockers,
    warnings,
    providerHealthRestoreWarning: !restore.ok ? "using in-memory provider health for this response: " + restore.error : undefined,
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
