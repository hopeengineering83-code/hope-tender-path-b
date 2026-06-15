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
import { CANONICAL_AI_PROVIDER_CHAIN, CANONICAL_AI_PROVIDER_DISPLAY, CANONICAL_AI_PROVIDER_RANK, configuredCanonicalProviders, preferredCanonicalProvider } from "../../../../lib/ai-provider-policy";

// Canonical fallback order surfaced to operators. Must match lib/ai.ts PROVIDER_CHAINS.
// Claude is placed LAST so Anthropic rate limits do not block other providers.
const AI_FALLBACK_CHAIN = `${CANONICAL_AI_PROVIDER_DISPLAY} → deterministic draft fallback`;
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
  const configuredNames = configuredCanonicalProviders();
  const anyConfigured = configuredNames.length > 0;
  const preferredProvider = preferredCanonicalProvider() ?? "none";

  const claudeModels = splitModels(process.env.ANTHROPIC_PROPOSAL_MODELS, ["claude-sonnet-4-5", "claude-opus-4-1", "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"]);
  const geminiModels = splitModels(process.env.GEMINI_FALLBACK_MODELS, ["gemini-2.5-flash", "gemini-2.0-flash"]);
  const warnings: string[] = [];
  const blockers: string[] = [];
  if (providerHealthRestoreWarning) warnings.push(providerHealthRestoreWarning);

  // Only a TRUE blocker when NO provider at all is configured.
  if (!anyConfigured) {
    blockers.push(`No canonical AI provider key is configured. Policy order: ${CANONICAL_AI_PROVIDER_DISPLAY}. Deterministic fallback cannot be exported as final.`);
  }
  if (claudeConfigured && claudeModels.length === 0) warnings.push("Claude is configured but no Claude model chain was resolved.");
  if (geminiConfigured && !present(process.env.GEMINI_MODEL)) warnings.push("GEMINI_MODEL is not set; the app will use its built-in Gemini default.");
  if (deepSeekConfigured && !deepSeekOfficialEnvPresent()) warnings.push("DeepSeek is enabled via a fallback alias env var. Rename it to DEEPSEEK_API_KEY (the official variable) in Vercel.");

  // Cooldown notice — purely advisory; the chain skips cooled-down providers.
  const allProviderNames: AiProviderName[] = [...CANONICAL_AI_PROVIDER_CHAIN];
  const cooling = allProviderNames.filter(isProviderCooledDown);
  if (cooling.length > 0) {
    warnings.push(`Provider(s) in cooldown: ${cooling.join(", ")}. Requests skip cooled-down providers until the window expires.`);
  }

  // Configured ≠ runtime-verified. Distinguish keys-present-but-never-used
  // from keys-present-AND-recently-succeeded. Production screenshots showed
  // a "READY" pill while AI Analyze had actually fallen through to regex.
  const configuredMap: Record<AiProviderName, boolean> = {
    anthropic: claudeConfigured, gemini: geminiConfigured, openai: openaiConfigured,
    mistral: mistralConfigured, deepseek: deepSeekConfigured, groq: groqConfigured,
    together: togetherConfigured, openrouter: openRouterConfigured,
  };
  const providerRuntime = Object.fromEntries(allProviderNames.map((n) => [n, getProviderRuntimeSnapshot(n)])) as Record<AiProviderName, ReturnType<typeof getProviderRuntimeSnapshot>>;
  const anyHasRecentSuccess = configuredNames.some((n) => Boolean(providerRuntime[n].lastSuccessAt));
  const configuredProvidersAvailable = configuredNames.filter((n) => providerRuntime[n].available);
  const allConfiguredCooling = anyConfigured && configuredNames.every((n) => providerRuntime[n].coolingDown);
  if (allConfiguredCooling) warnings.push("All configured AI providers are currently in cooldown. AI Analyze will fall back to regex (UNAPPROVED) until a provider's cooldown expires. Next action: wait for the earliest cooldown window to expire or reset provider health after fixing the upstream limit.");
  if (anyConfigured && !anyHasRecentSuccess) warnings.push("AI providers are configured but no successful response has been recorded on this serverless instance yet — runtime availability is not verified.");

  const openaiModel = process.env.OPENAI_PROPOSAL_MODEL || "gpt-4o";

  return NextResponse.json({
    success: anyConfigured && !allConfiguredCooling,
    configuredProviderCount: configuredNames.length,
    availableProviderCount: configuredProvidersAvailable.length,
    allProvidersCooling: allConfiguredCooling,
    providers: {
      openai: {
        configured: openaiConfigured,
        envPresent: openaiConfigured,
        model: openaiModel,
        fallbackRank: CANONICAL_AI_PROVIDER_RANK.openai,
        label: "OpenAI",
        note: "Third canonical provider",
        runtime: providerRuntime.openai,
      },
      gemini: {
        configured: geminiConfigured,
        envPresent: geminiConfigured,
        model: process.env.GEMINI_MODEL || "gemini-2.5-pro",
        fallbackRank: CANONICAL_AI_PROVIDER_RANK.gemini,
        label: "Gemini",
        note: "First canonical provider",
        primaryModel: process.env.GEMINI_MODEL || "gemini-2.5-pro",
        fallbackModels: maskModelChain(geminiModels),
        extractionModel: process.env.GEMINI_EXTRACTION_MODEL || process.env.GEMINI_EXTRACT_MODEL || null,
        runtime: providerRuntime.gemini,
      },
      mistral: {
        configured: mistralConfigured,
        envPresent: mistralConfigured,
        model: getMistralProposalModel(),
        fallbackRank: null,
        label: "Mistral",
        note: "Optional explicit adapter; excluded from the canonical fallback chain",
        analysisModel: getMistralAnalysisModel(),
        runtime: providerRuntime.mistral,
      },
      deepseek: {
        configured: deepSeekConfigured,
        envPresent: deepSeekOfficialEnvPresent(),
        model: getDeepSeekModel(),
        fallbackRank: CANONICAL_AI_PROVIDER_RANK.deepseek,
        label: "DeepSeek",
        note: "Fifth canonical provider",
        runtime: providerRuntime.deepseek,
      },
      groq: {
        configured: groqConfigured,
        envPresent: groqConfigured,
        model: getGroqModel(),
        fallbackRank: CANONICAL_AI_PROVIDER_RANK.groq,
        label: "Groq",
        note: "Fourth canonical provider",
        runtime: providerRuntime.groq,
      },
      together: {
        configured: togetherConfigured,
        envPresent: togetherConfigured,
        model: getTogetherProposalModel(),
        fallbackRank: null,
        label: "Together",
        note: "Optional explicit adapter; excluded from the canonical fallback chain",
        analysisModel: getTogetherAnalysisModel(),
        fastModel: getTogetherFastModel(),
        runtime: providerRuntime.together,
      },
      openrouter: {
        configured: openRouterConfigured,
        envPresent: openRouterConfigured,
        model: getOpenRouterModel(),
        fallbackRank: CANONICAL_AI_PROVIDER_RANK.openrouter,
        label: "OpenRouter",
        note: "Second canonical provider",
        runtime: providerRuntime.openrouter,
      },
      claude: {
        configured: claudeConfigured,
        envPresent: claudeConfigured,
        model: claudeModels[0] ?? null,
        fallbackRank: CANONICAL_AI_PROVIDER_RANK.anthropic,
        label: "Claude/Anthropic",
        note: "Final canonical fallback provider",
        tier: process.env.ANTHROPIC_TIER || null,
        proposalModels: maskModelChain(claudeModels),
        maxOutputTokens: Number(process.env.ANTHROPIC_MAX_OUTPUT_TOKENS || 0) || null,
        runtime: providerRuntime.anthropic,
      },
    },
    fallbackChain: AI_FALLBACK_CHAIN,
    fallbackChainExtraction: AI_FALLBACK_CHAIN_EXTRACTION,
    preferredProvider,
    blockers,
    warnings,
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
