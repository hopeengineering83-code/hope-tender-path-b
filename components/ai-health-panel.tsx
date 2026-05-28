import {
  getProviderRuntimeSnapshot,
  isDeepSeekConfigured,
  deepSeekOfficialEnvPresent,
  getDeepSeekModel,
  isGroqConfigured,
  getGroqModel,
  isOpenRouterConfigured,
  getOpenRouterModel,
  type ProviderRuntimeSnapshot,
} from "../lib/ai-provider-health";

const AI_FALLBACK_CHAIN = "Claude → Gemini → OpenAI → DeepSeek → Groq → OpenRouter → deterministic draft fallback";

type ProviderCardData = {
  key: string;
  label: string;
  rank: number;
  configured: boolean;
  model: string | null;
  envVar: string;
  note: string;
  detail: string | null;
  modelHint: string | null;
  runtime: ProviderRuntimeSnapshot;
};

type AIHealthResponse = {
  success: boolean;
  preferredProvider: string;
  nextAction: string;
  blockers: string[];
  warnings: string[];
  providers: ProviderCardData[];
};

function present(value: string | undefined) {
  return Boolean(value && value.trim().length > 0);
}

function splitModels(value: string | undefined, fallback: string[]) {
  const models = (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  return models.length > 0 ? models : fallback;
}

function getAIHealth(): AIHealthResponse {
  const claudeConfigured = present(process.env.ANTHROPIC_API_KEY);
  const geminiConfigured = present(process.env.GEMINI_API_KEY);
  const openaiConfigured = present(process.env.OPENAI_API_KEY);
  const deepseekConfigured = isDeepSeekConfigured();
  const groqConfigured = isGroqConfigured();
  const openRouterConfigured = isOpenRouterConfigured();

  const claudeModels = splitModels(process.env.ANTHROPIC_PROPOSAL_MODELS, ["claude-sonnet-4-5", "claude-opus-4-1", "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"]);
  const geminiModels = splitModels(process.env.GEMINI_FALLBACK_MODELS, ["gemini-2.5-flash", "gemini-2.0-flash"]);
  const openRouterModel = getOpenRouterModel();

  // Provider order IS the fallback priority (rank 1..6).
  const providers: ProviderCardData[] = [
    {
      key: "claude", label: "Claude", rank: 1, configured: claudeConfigured, envVar: "ANTHROPIC_API_KEY",
      model: claudeModels[0] ?? null, note: "Preferred primary provider",
      detail: `Tier ${process.env.ANTHROPIC_TIER ?? "not set"} · models ${claudeModels.slice(0, 2).join(", ") || "none"}`,
      modelHint: null, runtime: getProviderRuntimeSnapshot("anthropic"),
    },
    {
      key: "gemini", label: "Gemini", rank: 2, configured: geminiConfigured, envVar: "GEMINI_API_KEY",
      model: process.env.GEMINI_MODEL || "gemini-2.5-pro", note: "Second-tier fallback provider",
      detail: `Fallback: ${geminiModels.slice(0, 2).join(", ") || "none"}`,
      modelHint: null, runtime: getProviderRuntimeSnapshot("gemini"),
    },
    {
      key: "openai", label: "OpenAI", rank: 3, configured: openaiConfigured, envVar: "OPENAI_API_KEY",
      model: process.env.OPENAI_PROPOSAL_MODEL || "gpt-4o", note: "Third-tier fallback provider",
      detail: null, modelHint: null, runtime: getProviderRuntimeSnapshot("openai"),
    },
    {
      key: "deepseek", label: "DeepSeek", rank: 4, configured: deepseekConfigured, envVar: "DEEPSEEK_API_KEY",
      model: getDeepSeekModel(), note: "Fourth-tier fallback provider",
      detail: deepseekConfigured && !deepSeekOfficialEnvPresent() ? "Enabled via alias env var — rename to DEEPSEEK_API_KEY." : null,
      modelHint: null, runtime: getProviderRuntimeSnapshot("deepseek"),
    },
    {
      key: "groq", label: "Groq", rank: 5, configured: groqConfigured, envVar: "GROQ_API_KEY",
      model: getGroqModel(), note: "Fifth-tier fallback provider", detail: null, modelHint: null,
      runtime: getProviderRuntimeSnapshot("groq"),
    },
    {
      key: "openrouter", label: "OpenRouter", rank: 6, configured: openRouterConfigured, envVar: "OPENROUTER_API_KEY",
      model: openRouterModel, note: "Sixth-tier fallback provider", detail: null,
      modelHint: openRouterConfigured && openRouterModel === "openrouter/auto"
        ? "Using openrouter/auto. Set OPENROUTER_PROPOSAL_MODEL to a model available in your OpenRouter account to pin it."
        : null,
      runtime: getProviderRuntimeSnapshot("openrouter"),
    },
  ];

  const anyConfigured = providers.some((p) => p.configured);
  const preferredProvider = providers.find((p) => p.configured)?.key ?? "none";

  const warnings: string[] = [];
  const blockers: string[] = [];
  if (!anyConfigured) {
    blockers.push("No AI provider key is configured. Set ANTHROPIC_API_KEY (preferred), GEMINI_API_KEY, OPENAI_API_KEY, DEEPSEEK_API_KEY, GROQ_API_KEY, or OPENROUTER_API_KEY. Without one, only the deterministic fallback runs, which cannot be exported as final.");
  }
  if (claudeConfigured && claudeModels.length === 0) warnings.push("Claude is configured but no Claude model chain was resolved.");
  if (geminiConfigured && !present(process.env.GEMINI_MODEL)) warnings.push("GEMINI_MODEL is not set; the app will use its built-in Gemini default.");
  if (deepseekConfigured && !deepSeekOfficialEnvPresent()) warnings.push("DeepSeek is enabled via a fallback alias env var. Rename it to DEEPSEEK_API_KEY (the official variable) in Vercel.");
  const cooling = providers.filter((p) => p.runtime.coolingDown).map((p) => p.label);
  if (cooling.length > 0) warnings.push(`Provider(s) in cooldown: ${cooling.join(", ")}. Requests skip cooled-down providers until the window expires.`);

  return {
    success: anyConfigured,
    providers,
    preferredProvider,
    blockers,
    warnings,
    nextAction: blockers.length > 0 ? "CONFIGURE_AI_KEYS" : warnings.length > 0 ? "REVIEW_AI_CONFIGURATION" : "READY",
  };
}

function ProviderCard({ p }: { p: ProviderCardData }) {
  const failing = p.configured && (p.runtime.coolingDown || p.runtime.consecutiveFailures > 0);
  const pill = !p.configured
    ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">Not configured</span>
    : failing
      ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">Configured · failing</span>
      : <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">Configured</span>;
  return (
    <div className="rounded-xl bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-slate-900">{p.label}</p>
        {pill}
      </div>
      <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">Fallback rank {p.rank}</p>
      {!p.configured && <p className="mt-1 text-xs text-slate-600">Not configured — set {p.envVar} in Vercel Production environment.</p>}
      {p.configured && <p className="mt-1 text-xs text-slate-600">Model: {p.model ?? "provider default"}</p>}
      {p.configured && p.detail && <p className="mt-1 text-xs text-slate-500">{p.detail}</p>}
      {p.configured && p.runtime.coolingDown && (
        <p className="mt-1 text-xs text-amber-700">In cooldown{p.runtime.cooldownUntil ? ` until ${new Date(p.runtime.cooldownUntil).toLocaleTimeString()}` : ""} — requests skip this provider.</p>
      )}
      {p.configured && failing && (
        <p className="mt-1 text-xs text-amber-700">
          Configured, but last response failed or returned empty{p.runtime.lastErrorCategory ? ` (${p.runtime.lastErrorCategory})` : ""}. Check {p.label} model access or retry after cooldown.
        </p>
      )}
      {p.configured && p.modelHint && <p className="mt-1 text-xs text-slate-500">{p.modelHint}</p>}
    </div>
  );
}

export async function AIHealthPanel() {
  const health = getAIHealth();
  const ok = health.success;
  return (
    <section className={`mb-4 rounded-2xl border p-5 shadow-sm ${ok ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className={`text-xs font-semibold uppercase tracking-wide ${ok ? "text-emerald-700" : "text-red-700"}`}>AI provider health</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">Preferred provider: {health.preferredProvider}</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">Shows whether the Claude, Gemini, OpenAI, DeepSeek, Groq, and OpenRouter keys and models are available before running AI Analyze, Run Engine, or Generate Docs. Secret values are never displayed.</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${ok ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>{health.nextAction.replace(/_/g, " ")}</span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {health.providers.map((p) => <ProviderCard key={p.key} p={p} />)}
      </div>

      <p className="mt-3 text-xs text-slate-500">Fallback chain: {AI_FALLBACK_CHAIN}</p>

      {(health.blockers.length > 0 || health.warnings.length > 0) && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {health.blockers.length > 0 && <div className="rounded-xl border border-red-200 bg-white p-3 text-sm text-red-800"><p className="font-semibold">Blockers</p><ul className="mt-2 list-disc pl-5">{health.blockers.map((item) => <li key={item}>{item}</li>)}</ul></div>}
          {health.warnings.length > 0 && <div className="rounded-xl border border-amber-200 bg-white p-3 text-sm text-amber-800"><p className="font-semibold">Warnings</p><ul className="mt-2 list-disc pl-5">{health.warnings.map((item) => <li key={item}>{item}</li>)}</ul></div>}
        </div>
      )}
    </section>
  );
}
