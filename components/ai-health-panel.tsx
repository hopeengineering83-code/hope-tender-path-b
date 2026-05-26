type AIHealthResponse = {
  success: boolean;
  preferredProvider: string;
  nextAction: string;
  blockers: string[];
  warnings: string[];
  providers: {
    claude: { configured: boolean; tier: string | null; proposalModels: string[]; maxOutputTokens: number | null };
    gemini: { configured: boolean; primaryModel: string; fallbackModels: string[]; extractionModel: string | null };
    openai: { configured: boolean; note: string };
  };
};

function present(value: string | undefined) {
  return Boolean(value && value.trim().length > 0);
}

function splitModels(value: string | undefined, fallback: string[]) {
  const models = (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  return models.length > 0 ? models : fallback;
}

function maskModelChain(models: string[]) {
  return models.map((model) => model.replace(/\s+/g, " ").trim()).filter(Boolean);
}

function getAIHealth(): AIHealthResponse {
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

  return {
    success: blockers.length === 0,
    providers: {
      claude: {
        configured: claudeConfigured,
        tier: process.env.ANTHROPIC_TIER || null,
        proposalModels: maskModelChain(claudeModels),
        maxOutputTokens: Number(process.env.ANTHROPIC_MAX_OUTPUT_TOKENS || 0) || null,
      },
      gemini: {
        configured: geminiConfigured,
        primaryModel: process.env.GEMINI_MODEL || "gemini-2.5-pro",
        fallbackModels: maskModelChain(geminiModels),
        extractionModel: process.env.GEMINI_EXTRACTION_MODEL || process.env.GEMINI_EXTRACT_MODEL || null,
      },
      openai: {
        configured: openaiConfigured,
        note: "Configured fallback provider (Claude → Gemini → OpenAI → DeepSeek).",
      },
    },
    preferredProvider,
    blockers,
    warnings,
    nextAction: blockers.length > 0 ? "CONFIGURE_AI_KEYS" : warnings.length > 0 ? "REVIEW_AI_CONFIGURATION" : "READY",
  };
}

function statusPill(configured: boolean) {
  return configured
    ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">Configured</span>
    : <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">Missing</span>;
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
          <p className="mt-1 max-w-3xl text-sm text-slate-600">Shows whether Claude/Gemini keys and model chains are available before running AI Analyze, Run Engine, or Generate Docs. Secret values are never displayed.</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${ok ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>{health.nextAction.replace(/_/g, " ")}</span>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <div className="rounded-xl bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between"><p className="font-semibold text-slate-900">Claude</p>{statusPill(health.providers.claude.configured)}</div>
          <p className="mt-2 text-xs text-slate-600">Tier: {health.providers.claude.tier ?? "not set"}</p>
          <p className="mt-1 text-xs text-slate-600">Models: {health.providers.claude.proposalModels.slice(0, 3).join(", ") || "none"}</p>
        </div>
        <div className="rounded-xl bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between"><p className="font-semibold text-slate-900">Gemini</p>{statusPill(health.providers.gemini.configured)}</div>
          <p className="mt-2 text-xs text-slate-600">Primary: {health.providers.gemini.primaryModel}</p>
          <p className="mt-1 text-xs text-slate-600">Fallback: {health.providers.gemini.fallbackModels.slice(0, 2).join(", ") || "none"}</p>
        </div>
        <div className="rounded-xl bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between"><p className="font-semibold text-slate-900">OpenAI</p>{statusPill(health.providers.openai.configured)}</div>
          <p className="mt-2 text-xs text-slate-600">{health.providers.openai.note}</p>
        </div>
      </div>

      {(health.blockers.length > 0 || health.warnings.length > 0) && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {health.blockers.length > 0 && <div className="rounded-xl border border-red-200 bg-white p-3 text-sm text-red-800"><p className="font-semibold">Blockers</p><ul className="mt-2 list-disc pl-5">{health.blockers.map((item) => <li key={item}>{item}</li>)}</ul></div>}
          {health.warnings.length > 0 && <div className="rounded-xl border border-amber-200 bg-white p-3 text-sm text-amber-800"><p className="font-semibold">Warnings</p><ul className="mt-2 list-disc pl-5">{health.warnings.map((item) => <li key={item}>{item}</li>)}</ul></div>}
        </div>
      )}
    </section>
  );
}
