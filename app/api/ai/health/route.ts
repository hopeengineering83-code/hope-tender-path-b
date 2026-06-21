import { NextResponse } from "next/server";
import {
  restoreProviderHealthBeforeResponse,
  getAllProviderHealth,
  getProviderRuntimeSnapshot,
  isProviderCooledDown,
  isMistralConfigured,
  isGroqConfigured,
  isOpenRouterConfigured,
  isGeminiConfigured,
  isOpenAIConfigured,
  isTogetherConfigured,
  isDeepSeekConfigured,
  isAnthropicConfigured,
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

const AI_FALLBACK_CHAIN = "Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Claude → deterministic draft fallback";
const AI_FALLBACK_CHAIN_EXTRACTION = AI_FALLBACK_CHAIN;

function computePreferredProvider() {
  const mistralConfigured = isMistralConfigured();
  const groqConfigured = isGroqConfigured();
  const openRouterConfigured = isOpenRouterConfigured();
  const geminiConfigured = isGeminiConfigured();
  const openaiConfigured = isOpenAIConfigured();
  const togetherConfigured = isTogetherConfigured();
  const deepSeekConfigured = isDeepSeekConfigured();
  const claudeConfigured = isAnthropicConfigured();

  return mistralConfigured ? "mistral"
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
  // Provider chain: Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Claude
  const allProviderNames: AiProviderName[] = ["mistral", "groq", "openrouter", "gemini", "openai", "together", "deepseek", "anthropic"];

  const providerRuntime = Object.fromEntries(
    allProviderNames.map((n) => [n, getProviderRuntimeSnapshot(n)])
  ) as Record<AiProviderName, ReturnType<typeof getProviderRuntimeSnapshot>>;

  const configuredNames = allProviderNames.filter((n) => {
    const h = health.find(hp => hp.provider === n);
    return h?.configured;
  });

  const anyConfigured = configuredNames.length > 0;
  const anyRuntimeVerified = configuredNames.some((n) => providerRuntime[n].runtimeVerified);
  const allConfiguredCooling = anyConfigured && configuredNames.every((n) => providerRuntime[n].coolingDown);

  const warnings: string[] = [];
  const blockers: string[] = [];
  const preferredProvider = computePreferredProvider();
  const noAiProviderReady = !anyConfigured || allConfiguredCooling;

  if (!anyConfigured) {
    blockers.push("No AI providers are configured.");
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
    providers: {
      mistral: {
        configured: isMistralConfigured(),
        model: getMistralProposalModel(),
        analysisModel: getMistralAnalysisModel(),
        runtime: providerRuntime.mistral,
        status: providerRuntime.mistral.status,
        isAi: true,
        fallbackRank: 1,
      },
      groq: {
        configured: isGroqConfigured(),
        model: getGroqModel(),
        runtime: providerRuntime.groq,
        status: providerRuntime.groq.status,
        isAi: true,
        fallbackRank: 2,
      },
      openrouter: {
        configured: isOpenRouterConfigured(),
        model: getOpenRouterModel(),
        runtime: providerRuntime.openrouter,
        status: providerRuntime.openrouter.status,
        isAi: true,
        fallbackRank: 3,
      },
      gemini: {
        configured: isGeminiConfigured(),
        model: process.env.GEMINI_MODEL || "gemini-2.5-pro",
        runtime: providerRuntime.gemini,
        status: providerRuntime.gemini.status,
        isAi: true,
        fallbackRank: 4,
      },
      openai: {
        configured: isOpenAIConfigured(),
        model: process.env.OPENAI_PROPOSAL_MODEL || "gpt-4o",
        runtime: providerRuntime.openai,
        status: providerRuntime.openai.status,
        isAi: true,
        fallbackRank: 5,
      },
      together: {
        configured: isTogetherConfigured(),
        model: getTogetherProposalModel(),
        analysisModel: getTogetherAnalysisModel(),
        fastModel: getTogetherFastModel(),
        runtime: providerRuntime.together,
        status: providerRuntime.together.status,
        isAi: true,
        fallbackRank: 6,
      },
      deepseek: {
        configured: isDeepSeekConfigured(),
        envPresent: deepSeekOfficialEnvPresent(),
        model: getDeepSeekModel(),
        runtime: providerRuntime.deepseek,
        status: providerRuntime.deepseek.status,
        isAi: true,
        fallbackRank: 7,
      },
      claude: {
        configured: isAnthropicConfigured(),
        runtime: providerRuntime.anthropic,
        status: providerRuntime.anthropic.status,
        isAi: true,
        fallbackRank: 8,
      },
      deterministic: {
        fallbackRank: 9,
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
        : !anyRuntimeVerified
          ? "RUNTIME_NOT_VERIFIED"
          : "READY",
  });
}
