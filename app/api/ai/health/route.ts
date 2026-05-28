import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import {
  getAllProviderHealth,
  isProviderCooledDown,
  getProviderRuntimeSnapshot,
  isDeepSeekConfigured,
  deepSeekOfficialEnvPresent,
  getDeepSeekModel,
  isGroqConfigured,
  getGroqModel,
  isOpenRouterConfigured,
  getOpenRouterModel,
} from "../../../../lib/ai-provider-health";

const AI_FALLBACK_CHAIN = "Claude → Gemini → OpenAI → DeepSeek → Groq → OpenRouter → deterministic draft fallback";

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

export async function GET() {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const claudeConfigured = present(process.env.ANTHROPIC_API_KEY);
  const geminiConfigured = present(process.env.GEMINI_API_KEY);
  const openaiConfigured = present(process.env.OPENAI_API_KEY);
  const preferredProvider = claudeConfigured ? "claude" : geminiConfigured ? "gemini" : openaiConfigured ? "openai" : "none";

  const claudeModels = splitModels(process.env.ANTHROPIC_PROPOSAL_MODELS, ["claude-sonnet-4-5", "claude-opus-4-1", "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"]);
  const geminiModels = splitModels(process.env.GEMINI_FALLBACK_MODELS, ["gemini-2.5-flash", "gemini-2.0-flash"]);
  const warnings: string[] = [];
  const blockers: string[] = [];

  if (!claudeConfigured && !geminiConfigured) blockers.push("No Claude or Gemini API key is configured. AI analysis/proposal quality will fall back or fail.");
  if (claudeConfigured && claudeModels.length === 0) warnings.push("Claude is configured but no Claude model chain was resolved.");
  if (geminiConfigured && !present(process.env.GEMINI_MODEL)) warnings.push("GEMINI_MODEL is not set; the app will use its built-in Gemini default.");
  if (openaiConfigured) warnings.push("OPENAI API key is configured. OpenAI is available in the fallback chain when higher-priority providers fail.");

  const runtimeHealth = getAllProviderHealth();
  const healthByProvider = Object.fromEntries(runtimeHealth.map((h) => [h.provider, h]));

  const coolingDown = runtimeHealth.filter((h) => isProviderCooledDown(h.provider));
  if (coolingDown.length > 0) {
    warnings.push(`Provider(s) in cooldown: ${coolingDown.map((h) => h.provider).join(", ")}. Requests will skip cooled-down providers until the window expires.`);
  }

  const deepSeekConfigured = isDeepSeekConfigured();
  const deepSeekRuntime = getProviderRuntimeSnapshot("deepseek");
  if (deepSeekConfigured && !deepSeekOfficialEnvPresent()) {
    warnings.push("DeepSeek is enabled via a fallback alias env var. Rename it to DEEPSEEK_API_KEY (the official variable) in Vercel.");
  }

  const groqConfigured = isGroqConfigured();
  const groqRuntime = getProviderRuntimeSnapshot("groq");
  const openRouterConfigured = isOpenRouterConfigured();
  const openRouterRuntime = getProviderRuntimeSnapshot("openrouter");

  return NextResponse.json({
    success: blockers.length === 0,
    providers: {
      claude: {
        configured: claudeConfigured,
        tier: process.env.ANTHROPIC_TIER || null,
        proposalModels: maskModelChain(claudeModels),
        maxOutputTokens: Number(process.env.ANTHROPIC_MAX_OUTPUT_TOKENS || 0) || null,
        runtime: healthByProvider["anthropic"] ?? null,
      },
      gemini: {
        configured: geminiConfigured,
        primaryModel: process.env.GEMINI_MODEL || "gemini-2.5-pro",
        fallbackModels: maskModelChain(geminiModels),
        extractionModel: process.env.GEMINI_EXTRACTION_MODEL || process.env.GEMINI_EXTRACT_MODEL || null,
        runtime: healthByProvider["gemini"] ?? null,
      },
      openai: {
        configured: openaiConfigured,
        note: "Configured fallback provider (Claude → Gemini → OpenAI → DeepSeek).",
        runtime: healthByProvider["openai"] ?? null,
      },
      deepseek: {
        configured: deepSeekConfigured,
        envPresent: deepSeekOfficialEnvPresent(),
        model: getDeepSeekModel(),
        fallbackRank: 4,
        label: "DeepSeek",
        note: "Fourth-tier fallback provider",
        runtime: deepSeekRuntime,
      },
      groq: {
        configured: groqConfigured,
        model: getGroqModel(),
        fallbackRank: 5,
        label: "Groq",
        note: "Fifth-tier fallback provider",
        runtime: groqRuntime,
      },
      openrouter: {
        configured: openRouterConfigured,
        model: getOpenRouterModel(),
        fallbackRank: 6,
        label: "OpenRouter",
        note: "Sixth-tier fallback provider",
        runtime: openRouterRuntime,
      },
    },
    fallbackChain: AI_FALLBACK_CHAIN,
    preferredProvider,
    blockers,
    warnings,
    nextAction: blockers.length > 0 ? "CONFIGURE_AI_KEYS" : warnings.length > 0 ? "REVIEW_AI_CONFIGURATION" : "READY",
  });
}
