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
    providers: {
      mistral: {
        configured: isMistralConfigured(),
        model: getMistralProposalModel(),
        analysisModel: getMistralAnalysisModel(),
        runtime: providerRuntime.mistral,
        status: providerRuntime.mistral.status,
        isAi: true,
      },
      groq: {
        configured: isGroqConfigured(),
        model: getGroqModel(),
        runtime: providerRuntime.groq,
        status: providerRuntime.groq.status,
        isAi: true,
      },
      openrouter: {
        configured: isOpenRouterConfigured(),
        model: getOpenRouterModel(),
        runtime: providerRuntime.openrouter,
        status: providerRuntime.openrouter.status,
        isAi: true,
      },
      gemini: {
        configured: isGeminiConfigured(),
        model: process.env.GEMINI_MODEL || "gemini-2.5-pro",
        runtime: providerRuntime.gemini,
        status: providerRuntime.gemini.status,
        isAi: true,
      },
      openai: {
        configured: isOpenAIConfigured(),
        model: process.env.OPENAI_PROPOSAL_MODEL || "gpt-4o",
        runtime: providerRuntime.openai,
        status: providerRuntime.openai.status,
        isAi: true,
      },
      together: {
        configured: isTogetherConfigured(),
        model: getTogetherProposalModel(),
        analysisModel: getTogetherAnalysisModel(),
        fastModel: getTogetherFastModel(),
        runtime: providerRuntime.together,
        status: providerRuntime.together.status,
        isAi: true,
      },
      deepseek: {
        configured: isDeepSeekConfigured(),
        envPresent: deepSeekOfficialEnvPresent(),
        model: getDeepSeekModel(),
        runtime: providerRuntime.deepseek,
        status: providerRuntime.deepseek.status,
        isAi: true,
      },
      claude: {
        configured: isAnthropicConfigured(),
        runtime: providerRuntime.anthropic,
        status: providerRuntime.anthropic.status,
        isAi: true,
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
