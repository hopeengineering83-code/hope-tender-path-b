import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import {
  isProviderCooledDown,
  getProviderRuntimeSnapshot,
  isDeepSeekConfigured,
  deepSeekOfficialEnvPresent,
  getDeepSeekModel,
  isGroqConfigured,
  getGroqModel,
  isOpenRouterConfigured,
  getOpenRouterModel,
  type AiProviderName,
} from "../../../../lib/ai-provider-health";
import { restoreHealthFromDb } from "../../../../lib/ai-provider-health-db";

// Canonical fallback order surfaced to operators. Must match lib/ai.ts PROVIDER_CHAINS.
// Claude is placed LAST so Anthropic rate limits do not block other providers.
const AI_FALLBACK_CHAIN = "OpenAI → Gemini → DeepSeek → Groq → OpenRouter → Claude → deterministic draft fallback";
const AI_FALLBACK_CHAIN_EXTRACTION = "Gemini → OpenAI → DeepSeek → Groq → OpenRouter → Claude → deterministic draft fallback";

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
  const groqConfigured = isGroqConfigured();
  const openRouterConfigured = isOpenRouterConfigured();

  // Configuration/preference reflect the WHOLE chain: any one configured
  // provider is valid (Groq-only or OpenRouter-only deployments are valid).
  // The response success flag is downgraded later only when every configured
  // provider is actively cooling down.
  const anyConfigured =
    claudeConfigured || geminiConfigured || openaiConfigured || deepSeekConfigured || groqConfigured || openRouterConfigured;
  // preferredProvider reflects the actual default chain order (Claude is last)
  const preferredProvider =
    openaiConfigured ? "openai"
    : geminiConfigured ? "gemini"
    : deepSeekConfigured ? "deepseek"
    : groqConfigured ? "groq"
    : openRouterConfigured ? "openrouter"
    : claudeConfigured ? "claude"
    : "none";

  const claudeModels = splitModels(process.env.ANTHROPIC_PROPOSAL_MODELS, ["claude-sonnet-4-5", "claude-opus-4-1", "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"]);
  const geminiModels = splitModels(process.env.GEMINI_FALLBACK_MODELS, ["gemini-2.5-flash", "gemini-2.0-flash"]);
  const warnings: string[] = [];
  const blockers: string[] = [];
  if (providerHealthRestoreWarning) warnings.push(providerHealthRestoreWarning);

  // Only a TRUE blocker when NO provider at all is configured.
  if (!anyConfigured) {
    blockers.push("No AI provider key is configured. Set ANTHROPIC_API_KEY (preferred), GEMINI_API_KEY, OPENAI_API_KEY, DEEPSEEK_API_KEY, GROQ_API_KEY, or OPENROUTER_API_KEY. AI analysis/generation will use the deterministic fallback, which cannot be exported as final.");
  }
  if (claudeConfigured && claudeModels.length === 0) warnings.push("Claude is configured but no Claude model chain was resolved.");
  if (geminiConfigured && !present(process.env.GEMINI_MODEL)) warnings.push("GEMINI_MODEL is not set; the app will use its built-in Gemini default.");
  if (deepSeekConfigured && !deepSeekOfficialEnvPresent()) warnings.push("DeepSeek is enabled via a fallback alias env var. Rename it to DEEPSEEK_API_KEY (the official variable) in Vercel.");

  // Cooldown notice — purely advisory; the chain skips cooled-down providers.
  const allProviderNames: AiProviderName[] = ["anthropic", "gemini", "openai", "deepseek", "groq", "openrouter"];
  const cooling = allProviderNames.filter(isProviderCooledDown);
  if (cooling.length > 0) {
    warnings.push(`Provider(s) in cooldown: ${cooling.join(", ")}. Requests skip cooled-down providers until the window expires.`);
  }

  // Configured ≠ runtime-verified. Distinguish keys-present-but-never-used
  // from keys-present-AND-recently-succeeded. Production screenshots showed
  // a "READY" pill while AI Analyze had actually fallen through to regex.
  const configuredMap: Record<AiProviderName, boolean> = {
    anthropic: claudeConfigured, gemini: geminiConfigured, openai: openaiConfigured,
    deepseek: deepSeekConfigured, groq: groqConfigured, openrouter: openRouterConfigured,
  };
  const configuredNames = allProviderNames.filter((n) => configuredMap[n]);
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
        fallbackRank: 1,
        label: "OpenAI",
        note: "First-tier provider (default chain)",
        runtime: providerRuntime.openai,
      },
      gemini: {
        configured: geminiConfigured,
        envPresent: geminiConfigured,
        model: process.env.GEMINI_MODEL || "gemini-2.5-pro",
        fallbackRank: 2,
        label: "Gemini",
        note: "Second-tier provider (first for extraction/analysis)",
        primaryModel: process.env.GEMINI_MODEL || "gemini-2.5-pro",
        fallbackModels: maskModelChain(geminiModels),
        extractionModel: process.env.GEMINI_EXTRACTION_MODEL || process.env.GEMINI_EXTRACT_MODEL || null,
        runtime: providerRuntime.gemini,
      },
      deepseek: {
        configured: deepSeekConfigured,
        envPresent: deepSeekOfficialEnvPresent(),
        model: getDeepSeekModel(),
        fallbackRank: 3,
        label: "DeepSeek",
        note: "Third-tier fallback provider",
        runtime: providerRuntime.deepseek,
      },
      groq: {
        configured: groqConfigured,
        envPresent: groqConfigured,
        model: getGroqModel(),
        fallbackRank: 4,
        label: "Groq",
        note: "Fourth-tier fallback provider",
        runtime: providerRuntime.groq,
      },
      openrouter: {
        configured: openRouterConfigured,
        envPresent: openRouterConfigured,
        model: getOpenRouterModel(),
        fallbackRank: 5,
        label: "OpenRouter",
        note: "Fifth-tier fallback provider",
        runtime: providerRuntime.openrouter,
      },
      claude: {
        configured: claudeConfigured,
        envPresent: claudeConfigured,
        model: claudeModels[0] ?? null,
        fallbackRank: 6,
        label: "Claude",
        note: "Last-resort provider (placed last to avoid Anthropic rate-limit blocking)",
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
